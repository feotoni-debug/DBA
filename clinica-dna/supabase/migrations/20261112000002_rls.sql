-- =============================================================================
-- Clínica DNA — Row Level Security
--
-- Matriz de acesso:
--   admin        → tudo
--   recepcao     → agenda, clientes, pagamentos (registro). Sem relatórios
--                  financeiros consolidados / comissões.
--   profissional → somente a própria agenda, os próprios bloqueios e os
--                  pacientes agendados consigo.
--   anon         → catálogo público (serviços ativos) e RPCs de agendamento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funções auxiliares (SECURITY DEFINER para não recursar nas próprias policies)
-- -----------------------------------------------------------------------------
create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.perfis
  where user_id = auth.uid() and ativo
  limit 1;
$$;

create or replace function public.auth_perfil_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.perfis where user_id = auth.uid() and ativo limit 1;
$$;

create or replace function public.auth_profissional_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pr.id
  from public.profissionais pr
  join public.perfis pe on pe.id = pr.perfil_id
  where pe.user_id = auth.uid() and pe.ativo
  limit 1;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
as $$ select public.auth_role() in ('admin', 'recepcao'); $$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$ select public.auth_role() = 'admin'; $$;

-- -----------------------------------------------------------------------------
-- Habilita RLS em todas as tabelas
-- -----------------------------------------------------------------------------
alter table public.perfis                 enable row level security;
alter table public.profissionais          enable row level security;
alter table public.horarios_trabalho      enable row level security;
alter table public.servicos               enable row level security;
alter table public.servicos_profissionais enable row level security;
alter table public.clientes               enable row level security;
alter table public.agendamentos           enable row level security;
alter table public.bloqueios_agenda       enable row level security;
alter table public.pagamentos             enable row level security;
alter table public.webhook_eventos        enable row level security;  -- só service_role
alter table public.notificacoes           enable row level security;  -- só service_role

-- -----------------------------------------------------------------------------
-- PERFIS
-- -----------------------------------------------------------------------------
create policy perfis_select on public.perfis for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy perfis_admin_write on public.perfis for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- O próprio usuário pode atualizar nome/telefone (role e ativo são protegidos
-- pelo trigger abaixo).
create policy perfis_self_update on public.perfis for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.perfis_protege_campos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() and auth.uid() is not null then
    if new.role is distinct from old.role or new.ativo is distinct from old.ativo
       or new.user_id is distinct from old.user_id then
      raise exception 'Somente o administrador pode alterar cargo ou status.';
    end if;
  end if;
  return new;
end;
$$;
create trigger perfis_protege before update on public.perfis
  for each row execute function public.perfis_protege_campos();

-- -----------------------------------------------------------------------------
-- PROFISSIONAIS
-- -----------------------------------------------------------------------------
create policy profissionais_select on public.profissionais for select to authenticated
  using (public.is_staff() or id = public.auth_profissional_id());

create policy profissionais_admin_write on public.profissionais for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- HORÁRIOS DE TRABALHO (grade não é dado sensível → leitura pública)
-- -----------------------------------------------------------------------------
create policy horarios_select on public.horarios_trabalho for select to anon, authenticated
  using (true);

create policy horarios_admin_write on public.horarios_trabalho for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- SERVIÇOS
-- -----------------------------------------------------------------------------
create policy servicos_public_select on public.servicos for select to anon
  using (ativo);

create policy servicos_auth_select on public.servicos for select to authenticated
  using (ativo or public.is_staff());

create policy servicos_admin_write on public.servicos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy sp_select on public.servicos_profissionais for select to anon, authenticated
  using (true);

create policy sp_admin_write on public.servicos_profissionais for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- CLIENTES
-- -----------------------------------------------------------------------------
create policy clientes_staff_all on public.clientes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy clientes_profissional_select on public.clientes for select to authenticated
  using (
    public.auth_role() = 'profissional'
    and exists (
      select 1 from public.agendamentos a
      where a.cliente_id = clientes.id
        and a.profissional_id = public.auth_profissional_id()
    )
  );

-- -----------------------------------------------------------------------------
-- AGENDAMENTOS
-- -----------------------------------------------------------------------------
create policy agendamentos_staff_all on public.agendamentos for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy agendamentos_prof_select on public.agendamentos for select to authenticated
  using (profissional_id = public.auth_profissional_id());

-- Profissional pode avançar o status dos próprios atendimentos
create policy agendamentos_prof_update on public.agendamentos for update to authenticated
  using (profissional_id = public.auth_profissional_id())
  with check (profissional_id = public.auth_profissional_id());

-- Profissional só altera status/observações (não move horário nem troca paciente)
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
    or new.valor           is distinct from old.valor then
      raise exception 'Profissionais só podem alterar status e observações.';
    end if;
  end if;
  return new;
end;
$$;
create trigger agendamentos_protege_prof before update on public.agendamentos
  for each row execute function public.agendamentos_protege_campos_profissional();

-- -----------------------------------------------------------------------------
-- BLOQUEIOS DE AGENDA
-- -----------------------------------------------------------------------------
create policy bloqueios_staff_all on public.bloqueios_agenda for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy bloqueios_prof_all on public.bloqueios_agenda for all to authenticated
  using (profissional_id = public.auth_profissional_id())
  with check (profissional_id = public.auth_profissional_id());

-- -----------------------------------------------------------------------------
-- PAGAMENTOS
--   admin: tudo. recepcao: ver/registrar/atualizar (sem delete).
--   profissional: nenhum acesso direto (vê apenas o próprio repasse via RPC).
-- -----------------------------------------------------------------------------
create policy pagamentos_admin_all on public.pagamentos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy pagamentos_recepcao_select on public.pagamentos for select to authenticated
  using (public.auth_role() = 'recepcao');

create policy pagamentos_recepcao_insert on public.pagamentos for insert to authenticated
  with check (public.auth_role() = 'recepcao');

create policy pagamentos_recepcao_update on public.pagamentos for update to authenticated
  using (public.auth_role() = 'recepcao') with check (public.auth_role() = 'recepcao');

-- webhook_eventos / notificacoes: sem policies → apenas service_role acessa.
