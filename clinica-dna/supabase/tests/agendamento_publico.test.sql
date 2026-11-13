-- =============================================================================
-- Testes das regras de agendamento público e do relatório financeiro.
--
-- Roda dentro de uma transação e desfaz tudo no final (ROLLBACK).
-- Com o Supabase local:
--   supabase db reset
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/agendamento_publico.test.sql
-- Qualquer falha aborta com "FALHOU: ...". Sucesso imprime "TODOS OS TESTES PASSARAM".
-- =============================================================================
begin;

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin.teste@exemplo.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'prof.teste@exemplo.com');
insert into public.perfis (id, user_id, nome, email, role) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'Admin Teste', 'admin.teste@exemplo.com', 'admin'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'Dra. Teste', 'prof.teste@exemplo.com', 'profissional');
insert into public.profissionais (id, perfil_id, comissao_percentual) values
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 40);
insert into public.horarios_trabalho (profissional_id, dia_semana, hora_inicio, hora_fim)
select '20000000-0000-0000-0000-0000000000b1', d, '08:00', '18:00' from generate_series(1, 5) d;
insert into public.servicos (id, nome, duracao_minutos, preco, buffer_minutos) values
  ('30000000-0000-0000-0000-0000000000c1', 'Serviço Teste', 40, 220.00, 10);
insert into public.servicos_profissionais (servico_id, profissional_id) values
  ('30000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000b1');

-- Próxima segunda-feira às <h>:00 em São Paulo
create function pg_temp.seg(h numeric) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Sao_Paulo') + interval '7 days'
           + make_interval(mins => (h * 60)::int)) at time zone 'America/Sao_Paulo')
$$;

create function pg_temp.agendar(
  h numeric, cpf text, whats text, email text default null,
  consent text default '2026-11-13', ip text default 'ip-a'
) returns text language sql as $$
  select codigo from public.criar_agendamento_publico(
    '30000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000b1',
    pg_temp.seg(h), 'Paciente Teste', cpf, whats, email, 'pix', consent, ip)
$$;

-- Espera erro com SQLSTATE e trecho da mensagem
create function pg_temp.espera_erro(sql text, estado text, trecho text, nome text) returns void
language plpgsql as $$
begin
  execute sql;
  raise exception 'FALHOU: % (não deu erro)', nome;
exception
  when others then
    if sqlerrm like 'FALHOU:%' then raise; end if;
    if sqlstate <> estado or position(trecho in sqlerrm) = 0 then
      raise exception 'FALHOU: % (erro inesperado % %)', nome, sqlstate, sqlerrm;
    end if;
end;
$$;

grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- ---------------------------------------------- 1. anon não chama a RPC direto
set local role anon;
select pg_temp.espera_erro(
  $q$ select pg_temp.agendar(9, '52998224725', '11911111111') $q$,
  '42501', 'permission denied', 'anon não pode criar agendamento diretamente');
reset role;

set local role service_role;

-- ------------------------------------------ 2. contato não pode ser sequestrado
select pg_temp.agendar(9, '529.982.247-25', '(11) 91111-1111', 'maria@exemplo.com');
select pg_temp.agendar(14, '52998224725', '11999999999', 'atacante@exemplo.com', '2026-11-13', 'ip-b');

do $$
declare w text; e text; n int;
begin
  select whatsapp, email into w, e from public.clientes where cpf = '52998224725';
  if w <> '11911111111' or e <> 'maria@exemplo.com' then
    raise exception 'FALHOU: contato do cliente foi alterado para % / %', w, e;
  end if;
  select count(*) into n from public.notificacoes where destino in ('11999999999', 'atacante@exemplo.com');
  if n <> 0 then raise exception 'FALHOU: % notificações foram para o contato do atacante', n; end if;
end $$;

-- ---------------------------------------------------------------- 3. validações
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '52998224724', '11911111111') $q$,
  'P0001', 'CPF inválido', 'CPF com dígito verificador errado');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '11111111111', '11911111111') $q$,
  'P0001', 'CPF inválido', 'CPF com dígitos repetidos');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '39053344705', '1191') $q$,
  'P0001', 'WhatsApp inválido', 'WhatsApp curto');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '39053344705', '11922222222', 'nao-e-email') $q$,
  'P0001', 'E-mail inválido', 'e-mail inválido');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '39053344705', '11922222222', null, '') $q$,
  'P0001', 'política de privacidade', 'sem consentimento');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '39053344705', '11922222222', null, 'v1', '') $q$,
  'P0001', 'Origem', 'sem hash de IP');
