-- =============================================================================
-- Clínica DNA — Correções apontadas na revisão de segurança (conselho)
--
--  1. Contato POR AGENDAMENTO: as mensagens de um agendamento vão só para o
--     contato informado naquele agendamento. Antes, o primeiro a usar um CPF
--     fixava o contato do cadastro e passava a receber os agendamentos
--     (serviço + data = dado de saúde) de quem fosse o verdadeiro dono do CPF.
--     Também some o "oráculo" de CPF: a resposta não depende de o CPF já
--     existir, e o limite por CPF passa a contar só agendamentos feitos com o
--     mesmo contato.
--  2. Horário precisa estar na grade (alinhado ao passo de 10 min) — uma
--     reserva desalinhada ocupava dois horários.
--  3. Limites por IP e por CPF serializados com advisory lock (antes, pedidos
--     paralelos passavam do limite).
--  4. Horário que deixou de estar disponível volta como P0002 (o site recarrega
--     a lista) em vez de P0001.
--  5. Expiração opcional de reservas Pix não pagas.
--  6. Profissional deixa de ler a tabela `clientes` inteira (CPF, nascimento,
--     histórico); o painel usa `agenda_painel`, que devolve só o necessário.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PARÂMETROS: passo da grade e expiração de Pix pendente
-- -----------------------------------------------------------------------------
alter table public.parametros_agendamento
  add column passo_minutos integer not null default 10 check (passo_minutos between 5 and 60),
  add column expira_pix_pendente_minutos integer
    check (expira_pix_pendente_minutos is null or expira_pix_pendente_minutos >= 10);

comment on column public.parametros_agendamento.expira_pix_pendente_minutos is
  'Cancela reservas online com Pix pendente após N minutos. NULL = desligado. '
  'Só ligue depois que o webhook de pagamento estiver confirmando os Pix.';

