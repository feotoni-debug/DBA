-- =============================================================================
-- Clínica DNA — Schema principal (Supabase / PostgreSQL 15+)
-- Tabelas, enums, relacionamentos, índices, triggers e funções de apoio.
-- As políticas RLS ficam em 20261112000002_rls.sql.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";   -- exclusão de sobreposição de horários

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'recepcao', 'profissional');

create type public.agendamento_status as enum (
  'agendado',
  'confirmado',
  'aguardando_atendimento',
  'em_atendimento',
  'concluido',
  'faltou',
  'cancelado'
);

create type public.agendamento_canal as enum ('online', 'balcao');

create type public.pagamento_metodo as enum (
  'pix',
  'cartao_credito',
  'cartao_debito',
  'dinheiro',
  'faturado'
);

create type public.pagamento_status as enum ('pendente', 'pago', 'estornado');

create type public.pagamento_origem as enum ('online', 'presencial');

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- PERFIS (1:1 com auth.users)
-- -----------------------------------------------------------------------------
create table public.perfis (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  nome        text not null check (char_length(nome) between 2 and 120),
  email       text not null,
  telefone    text,
  role        public.user_role not null default 'recepcao',
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index perfis_role_idx on public.perfis (role) where ativo;
create trigger perfis_updated_at before update on public.perfis
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- PROFISSIONAIS
-- -----------------------------------------------------------------------------
create table public.profissionais (
  id                     uuid primary key default gen_random_uuid(),
  perfil_id              uuid not null unique references public.perfis (id) on delete cascade,
  registro_profissional  text,                       -- CRM, CRP, CREFITO, CRN...
  especialidades         text[] not null default '{}',
  bio                    text,
  foto_url               text,
  comissao_percentual    numeric(5,2) not null default 50
                           check (comissao_percentual between 0 and 100),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger profissionais_updated_at before update on public.profissionais
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- HORÁRIOS DE TRABALHO (várias janelas por dia permitidas, ex.: manhã e tarde)
-- dia_semana: 0 = domingo ... 6 = sábado (mesmo padrão de Date.getDay())
-- -----------------------------------------------------------------------------
create table public.horarios_trabalho (
  id               uuid primary key default gen_random_uuid(),
  profissional_id  uuid not null references public.profissionais (id) on delete cascade,
  dia_semana       smallint not null check (dia_semana between 0 and 6),
  hora_inicio      time not null,
  hora_fim         time not null,
  check (hora_fim > hora_inicio)
);
create index horarios_trabalho_prof_dia_idx on public.horarios_trabalho (profissional_id, dia_semana);

-- Impede janelas sobrepostas para o mesmo profissional no mesmo dia
alter table public.horarios_trabalho
  add constraint horarios_trabalho_sem_sobreposicao
  exclude using gist (
    profissional_id with =,
    dia_semana with =,
    tsrange(('2000-01-01'::date + hora_inicio), ('2000-01-01'::date + hora_fim)) with &&
  );

-- -----------------------------------------------------------------------------
-- SERVIÇOS
-- -----------------------------------------------------------------------------
create table public.servicos (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  descricao         text,
  especialidade     text,
  duracao_minutos   integer not null check (duracao_minutos between 5 and 480),
  preco             numeric(10,2) not null check (preco >= 0),
  buffer_minutos    integer not null default 10 check (buffer_minutos between 0 and 120),
  ativo             boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger servicos_updated_at before update on public.servicos
  for each row execute function public.set_updated_at();

create table public.servicos_profissionais (
  servico_id       uuid not null references public.servicos (id) on delete cascade,
  profissional_id  uuid not null references public.profissionais (id) on delete cascade,
  primary key (servico_id, profissional_id)
);
create index servicos_profissionais_prof_idx on public.servicos_profissionais (profissional_id);

-- -----------------------------------------------------------------------------
-- CLIENTES (CRM)
-- -----------------------------------------------------------------------------
create table public.clientes (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null,
  cpf                    char(11) not null unique check (cpf ~ '^[0-9]{11}$'),
  whatsapp               text not null,
  email                  text,
  data_nascimento        date,
  historico_observacoes  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index clientes_nome_idx on public.clientes using gin (to_tsvector('portuguese', nome));
create trigger clientes_updated_at before update on public.clientes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- AGENDAMENTOS
-- data_hora_fim = início + duração do serviço (horário que o paciente vê).
-- buffer_minutos é copiado do serviço no momento da criação (snapshot), e a
-- restrição de exclusão garante, no próprio banco, que nenhum profissional
-- receba dois atendimentos sobrepostos (considerando a higienização).
-- -----------------------------------------------------------------------------
create table public.agendamentos (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null unique
                      default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  cliente_id        uuid not null references public.clientes (id) on delete restrict,
  profissional_id   uuid not null references public.profissionais (id) on delete restrict,
  servico_id        uuid not null references public.servicos (id) on delete restrict,
  data_hora_inicio  timestamptz not null,
  data_hora_fim     timestamptz not null,
  buffer_minutos    integer not null default 10,
  ocupado_ate       timestamptz not null,       -- data_hora_fim + buffer (via trigger)
  status           public.agendamento_status not null default 'agendado',
  canal             public.agendamento_canal not null default 'online',
  valor             numeric(10,2) not null,                 -- snapshot do preço
  observacoes       text,
  checkin_em        timestamptz,
  criado_por        uuid references public.perfis (id),    -- null = paciente online
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (data_hora_fim > data_hora_inicio),
  -- bloco ocupado (atendimento + buffer), só para status "ativos"
  constraint agendamentos_sem_conflito exclude using gist (
    profissional_id with =,
    tstzrange(data_hora_inicio, ocupado_ate, '[)') with &&
  ) where (status not in ('cancelado', 'faltou'))
);

-- timestamptz + interval não é IMMUTABLE, então o fim ocupado é calculado aqui
create or replace function public.agendamentos_calcula_ocupacao()
returns trigger
language plpgsql
as $$
begin
  new.ocupado_ate := new.data_hora_fim + make_interval(mins => new.buffer_minutos);
  return new;
end;
$$;
create trigger agendamentos_ocupacao
  before insert or update of data_hora_fim, buffer_minutos on public.agendamentos
  for each row execute function public.agendamentos_calcula_ocupacao();
create index agendamentos_prof_inicio_idx on public.agendamentos (profissional_id, data_hora_inicio);
create index agendamentos_inicio_idx on public.agendamentos (data_hora_inicio);
create index agendamentos_cliente_idx on public.agendamentos (cliente_id);
create index agendamentos_status_idx on public.agendamentos (status);
create trigger agendamentos_updated_at before update on public.agendamentos
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- BLOQUEIOS DE AGENDA (indisponibilidade pessoal do profissional)
-- -----------------------------------------------------------------------------
create table public.bloqueios_agenda (
  id               uuid primary key default gen_random_uuid(),
  profissional_id  uuid not null references public.profissionais (id) on delete cascade,
  inicio           timestamptz not null,
  fim              timestamptz not null,
  motivo           text,
  created_at       timestamptz not null default now(),
  check (fim > inicio)
);
create index bloqueios_prof_inicio_idx on public.bloqueios_agenda (profissional_id, inicio);

-- -----------------------------------------------------------------------------
-- PAGAMENTOS
-- -----------------------------------------------------------------------------
create table public.pagamentos (
  id                    uuid primary key default gen_random_uuid(),
  agendamento_id        uuid not null references public.agendamentos (id) on delete cascade,
  valor                 numeric(10,2) not null check (valor >= 0),
  metodo                public.pagamento_metodo not null,
  status                public.pagamento_status not null default 'pendente',
  origem                public.pagamento_origem not null default 'presencial',
  transacao_externa_id  text unique,             -- id no Mercado Pago / Asaas
  pix_copia_cola        text,
  pix_qr_base64         text,
  pago_em               timestamptz,
  registrado_por        uuid references public.perfis (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index pagamentos_agendamento_idx on public.pagamentos (agendamento_id);
create index pagamentos_status_idx on public.pagamentos (status, created_at);
create trigger pagamentos_updated_at before update on public.pagamentos
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- WEBHOOK LOG (idempotência de eventos de gateway)
-- -----------------------------------------------------------------------------
create table public.webhook_eventos (
  id           text primary key,      -- id do evento no provedor
  provedor     text not null,         -- 'mercadopago' | 'asaas'
  payload      jsonb not null,
  processado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- FILA DE NOTIFICAÇÕES (WhatsApp / e-mail) consumida por worker/Edge Function
-- -----------------------------------------------------------------------------
create table public.notificacoes (
  id              uuid primary key default gen_random_uuid(),
  agendamento_id  uuid references public.agendamentos (id) on delete cascade,
  canal           text not null check (canal in ('whatsapp', 'email')),
  template        text not null,       -- 'confirmacao', 'lembrete_24h', 'pagamento_aprovado'...
  destino         text not null,
  agendar_para    timestamptz not null default now(),
  enviado_em      timestamptz,
  erro            text,
  created_at      timestamptz not null default now()
);
create index notificacoes_pendentes_idx on public.notificacoes (agendar_para) where enviado_em is null;
