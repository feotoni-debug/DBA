-- =============================================================================
-- Clínica DNA — Correções de segurança e consistência do agendamento público
--
--  1. criar_agendamento_publico não sobrescreve mais o contato de um cliente
--     já cadastrado (antes, quem soubesse um CPF podia trocar o WhatsApp/e-mail
--     da vítima e passar a receber as notificações dela).
--  2. Validação de CPF (dígitos verificadores), WhatsApp, e-mail e nome.
--  3. Proteção contra abuso: limite de agendamentos por IP/hora e de
--     agendamentos futuros por CPF; a RPC só pode ser chamada pelo servidor
--     (service_role), que verifica o captcha antes.
--  4. Registro de consentimento (LGPD) a cada agendamento.
--  5. Parâmetros de agendamento (antecedência, janela) num único lugar, lidos
--     pelo site via RPC — antes estavam duplicados no SQL e no TypeScript.
--  6. intervalos_ocupados passa a informar o tipo (agendamento ou bloqueio).
--  7. relatorio_financeiro não duplica o valor do atendimento quando ele tem
--     mais de um pagamento (ex.: um estornado e outro pago).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PARÂMETROS DE AGENDAMENTO (linha única)
-- -----------------------------------------------------------------------------
create table public.parametros_agendamento (
  id                                boolean primary key default true check (id),
  antecedencia_minima_minutos       integer not null default 30 check (antecedencia_minima_minutos >= 0),
  janela_dias                       integer not null default 30 check (janela_dias between 1 and 365),
  max_agendamentos_futuros_por_cpf  integer not null default 3  check (max_agendamentos_futuros_por_cpf >= 1),
  max_agendamentos_por_ip_hora      integer not null default 10 check (max_agendamentos_por_ip_hora >= 1),
  updated_at                        timestamptz not null default now()
);
insert into public.parametros_agendamento (id) values (true);
create trigger parametros_agendamento_updated_at before update on public.parametros_agendamento
  for each row execute function public.set_updated_at();

alter table public.parametros_agendamento enable row level security;
create policy parametros_staff_select on public.parametros_agendamento for select to authenticated
  using (public.is_staff());