drop function public.parametros_agendamento_publicos();
create function public.parametros_agendamento_publicos()
returns table (antecedencia_minima_minutos integer, janela_dias integer, passo_minutos integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.antecedencia_minima_minutos, p.janela_dias, p.passo_minutos
  from public.parametros_agendamento p where p.id;
$$;
grant execute on function public.parametros_agendamento_publicos() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- CONTATO INFORMADO EM CADA AGENDAMENTO
-- -----------------------------------------------------------------------------
alter table public.agendamentos
  add column contato_nome      text,
  add column contato_whatsapp  text,
  add column contato_email     text;
create index agendamentos_cliente_contato_idx on public.agendamentos (cliente_id, contato_whatsapp)
  where canal = 'online';

-- -----------------------------------------------------------------------------
-- CRIAÇÃO DE AGENDAMENTO PÚBLICO (mesma assinatura da 0004)
-- -----------------------------------------------------------------------------
create or replace function public.criar_agendamento_publico(
  p_servico_id            uuid,
  p_profissional_id       uuid,
  p_inicio                timestamptz,
  p_nome                  text,
  p_cpf                   text,
  p_whatsapp              text,
  p_email                 text,
  p_metodo_pagamento      public.pagamento_metodo,
  p_consentimento_versao  text,
  p_ip_hash               text
)
returns table (agendamento_id uuid, codigo text, pagamento_id uuid, valor numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_par         public.parametros_agendamento%rowtype;
  v_servico     public.servicos%rowtype;
  v_cpf         text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_whatsapp    text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_email       text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_nome        text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_cliente     uuid;
  v_ag          uuid;
  v_codigo      text;
  v_pag         uuid;
  v_dow         smallint;
  v_hora_ini    time;
  v_hora_fim    time;
begin
  select * into v_par from public.parametros_agendamento where id;

  -- ---- validação dos dados digitados -------------------------------------
  if char_length(v_nome) not between 2 and 120 then
    raise exception 'Informe o nome completo' using errcode = 'P0001';
  end if;
  if not public.cpf_valido(v_cpf) then
    raise exception 'CPF inválido' using errcode = 'P0001';
  end if;
  if v_whatsapp !~ '^[1-9][0-9]{9,10}$' then
    raise exception 'WhatsApp inválido: informe DDD + número' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail inválido' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_consentimento_versao), '') = '' then
    raise exception 'É necessário aceitar a política de privacidade' using errcode = 'P0001';
  end if;
  if coalesce(p_ip_hash, '') = '' then
    raise exception 'Origem da requisição ausente' using errcode = 'P0001';
  end if;

  -- ---- limite por origem (serializado: pedidos paralelos não furam o limite)
  perform pg_advisory_xact_lock(hashtextextended('agendamento:ip:' || p_ip_hash, 0));
  if (
    select count(*) from public.agendamentos a
    where a.origem_ip_hash = p_ip_hash and a.created_at > now() - interval '1 hour'
  ) >= v_par.max_agendamentos_por_ip_hora then
    raise exception 'Muitos agendamentos em pouco tempo. Tente novamente mais tarde.' using errcode = 'P0003';
  end if;

  -- ---- serviço / profissional ---------------------------------------------------
  select * into v_servico from public.servicos where id = p_servico_id and ativo;
  if not found then
    raise exception 'Serviço indisponível' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.servicos_profissionais sp
    join public.profissionais pr on pr.id = sp.profissional_id
    join public.perfis pe on pe.id = pr.perfil_id
    where sp.servico_id = p_servico_id and sp.profissional_id = p_profissional_id and pe.ativo
  ) then
    raise exception 'Profissional não atende este serviço' using errcode = 'P0001';
  end if;

  -- ---- horário (P0002 = "não está mais disponível": o site recarrega a lista)
  if p_inicio < now() + make_interval(mins => v_par.antecedencia_minima_minutos) then
    raise exception 'Este horário não está mais disponível. Escolha outro.' using errcode = 'P0002';
  end if;
  if p_inicio > now() + make_interval(days => v_par.janela_dias) then
    raise exception 'Data além do período disponível para agendamento online' using errcode = 'P0001';
  end if;

  v_dow      := extract(dow from p_inicio at time zone 'America/Sao_Paulo');
  v_hora_ini := (p_inicio at time zone 'America/Sao_Paulo')::time;
  v_hora_fim := ((p_inicio + make_interval(mins => v_servico.duracao_minutos))
                 at time zone 'America/Sao_Paulo')::time;

  if v_hora_fim <= v_hora_ini or not exists (
    select 1 from public.horarios_trabalho h
    where h.profissional_id = p_profissional_id
      and h.dia_semana = v_dow
      and h.hora_inicio <= v_hora_ini
      and h.hora_fim >= v_hora_fim
  ) then
    raise exception 'Este horário não está mais disponível. Escolha outro.' using errcode = 'P0002';
  end if;

  -- precisa cair na grade oferecida pelo site (início da janela + n × passo)
  if not exists (
    select 1 from public.horarios_trabalho h
    where h.profissional_id = p_profissional_id
      and h.dia_semana = v_dow
      and h.hora_inicio <= v_hora_ini
      and h.hora_fim >= v_hora_fim
      and mod(extract(epoch from (v_hora_ini - h.hora_inicio)), v_par.passo_minutos * 60) = 0
  ) then
    raise exception 'Horário inválido' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.bloqueios_agenda b
    where b.profissional_id = p_profissional_id
      and b.inicio < p_inicio + make_interval(mins => v_servico.duracao_minutos + v_servico.buffer_minutos)
      and b.fim > p_inicio
  ) then
    raise exception 'Este horário não está mais disponível. Escolha outro.' using errcode = 'P0002';
  end if;

  -- ---- cliente: cria se não existir; nunca altera um cadastro existente -------
  perform pg_advisory_xact_lock(hashtextextended('agendamento:cpf:' || v_cpf, 0));

  select c.id into v_cliente from public.clientes c where c.cpf = v_cpf;
  if not found then
    insert into public.clientes (nome, cpf, whatsapp, email)
    values (v_nome, v_cpf, v_whatsapp, v_email)
    returning id into v_cliente;
  end if;

  -- Limite por CPF conta só os agendamentos feitos com ESTE contato: quem usa o
  -- CPF de outra pessoa não bloqueia o dono, e a mensagem não revela nada sobre
  -- agendamentos que o próprio solicitante não fez.
  if (
    select count(*) from public.agendamentos a
    where a.cliente_id = v_cliente
      and a.contato_whatsapp = v_whatsapp
      and a.canal = 'online'
      and a.data_hora_inicio > now()
      and a.status not in ('cancelado', 'faltou', 'concluido')
  ) >= v_par.max_agendamentos_futuros_por_cpf then
    raise exception 'Limite de agendamentos online atingido. Fale com a recepção pelo WhatsApp.'
      using errcode = 'P0003';
  end if;

  -- ---- agendamento -------------------------------------------------------------
  begin
    insert into public.agendamentos (
      cliente_id, profissional_id, servico_id, data_hora_inicio, data_hora_fim,
      buffer_minutos, status, canal, valor, origem_ip_hash,
      contato_nome, contato_whatsapp, contato_email
    ) values (
      v_cliente, p_profissional_id, p_servico_id, p_inicio,
      p_inicio + make_interval(mins => v_servico.duracao_minutos),
      v_servico.buffer_minutos, 'agendado', 'online', v_servico.preco, p_ip_hash,
      v_nome, v_whatsapp, v_email
    )
    returning id, agendamentos.codigo into v_ag, v_codigo;
  exception when exclusion_violation then
    raise exception 'Este horário acabou de ser reservado. Escolha outro.' using errcode = 'P0002';
  end;

  insert into public.consentimentos (cliente_id, agendamento_id, versao_politica, origem_ip_hash)
  values (v_cliente, v_ag, trim(p_consentimento_versao), p_ip_hash);

  insert into public.pagamentos (agendamento_id, valor, metodo, status, origem)
  values (
    v_ag, v_servico.preco, p_metodo_pagamento, 'pendente',
    case when p_metodo_pagamento = 'pix' then 'online' else 'presencial' end::public.pagamento_origem
  )
  returning id into v_pag;

  -- notificações SÓ para o contato informado neste agendamento
  insert into public.notificacoes (agendamento_id, canal, template, destino)
  values (v_ag, 'whatsapp', 'confirmacao', v_whatsapp);
  if v_email is not null then
    insert into public.notificacoes (agendamento_id, canal, template, destino)
    values (v_ag, 'email', 'confirmacao', v_email);
  end if;
  insert into public.notificacoes (agendamento_id, canal, template, destino, agendar_para)
  values (v_ag, 'whatsapp', 'lembrete_24h', v_whatsapp, p_inicio - interval '24 hours');

  return query select v_ag, v_codigo, v_pag, v_servico.preco;
