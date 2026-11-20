-- =============================================================================
-- Clínica DNA — Pendências da revisão de segurança
--
--  1. intervalos_ocupados deixa de ser público: só o servidor (service_role)
--     chama, com período curto e sem olhar para o passado. Antes, qualquer um
--     com a chave pública mapeava a ocupação de todos os profissionais.
--  2. Teto de reservas online NÃO confirmadas por profissional/dia. Reservas
--     "pagar na clínica" nunca expiram; o teto limita quanto da agenda um robô
--     consegue ocupar. Confirmar a reserva no painel libera a vaga do teto.
--  3. Profissional só avança o status dos próprios atendimentos
--     (ex.: não pode voltar "concluído" para "agendado").
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PARÂMETRO: teto de reservas online pendentes
-- -----------------------------------------------------------------------------
alter table public.parametros_agendamento
  add column max_online_pendentes_por_profissional_dia integer default 6
    check (max_online_pendentes_por_profissional_dia is null or max_online_pendentes_por_profissional_dia >= 1);

comment on column public.parametros_agendamento.max_online_pendentes_por_profissional_dia is
  'Máximo de agendamentos online com status "agendado" (ainda não confirmados) por profissional '
  'em um mesmo dia. NULL = sem teto. Confirmar no painel libera vaga.';

drop function public.parametros_agendamento_publicos();
create function public.parametros_agendamento_publicos()
returns table (
  antecedencia_minima_minutos integer,
  janela_dias integer,
  passo_minutos integer,
  max_online_pendentes_por_profissional_dia integer
)
language sql
stable
security definer
set search_path = public
as $$
  select p.antecedencia_minima_minutos, p.janela_dias, p.passo_minutos, p.max_online_pendentes_por_profissional_dia
  from public.parametros_agendamento p where p.id;
$$;
grant execute on function public.parametros_agendamento_publicos() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- INTERVALOS OCUPADOS: só servidor, período curto, sem passado
-- -----------------------------------------------------------------------------
drop function public.intervalos_ocupados(uuid[], timestamptz, timestamptz);
create function public.intervalos_ocupados(
  p_profissional_ids uuid[],
  p_inicio timestamptz,
  p_fim timestamptz
)
returns table (
  profissional_id uuid,
  inicio timestamptz,
  fim timestamptz,
  tipo text,
  online_pendente boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_fim <= p_inicio or p_fim - p_inicio > interval '2 days' then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  if p_fim < now() - interval '1 day' then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  if coalesce(array_length(p_profissional_ids, 1), 0) > 50 then
    raise exception 'Muitos profissionais' using errcode = '22023';
  end if;

  return query
  select a.profissional_id, a.data_hora_inicio, a.ocupado_ate, 'agendamento'::text,
         (a.canal = 'online' and a.status = 'agendado')
  from public.agendamentos a
  where a.profissional_id = any (p_profissional_ids)
    and a.status not in ('cancelado', 'faltou')
    and a.data_hora_inicio < p_fim
    and a.ocupado_ate > p_inicio
  union all
  select b.profissional_id, b.inicio, b.fim, 'bloqueio'::text, false
  from public.bloqueios_agenda b
  where b.profissional_id = any (p_profissional_ids)
    and b.inicio < p_fim
    and b.fim > p_inicio;
end;
$$;
revoke execute on function public.intervalos_ocupados(uuid[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.intervalos_ocupados(uuid[], timestamptz, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- TETO DE RESERVAS ONLINE PENDENTES — verificado na criação do agendamento
-- (trigger para não reescrever criar_agendamento_publico de novo)
-- -----------------------------------------------------------------------------
create or replace function public.agendamentos_teto_online()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teto integer;
  v_dia  date;
begin
  if new.canal <> 'online' or new.status <> 'agendado' then
    return new;
  end if;
  select max_online_pendentes_por_profissional_dia into v_teto from public.parametros_agendamento where id;
  if v_teto is null then
    return new;
  end if;

  v_dia := (new.data_hora_inicio at time zone 'America/Sao_Paulo')::date;
  -- serializa por profissional/dia para pedidos paralelos não furarem o teto
  perform pg_advisory_xact_lock(hashtextextended('teto-online:' || new.profissional_id || ':' || v_dia, 0));

  if (
    select count(*) from public.agendamentos a
    where a.profissional_id = new.profissional_id
      and a.canal = 'online'
      and a.status = 'agendado'
      and (a.data_hora_inicio at time zone 'America/Sao_Paulo')::date = v_dia
  ) >= v_teto then
    raise exception 'A agenda online deste profissional está cheia neste dia. Escolha outra data ou fale com a recepção pelo WhatsApp.'
      using errcode = 'P0003';
  end if;
  return new;
end;
$$;
create trigger agendamentos_teto_online
  before insert on public.agendamentos
  for each row execute function public.agendamentos_teto_online();

-- -----------------------------------------------------------------------------
-- PROFISSIONAL: só avança o status dos próprios atendimentos
--   agendado / confirmado / aguardando_atendimento → em_atendimento | faltou
--   em_atendimento                                → concluido
--   concluido / faltou / cancelado                → (nada)
-- -----------------------------------------------------------------------------
create or replace function public.agendamentos_protege_campos_profissional()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.auth_role() = 'profissional' then
    if new.cliente_id      is distinct from old.cliente_id
    or new.profissional_id is distinct from old.profissional_id
    or new.servico_id      is distinct from old.servico_id
    or new.data_hora_inicio is distinct from old.data_hora_inicio
    or new.data_hora_fim   is distinct from old.data_hora_fim
    or new.valor           is distinct from old.valor
    or new.canal           is distinct from old.canal
    or new.contato_nome    is distinct from old.contato_nome
    or new.contato_whatsapp is distinct from old.contato_whatsapp
    or new.contato_email   is distinct from old.contato_email then
      raise exception 'Profissionais só podem alterar status e observações.' using errcode = 'P0001';
    end if;

    if new.status is distinct from old.status and not (
         (old.status in ('agendado', 'confirmado', 'aguardando_atendimento')
            and new.status in ('em_atendimento', 'faltou'))
      or (old.status = 'em_atendimento' and new.status = 'concluido')
    ) then
      raise exception 'Mudança de status não permitida para profissional (% → %). Fale com a recepção.',
        old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
