-- =============================================================================
-- Clínica DNA — RPCs (funções expostas via supabase.rpc)
-- O site público nunca lê `agendamentos` ou `clientes` diretamente: usa estas
-- funções SECURITY DEFINER, que devolvem somente o necessário.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Profissionais habilitados para um serviço (dados públicos apenas)
-- -----------------------------------------------------------------------------
create or replace function public.profissionais_do_servico(p_servico_id uuid)
returns table (
  id uuid,
  nome text,
  registro_profissional text,
  especialidades text[],
  bio text,
  foto_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select pr.id, pe.nome, pr.registro_profissional, pr.especialidades, pr.bio, pr.foto_url
  from public.servicos_profissionais sp
  join public.profissionais pr on pr.id = sp.profissional_id
  join public.perfis pe on pe.id = pr.perfil_id
  where sp.servico_id = p_servico_id and pe.ativo
  order by pe.nome;
$$;

-- -----------------------------------------------------------------------------
-- Intervalos ocupados (agendamentos ativos + bloqueios) — sem dados do paciente
-- -----------------------------------------------------------------------------
create or replace function public.intervalos_ocupados(
  p_profissional_ids uuid[],
  p_inicio timestamptz,
  p_fim timestamptz
)
returns table (profissional_id uuid, inicio timestamptz, fim timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.profissional_id, a.data_hora_inicio, a.ocupado_ate
  from public.agendamentos a
  where a.profissional_id = any (p_profissional_ids)
    and a.status not in ('cancelado', 'faltou')
    and a.data_hora_inicio < p_fim
    and a.ocupado_ate > p_inicio
  union all
  select b.profissional_id, b.inicio, b.fim
  from public.bloqueios_agenda b
  where b.profissional_id = any (p_profissional_ids)
    and b.inicio < p_fim
    and b.fim > p_inicio;
$$;

-- -----------------------------------------------------------------------------
-- Criação de agendamento pelo site público
--   * upsert do cliente pelo CPF
--   * snapshot de duração / buffer / preço do serviço
--   * a constraint de exclusão rejeita conflitos (corrida entre dois pacientes)
--   * cria o pagamento pendente e enfileira a notificação
-- -----------------------------------------------------------------------------
create or replace function public.criar_agendamento_publico(
  p_servico_id uuid,
  p_profissional_id uuid,
  p_inicio timestamptz,
  p_nome text,
  p_cpf text,
  p_whatsapp text,
  p_email text,
  p_metodo_pagamento public.pagamento_metodo
)
returns table (agendamento_id uuid, codigo text, pagamento_id uuid, valor numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_servico   public.servicos%rowtype;
  v_cliente   uuid;
  v_ag        uuid;
  v_codigo    text;
  v_pag       uuid;
  v_dow       smallint;
  v_hora_ini  time;
  v_hora_fim  time;
begin
  select * into v_servico from public.servicos where id = p_servico_id and ativo;
  if not found then
    raise exception 'Serviço indisponível' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.servicos_profissionais
    where servico_id = p_servico_id and profissional_id = p_profissional_id
  ) then
    raise exception 'Profissional não atende este serviço' using errcode = 'P0001';
  end if;

  if p_inicio < now() + interval '30 minutes' then
    raise exception 'Horário muito próximo ou no passado' using errcode = 'P0001';
  end if;

  -- Confere se cabe dentro da grade de trabalho (no fuso da clínica)
  v_dow      := extract(dow from p_inicio at time zone 'America/Sao_Paulo');
  v_hora_ini := (p_inicio at time zone 'America/Sao_Paulo')::time;
  v_hora_fim := ((p_inicio + make_interval(mins => v_servico.duracao_minutos))
                 at time zone 'America/Sao_Paulo')::time;
  if not exists (
    select 1 from public.horarios_trabalho h
    where h.profissional_id = p_profissional_id
      and h.dia_semana = v_dow
      and h.hora_inicio <= v_hora_ini
      and h.hora_fim >= v_hora_fim
  ) then
    raise exception 'Fora do horário de atendimento' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.bloqueios_agenda b
    where b.profissional_id = p_profissional_id
      and b.inicio < p_inicio + make_interval(mins => v_servico.duracao_minutos + v_servico.buffer_minutos)
      and b.fim > p_inicio
  ) then
    raise exception 'Horário indisponível' using errcode = 'P0001';
  end if;

  insert into public.clientes (nome, cpf, whatsapp, email)
  values (trim(p_nome), regexp_replace(p_cpf, '\D', '', 'g'), p_whatsapp, nullif(lower(trim(p_email)), ''))
  on conflict (cpf) do update
    set whatsapp = excluded.whatsapp,
        email    = coalesce(excluded.email, public.clientes.email)
  returning id into v_cliente;

  begin
    insert into public.agendamentos (
      cliente_id, profissional_id, servico_id, data_hora_inicio, data_hora_fim,
      buffer_minutos, status, canal, valor
    ) values (
      v_cliente, p_profissional_id, p_servico_id, p_inicio,
      p_inicio + make_interval(mins => v_servico.duracao_minutos),
      v_servico.buffer_minutos, 'agendado', 'online', v_servico.preco
    )
    returning id, agendamentos.codigo into v_ag, v_codigo;
  exception when exclusion_violation then
    raise exception 'Este horário acabou de ser reservado. Escolha outro.' using errcode = 'P0002';
  end;

  insert into public.pagamentos (agendamento_id, valor, metodo, status, origem)
  values (
    v_ag, v_servico.preco, p_metodo_pagamento, 'pendente',
    case when p_metodo_pagamento = 'pix' then 'online' else 'presencial' end::public.pagamento_origem
  )
  returning id into v_pag;

  insert into public.notificacoes (agendamento_id, canal, template, destino)
  values (v_ag, 'whatsapp', 'confirmacao', p_whatsapp);
  if p_email is not null and p_email <> '' then
    insert into public.notificacoes (agendamento_id, canal, template, destino)
    values (v_ag, 'email', 'confirmacao', lower(p_email));
  end if;
  insert into public.notificacoes (agendamento_id, canal, template, destino, agendar_para)
  values (v_ag, 'whatsapp', 'lembrete_24h', p_whatsapp, p_inicio - interval '24 hours');

  return query select v_ag, v_codigo, v_pag, v_servico.preco;
end;
$$;

grant execute on function public.profissionais_do_servico(uuid) to anon, authenticated;
grant execute on function public.intervalos_ocupados(uuid[], timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.criar_agendamento_publico(uuid, uuid, timestamptz, text, text, text, text, public.pagamento_metodo) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Relatório financeiro — SOMENTE ADMIN
-- bruto, comissão (repasse) e líquido por profissional no período
-- -----------------------------------------------------------------------------
create or replace function public.relatorio_financeiro(p_inicio timestamptz, p_fim timestamptz)
returns table (
  profissional_id uuid,
  profissional_nome text,
  atendimentos bigint,
  faturamento_bruto numeric,
  recebido numeric,
  pendente numeric,
  comissao_percentual numeric,
  repasse numeric,
  liquido_clinica numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  return query
  select
    pr.id,
    pe.nome,
    count(distinct a.id),
    coalesce(sum(a.valor) filter (where a.status = 'concluido'), 0),
    coalesce(sum(p.valor) filter (where p.status = 'pago'), 0),
    coalesce(sum(p.valor) filter (where p.status = 'pendente'), 0),
    pr.comissao_percentual,
    round(coalesce(sum(p.valor) filter (where p.status = 'pago'), 0) * pr.comissao_percentual / 100, 2),
    round(coalesce(sum(p.valor) filter (where p.status = 'pago'), 0) * (1 - pr.comissao_percentual / 100), 2)
  from public.profissionais pr
  join public.perfis pe on pe.id = pr.perfil_id
  left join public.agendamentos a
    on a.profissional_id = pr.id
   and a.data_hora_inicio >= p_inicio and a.data_hora_inicio < p_fim
   and a.status <> 'cancelado'
  left join public.pagamentos p on p.agendamento_id = a.id
  group by pr.id, pe.nome, pr.comissao_percentual
  order by pe.nome;
end;
$$;
grant execute on function public.relatorio_financeiro(timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Confirmação de pagamento vinda do webhook (chamada com service_role)
-- -----------------------------------------------------------------------------
create or replace function public.confirmar_pagamento_externo(
  p_transacao_externa_id text,
  p_status public.pagamento_status
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pag uuid;
  v_ag  uuid;
begin
  update public.pagamentos
     set status = p_status,
         pago_em = case when p_status = 'pago' then now() else pago_em end
   where transacao_externa_id = p_transacao_externa_id
  returning id, agendamento_id into v_pag, v_ag;

  if v_pag is not null and p_status = 'pago' then
    update public.agendamentos set status = 'confirmado'
     where id = v_ag and status = 'agendado';
    insert into public.notificacoes (agendamento_id, canal, template, destino)
    select v_ag, 'whatsapp', 'pagamento_aprovado', c.whatsapp
    from public.agendamentos a join public.clientes c on c.id = a.cliente_id
    where a.id = v_ag;
  end if;
  return v_pag;
end;
$$;
revoke execute on function public.confirmar_pagamento_externo(text, public.pagamento_status) from public, anon, authenticated;