end;
$$;

-- -----------------------------------------------------------------------------
-- Confirmação de pagamento: avisa o contato do AGENDAMENTO
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
    select v_ag, 'whatsapp', 'pagamento_aprovado', coalesce(a.contato_whatsapp, c.whatsapp)
    from public.agendamentos a join public.clientes c on c.id = a.cliente_id
    where a.id = v_ag;
  end if;
  return v_pag;
end;
$$;
revoke execute on function public.confirmar_pagamento_externo(text, public.pagamento_status) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- EXPIRAÇÃO DE RESERVAS PIX NÃO PAGAS (desligada até configurar o parâmetro)
-- Agendar com pg_cron, por exemplo:
--   select cron.schedule('expirar-pix', '*/5 * * * *',
--                        $c$select public.expirar_reservas_pix_pendentes()$c$);
-- -----------------------------------------------------------------------------
create or replace function public.expirar_reservas_pix_pendentes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min integer;
  v_n   integer;
begin
  select expira_pix_pendente_minutos into v_min from public.parametros_agendamento where id;
  if v_min is null then
    return 0;
  end if;

  with alvo as (
    select a.id
    from public.agendamentos a
    join public.pagamentos p on p.agendamento_id = a.id
    where a.canal = 'online'
      and a.status = 'agendado'
      and p.metodo = 'pix'
      and p.status = 'pendente'
      and a.created_at < now() - make_interval(mins => v_min)
  ),
  cancelados as (
    update public.agendamentos a
       set status = 'cancelado',
           observacoes = concat_ws(' | ', a.observacoes, 'Cancelado automaticamente: Pix não pago no prazo')
     where a.id in (select id from alvo)
    returning a.id
  ),
  limpa as (
    delete from public.notificacoes n
     where n.agendamento_id in (select id from cancelados) and n.enviado_em is null
  )
  select count(*) into v_n from cancelados;

  return v_n;