create policy parametros_admin_update on public.parametros_agendamento for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Apenas o que o site público precisa para montar o calendário
create or replace function public.parametros_agendamento_publicos()
returns table (antecedencia_minima_minutos integer, janela_dias integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.antecedencia_minima_minutos, p.janela_dias from public.parametros_agendamento p where p.id;
$$;
grant execute on function public.parametros_agendamento_publicos() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- VALIDAÇÃO DE CPF (dígitos verificadores)
-- -----------------------------------------------------------------------------
create or replace function public.cpf_valido(p_cpf text)
returns boolean
language plpgsql
immutable
as $$
declare
  d int[];
  s int;
  r int;
  i int;
begin
  if p_cpf is null or p_cpf !~ '^[0-9]{11}$' or p_cpf = repeat(substr(p_cpf, 1, 1), 11) then
    return false;
  end if;
  d := array(select substr(p_cpf, g, 1)::int from generate_series(1, 11) g);

  s := 0;
  for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  if r <> d[10] then return false; end if;

  s := 0;
  for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  return r = d[11];
end;
$$;

-- NOT VALID: vale para novos cadastros/alterações sem travar dados antigos.
-- Depois de revisar a base, rode: alter table public.clientes validate constraint clientes_cpf_valido;
alter table public.clientes
  add constraint clientes_cpf_valido check (public.cpf_valido(cpf)) not valid;

-- -----------------------------------------------------------------------------
-- CONSENTIMENTOS (LGPD) — trilha de aceite da política de privacidade
-- -----------------------------------------------------------------------------
create table public.consentimentos (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references public.clientes (id) on delete cascade,
  agendamento_id   uuid references public.agendamentos (id) on delete set null,
  versao_politica  text not null,
  finalidade       text not null default 'agendamento',
  aceito_em        timestamptz not null default now(),
  origem_ip_hash   text
);
create index consentimentos_cliente_idx on public.consentimentos (cliente_id, aceito_em desc);

alter table public.consentimentos enable row level security;
create policy consentimentos_admin_select on public.consentimentos for select to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- AGENDAMENTOS: origem (hash do IP) para limitar abuso no canal online
-- -----------------------------------------------------------------------------
alter table public.agendamentos add column origem_ip_hash text;
create index agendamentos_origem_ip_idx on public.agendamentos (origem_ip_hash, created_at)
  where origem_ip_hash is not null;

-- -----------------------------------------------------------------------------
-- INTERVALOS OCUPADOS — agora com o tipo, para o "primeiro disponível" contar
-- só atendimentos (e não bloqueios pessoais) ao distribuir a carga
-- -----------------------------------------------------------------------------
drop function public.intervalos_ocupados(uuid[], timestamptz, timestamptz);
create function public.intervalos_ocupados(
  p_profissional_ids uuid[],
  p_inicio timestamptz,
  p_fim timestamptz
)
returns table (profissional_id uuid, inicio timestamptz, fim timestamptz, tipo text)
language sql
stable
security definer
set search_path = public
as $$
  select a.profissional_id, a.data_hora_inicio, a.ocupado_ate, 'agendamento'::text
  from public.agendamentos a
  where a.profissional_id = any (p_profissional_ids)
    and a.status not in ('cancelado', 'faltou')
    and a.data_hora_inicio < p_fim
    and a.ocupado_ate > p_inicio
  union all
  select b.profissional_id, b.inicio, b.fim, 'bloqueio'::text
  from public.bloqueios_agenda b
  where b.profissional_id = any (p_profissional_ids)
    and b.inicio < p_fim
    and b.fim > p_inicio;
$$;
grant execute on function public.intervalos_ocupados(uuid[], timestamptz, timestamptz) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- CRIAÇÃO DE AGENDAMENTO PÚBLICO (nova versão)
--   * chamada SOMENTE pelo servidor Next.js (service_role), depois do captcha
--   * cliente existente: o contato cadastrado NÃO é alterado; as notificações
--     vão para o contato cadastrado (mudança de contato é feita pela recepção)
-- -----------------------------------------------------------------------------
drop function public.criar_agendamento_publico(
  uuid, uuid, timestamptz, text, text, text, text, public.pagamento_metodo
);

create function public.criar_agendamento_publico(
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
  v_dest_whats  text;
  v_dest_email  text;
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

  -- ---- limite por origem ----------------------------------------------------
  if (
    select count(*) from public.agendamentos a
    where a.origem_ip_hash = p_ip_hash and a.created_at > now() - interval '1 hour'
  ) >= v_par.max_agendamentos_por_ip_hora then
    raise exception 'Muitos agendamentos em pouco tempo. Tente novamente mais tarde.' using errcode = 'P0003';
  end if;

  -- ---- serviço / profissional / horário -------------------------------------
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

  if p_inicio < now() + make_interval(mins => v_par.antecedencia_minima_minutos) then
    raise exception 'Horário muito próximo ou no passado' using errcode = 'P0001';
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

  -- ---- cliente: cria se não existir; NUNCA altera o contato de quem já existe
  select c.id, c.whatsapp, c.email into v_cliente, v_dest_whats, v_dest_email
  from public.clientes c where c.cpf = v_cpf;

  if not found then
    begin
      insert into public.clientes (nome, cpf, whatsapp, email)
      values (v_nome, v_cpf, v_whatsapp, v_email)
      returning id, whatsapp, email into v_cliente, v_dest_whats, v_dest_email;
    exception when unique_violation then
      -- outro pedido com o mesmo CPF entrou ao mesmo tempo
      select c.id, c.whatsapp, c.email into v_cliente, v_dest_whats, v_dest_email
      from public.clientes c where c.cpf = v_cpf;
    end;
  end if;

  if (
    select count(*) from public.agendamentos a
    where a.cliente_id = v_cliente
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
      buffer_minutos, status, canal, valor, origem_ip_hash
    ) values (
      v_cliente, p_profissional_id, p_servico_id, p_inicio,
      p_inicio + make_interval(mins => v_servico.duracao_minutos),
      v_servico.buffer_minutos, 'agendado', 'online', v_servico.preco, p_ip_hash
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

  -- notificações sempre para o contato CADASTRADO
  insert into public.notificacoes (agendamento_id, canal, template, destino)
  values (v_ag, 'whatsapp', 'confirmacao', v_dest_whats);
  if v_dest_email is not null then
    insert into public.notificacoes (agendamento_id, canal, template, destino)
    values (v_ag, 'email', 'confirmacao', v_dest_email);
  end if;
  insert into public.notificacoes (agendamento_id, canal, template, destino, agendar_para)
  values (v_ag, 'whatsapp', 'lembrete_24h', v_dest_whats, p_inicio - interval '24 hours');

  return query select v_ag, v_codigo, v_pag, v_servico.preco;
end;
$$;

revoke execute on function public.criar_agendamento_publico(
  uuid, uuid, timestamptz, text, text, text, text, public.pagamento_metodo, text, text
) from public, anon, authenticated;
grant execute on function public.criar_agendamento_publico(
  uuid, uuid, timestamptz, text, text, text, text, public.pagamento_metodo, text, text
) to service_role;

-- -----------------------------------------------------------------------------
-- RELATÓRIO FINANCEIRO — pagamentos agregados por agendamento antes do join,
-- para o valor do atendimento não ser somado uma vez por pagamento
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
  with pag as (
    select p.agendamento_id,
           sum(p.valor) filter (where p.status = 'pago')     as pago,
           sum(p.valor) filter (where p.status = 'pendente') as pendente
    from public.pagamentos p
    group by p.agendamento_id
  ),
  base as (
    select
      pr.id                    as profissional_id,
      pe.nome                  as profissional_nome,
      pr.comissao_percentual,
      count(a.id)              as atendimentos,
      coalesce(sum(a.valor) filter (where a.status = 'concluido'), 0) as bruto,
      coalesce(sum(pag.pago), 0)                                      as recebido,
      coalesce(sum(pag.pendente), 0)                                  as pendente
    from public.profissionais pr
    join public.perfis pe on pe.id = pr.perfil_id
    left join public.agendamentos a
      on a.profissional_id = pr.id
     and a.data_hora_inicio >= p_inicio and a.data_hora_inicio < p_fim
     and a.status <> 'cancelado'
    left join pag on pag.agendamento_id = a.id
    group by pr.id, pe.nome, pr.comissao_percentual
  )
  select
    b.profissional_id,
    b.profissional_nome,
    b.atendimentos,
    b.bruto,
    b.recebido,
    b.pendente,
    b.comissao_percentual,
    round(b.recebido * b.comissao_percentual / 100, 2),
    round(b.recebido * (1 - b.comissao_percentual / 100), 2)
  from base b
  order by b.profissional_nome;
end;
$$;