select pg_temp.espera_erro($q$ select pg_temp.agendar(7, '39053344705', '11922222222') $q$,
  'P0001', 'Fora do horário', 'antes do expediente');

-- ------------------------------------------------------- 4. conflito de horário
select pg_temp.espera_erro($q$ select pg_temp.agendar(9.5, '39053344705', '11922222222', null, 'v1', 'ip-c') $q$,
  'P0002', 'acabou de ser reservado', 'sobreposição com atendimento + buffer');

-- --------------------------------------------------------- 5. limite por IP/hora
reset role;
update public.parametros_agendamento set max_agendamentos_por_ip_hora = 2;
set local role service_role;
select pg_temp.agendar(11, '39053344705', '11922222222', null, 'v1', 'ip-d');
select pg_temp.agendar(12, '86288366757', '11933333333', null, 'v1', 'ip-d');
select pg_temp.espera_erro($q$ select pg_temp.agendar(15, '71428793860', '11944444444', null, 'v1', 'ip-d') $q$,
  'P0003', 'Muitos agendamentos', 'limite por IP');

-- ------------------------------------------------- 6. limite de futuros por CPF
reset role;
update public.parametros_agendamento set max_agendamentos_futuros_por_cpf = 2, max_agendamentos_por_ip_hora = 100;
set local role service_role;
select pg_temp.espera_erro($q$ select pg_temp.agendar(16, '52998224725', '11911111111', null, 'v1', 'ip-e') $q$,
  'P0003', 'Limite de agendamentos', 'limite de futuros por CPF');

-- ------------------------------------------------------------- 7. consentimento
do $$
begin
  if (select count(*) from public.consentimentos c
      join public.clientes cl on cl.id = c.cliente_id where cl.cpf = '52998224725') <> 2 then
    raise exception 'FALHOU: consentimento não registrado em cada agendamento';
  end if;
end $$;

-- ------------------------------------------------------- 8. intervalos com tipo
reset role;
insert into public.bloqueios_agenda (profissional_id, inicio, fim, motivo)
values ('20000000-0000-0000-0000-0000000000b1', pg_temp.seg(17), pg_temp.seg(18), 'teste');
set local role anon;
do $$
declare n_ag int; n_bl int;
begin
  select count(*) filter (where tipo = 'agendamento'), count(*) filter (where tipo = 'bloqueio')
    into n_ag, n_bl
  from public.intervalos_ocupados(array['20000000-0000-0000-0000-0000000000b1'::uuid],
                                  pg_temp.seg(0), pg_temp.seg(24));
  if n_ag <> 4 or n_bl <> 1 then
    raise exception 'FALHOU: intervalos_ocupados devolveu % agendamentos e % bloqueios', n_ag, n_bl;
  end if;
end $$;
reset role;

-- -------------------------------------------------- 9. relatório sem duplicação
update public.agendamentos set status = 'concluido' where data_hora_inicio = pg_temp.seg(9);
insert into public.pagamentos (agendamento_id, valor, metodo, status)
select id, 220, 'cartao_credito', 'estornado' from public.agendamentos where data_hora_inicio = pg_temp.seg(9);
update public.pagamentos set status = 'pago'
 where status = 'pendente'
   and agendamento_id = (select id from public.agendamentos where data_hora_inicio = pg_temp.seg(9));

set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.relatorio_financeiro(now() - interval '1 day', now() + interval '60 days')
  where profissional_id = '20000000-0000-0000-0000-0000000000b1';
  if r.faturamento_bruto <> 220 or r.recebido <> 220 or r.repasse <> 88 or r.liquido_clinica <> 132
     or r.atendimentos <> 4 then
    raise exception 'FALHOU: relatório = bruto % recebido % repasse % líquido % atendimentos %',
      r.faturamento_bruto, r.recebido, r.repasse, r.liquido_clinica, r.atendimentos;
  end if;
end $$;

-- -------------------------------------------------- 10. parâmetros públicos
reset role;
set local role anon;
do $$
begin
  if (select janela_dias from public.parametros_agendamento_publicos()) is null then
    raise exception 'FALHOU: parâmetros públicos indisponíveis para anon';
  end if;
end $$;
reset role;

select 'TODOS OS TESTES PASSARAM' as resultado;
rollback;