end;
$$;
revoke execute on function public.expirar_reservas_pix_pendentes() from public, anon, authenticated;
grant execute on function public.expirar_reservas_pix_pendentes() to service_role;

-- -----------------------------------------------------------------------------
-- PAINEL: profissional não lê mais a tabela de clientes
-- -----------------------------------------------------------------------------
drop policy clientes_profissional_select on public.clientes;

-- Agenda do painel com as colunas que cada papel pode ver:
--   admin/recepção → tudo do dia, valor, pagamento, aviso de contato divergente
--   profissional   → só os próprios atendimentos, nome do paciente e WhatsApp
--                    do agendamento (sem CPF, e-mail, nascimento, histórico,
--                    valor ou pagamento)
create or replace function public.agenda_painel(p_inicio timestamptz, p_fim timestamptz)
returns table (
  id                  uuid,
  codigo              text,
  data_hora_inicio    timestamptz,
  data_hora_fim       timestamptz,
  status              public.agendamento_status,
  canal               public.agendamento_canal,
  valor               numeric,
  observacoes         text,
  paciente_nome       text,
  contato_whatsapp    text,
  contato_divergente  boolean,
  servico_nome        text,
  profissional_nome   text,
  pagamento_status    public.pagamento_status
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role public.user_role := public.auth_role();
  v_prof uuid := public.auth_profissional_id();
  v_staff boolean := v_role in ('admin', 'recepcao');
begin
  if v_role is null then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_fim <= p_inicio or p_fim - p_inicio > interval '31 days' then
    raise exception 'Período inválido' using errcode = '22023';
  end if;

  return query
  select
    a.id,
    a.codigo,
    a.data_hora_inicio,
    a.data_hora_fim,
    a.status,
    a.canal,
    case when v_staff then a.valor end,
    a.observacoes,
    c.nome,
    coalesce(a.contato_whatsapp, c.whatsapp),
    v_staff and a.contato_whatsapp is not null and a.contato_whatsapp <> c.whatsapp,
    s.nome,
    pe.nome,
    case when v_staff then (
      select p.status from public.pagamentos p
      where p.agendamento_id = a.id
      order by p.created_at desc
      limit 1
    ) end
  from public.agendamentos a
  join public.clientes c       on c.id = a.cliente_id
  join public.servicos s       on s.id = a.servico_id
  join public.profissionais pr on pr.id = a.profissional_id
  join public.perfis pe        on pe.id = pr.perfil_id
  where a.data_hora_inicio >= p_inicio
    and a.data_hora_inicio < p_fim
    and (v_staff or (v_prof is not null and a.profissional_id = v_prof))
  order by a.data_hora_inicio;
end;
$$;
revoke execute on function public.agenda_painel(timestamptz, timestamptz) from public, anon;
grant execute on function public.agenda_painel(timestamptz, timestamptz) to authenticated;
