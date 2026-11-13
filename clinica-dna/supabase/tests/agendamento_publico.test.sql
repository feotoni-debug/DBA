-- =============================================================================
-- Testes das regras de agendamento público, do painel e do relatório.
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

-- Próxima segunda-feira às <h> horas (decimal) em São Paulo
create function pg_temp.seg(h numeric) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'America/Sao_Paulo') + interval '7 days'
           + make_interval(mins => (h * 60)::int)) at time zone 'America/Sao_Paulo')
$$;

create function pg_temp.agendar_em(
  inicio timestamptz, cpf text, whats text, email text default null,
  consent text default '2026-11-13', ip text default 'ip-a'
) returns text language sql as $$
  select codigo from public.criar_agendamento_publico(
    '30000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000b1',
    inicio, 'Paciente Teste', cpf, whats, email, 'pix', consent, ip)
$$;

create function pg_temp.agendar(
  h numeric, cpf text, whats text, email text default null,
  consent text default '2026-11-13', ip text default 'ip-a'
) returns text language sql as $$
  select pg_temp.agendar_em(pg_temp.seg(h), cpf, whats, email, consent, ip)
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

-- Destinos das notificações de um agendamento (pelo horário)
create function pg_temp.destinos(h numeric) returns text[] language sql as $$
  select coalesce(array_agg(distinct n.destino order by n.destino), '{}')
  from public.notificacoes n
  join public.agendamentos a on a.id = n.agendamento_id
  where a.data_hora_inicio = pg_temp.seg(h)
$$;

grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- ---------------------------------------------- 1. anon não chama a RPC direto
set local role anon;
select pg_temp.espera_erro(
  $q$ select pg_temp.agendar(9, '52998224725', '11911111111') $q$,
  '42501', 'permission denied', 'anon não pode criar agendamento diretamente');
reset role;

set local role service_role;

-- ------------------------------------- 2. CPF de paciente existente + outro contato
select pg_temp.agendar(9, '529.982.247-25', '(11) 91111-1111', 'maria@exemplo.com');
select pg_temp.agendar(14, '52998224725', '11999999999', 'atacante@exemplo.com', '2026-11-13', 'ip-b');
reset role;

do $$
declare w text; e text;
begin
  select whatsapp, email into w, e from public.clientes where cpf = '52998224725';
  if w <> '11911111111' or e <> 'maria@exemplo.com' then
    raise exception 'FALHOU: cadastro existente foi alterado para % / %', w, e;
  end if;
  if pg_temp.destinos(9) <> array['11911111111', 'maria@exemplo.com'] then
    raise exception 'FALHOU: agendamento da paciente notifica %', pg_temp.destinos(9);
  end if;
  -- quem fez o agendamento das 14h recebe só as mensagens DESSE agendamento
  if pg_temp.destinos(14) <> array['11999999999', 'atacante@exemplo.com'] then
    raise exception 'FALHOU: agendamento das 14h notifica %', pg_temp.destinos(14);
  end if;
end $$;

-- ------------------------- 3. "primeiro a usar o CPF" não sequestra o dono do CPF
set local role service_role;
select pg_temp.agendar(8, '39053344705', '11933330000', null, 'v1', 'ip-c');   -- atacante cadastra o CPF
select pg_temp.agendar(10, '39053344705', '11944440000', null, 'v1', 'ip-g');  -- dono real agenda depois
reset role;
do $$
begin
  if pg_temp.destinos(10) <> array['11944440000'] then
    raise exception 'FALHOU: agendamento do dono do CPF notifica %', pg_temp.destinos(10);
  end if;
end $$;

-- ---------------------------------------------------------------- 4. validações
set local role service_role;
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '52998224724', '11911111111') $q$,
  'P0001', 'CPF inválido', 'CPF com dígito verificador errado');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '11111111111', '11911111111') $q$,
  'P0001', 'CPF inválido', 'CPF com dígitos repetidos');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '86288366757', '1191') $q$,
  'P0001', 'WhatsApp inválido', 'WhatsApp curto');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '86288366757', '11922222222', 'nao-e-email') $q$,
  'P0001', 'E-mail inválido', 'e-mail inválido');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '86288366757', '11922222222', null, '') $q$,
  'P0001', 'política de privacidade', 'sem consentimento');
select pg_temp.espera_erro($q$ select pg_temp.agendar(10, '86288366757', '11922222222', null, 'v1', '') $q$,
  'P0001', 'Origem', 'sem hash de IP');
select pg_temp.espera_erro($q$ select pg_temp.agendar(15.0833, '86288366757', '11922222222', null, 'v1', 'ip-x') $q$,
  'P0001', 'Horário inválido', 'horário fora da grade de 10 min (15:05)');
-- horário que deixou de estar disponível → P0002 (o site recarrega a lista)
select pg_temp.espera_erro($q$ select pg_temp.agendar(7, '86288366757', '11922222222') $q$,
  'P0002', 'não está mais disponível', 'antes do expediente');
select pg_temp.espera_erro($q$ select pg_temp.agendar_em(now() + interval '5 minutes', '86288366757', '11922222222') $q$,
  'P0002', 'não está mais disponível', 'dentro da antecedência mínima');

-- ------------------------------------------------------- 5. conflito de horário
select pg_temp.espera_erro($q$ select pg_temp.agendar(9.5, '86288366757', '11922222222', null, 'v1', 'ip-y') $q$,
  'P0002', 'acabou de ser reservado', 'sobreposição com atendimento + buffer');

-- --------------------------------------------------------- 6. limite por IP/hora
reset role;
update public.parametros_agendamento set max_agendamentos_por_ip_hora = 2;
set local role service_role;
select pg_temp.agendar(11, '86288366757', '11955550000', null, 'v1', 'ip-d');
select pg_temp.agendar(12, '71428793860', '11966660000', null, 'v1', 'ip-d');
select pg_temp.espera_erro($q$ select pg_temp.agendar(15, '71428793860', '11966660000', null, 'v1', 'ip-d') $q$,
  'P0003', 'Muitos agendamentos', 'limite por IP');

-- ------------------------------------- 7. limite por CPF conta só o mesmo contato
reset role;
update public.parametros_agendamento set max_agendamentos_futuros_por_cpf = 2, max_agendamentos_por_ip_hora = 100;
set local role service_role;
select pg_temp.agendar(16, '52998224725', '11911111111', null, 'v1', 'ip-e');     -- paciente: 2º agendamento
select pg_temp.espera_erro($q$ select pg_temp.agendar(13, '52998224725', '11911111111', null, 'v1', 'ip-f') $q$,
  'P0003', 'Limite de agendamentos', 'limite de futuros por CPF + contato');
-- outra pessoa com o mesmo CPF não é bloqueada pelos agendamentos da paciente (e vice-versa)
select pg_temp.agendar(13, '52998224725', '11999999999', null, 'v1', 'ip-h');

-- ------------------------------------------------------------ 8. bloqueio pessoal
reset role;
insert into public.bloqueios_agenda (profissional_id, inicio, fim, motivo)
values ('20000000-0000-0000-0000-0000000000b1', pg_temp.seg(17), pg_temp.seg(18), 'teste');
set local role service_role;
select pg_temp.espera_erro($q$ select pg_temp.agendar(17, '86288366757', '11955550000', null, 'v1', 'ip-z') $q$,
  'P0002', 'não está mais disponível', 'horário bloqueado');
reset role;

-- ------------------------------------------------------------- 9. consentimento
do $$
begin
  if (select count(*) from public.consentimentos) <> (select count(*) from public.agendamentos) then
    raise exception 'FALHOU: consentimento não registrado em cada agendamento';
  end if;
end $$;

-- ------------------------------------------------------ 10. intervalos com tipo
select set_config('teste.n_ag', count(*)::text, true)
from public.agendamentos where status not in ('cancelado', 'faltou');
set local role anon;
do $$
declare n_ag int; n_bl int;
begin
  select count(*) filter (where tipo = 'agendamento'), count(*) filter (where tipo = 'bloqueio')
    into n_ag, n_bl
  from public.intervalos_ocupados(array['20000000-0000-0000-0000-0000000000b1'::uuid],
                                  pg_temp.seg(0), pg_temp.seg(24));
  if n_ag <> current_setting('teste.n_ag')::int or n_bl <> 1 then
    raise exception 'FALHOU: intervalos_ocupados devolveu % agendamentos e % bloqueios', n_ag, n_bl;
  end if;
end $$;
reset role;

-- --------------------------------------------- 11. expiração de Pix não pago
set local role service_role;
do $$
begin
  if public.expirar_reservas_pix_pendentes() <> 0 then
    raise exception 'FALHOU: expiração deveria estar desligada por padrão';
  end if;
end $$;
reset role;
update public.parametros_agendamento set expira_pix_pendente_minutos = 30;
update public.agendamentos set created_at = now() - interval '1 hour' where data_hora_inicio = pg_temp.seg(14);
set local role service_role;
do $$
begin
  if public.expirar_reservas_pix_pendentes() <> 1 then
    raise exception 'FALHOU: deveria expirar exatamente a reserva antiga';
  end if;
end $$;
reset role;
do $$
begin
  if (select status from public.agendamentos where data_hora_inicio = pg_temp.seg(14)) <> 'cancelado'
     or exists (select 1 from public.notificacoes n join public.agendamentos a on a.id = n.agendamento_id
                where a.data_hora_inicio = pg_temp.seg(14) and n.enviado_em is null) then
    raise exception 'FALHOU: reserva expirada não foi cancelada ou manteve notificações pendentes';
  end if;
end $$;
set local role anon;
select pg_temp.espera_erro($q$ select public.expirar_reservas_pix_pendentes() $q$,
  '42501', 'permission denied', 'anon não pode expirar reservas');
reset role;

-- -------------------------------------------------- 12. relatório sem duplicação
update public.agendamentos set status = 'concluido' where data_hora_inicio = pg_temp.seg(9);
insert into public.pagamentos (agendamento_id, valor, metodo, status)
select id, 220, 'cartao_credito', 'estornado' from public.agendamentos where data_hora_inicio = pg_temp.seg(9);
update public.pagamentos set status = 'pago'
 where status = 'pendente'
   and agendamento_id = (select id from public.agendamentos where data_hora_inicio = pg_temp.seg(9));
select set_config('teste.n_atend', count(*)::text, true)
from public.agendamentos where status <> 'cancelado';

set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.relatorio_financeiro(now() - interval '1 day', now() + interval '60 days')
  where profissional_id = '20000000-0000-0000-0000-0000000000b1';
  if r.faturamento_bruto <> 220 or r.recebido <> 220 or r.repasse <> 88 or r.liquido_clinica <> 132
     or r.atendimentos <> current_setting('teste.n_atend')::int then
    raise exception 'FALHOU: relatório = bruto % recebido % repasse % líquido % atendimentos %',
      r.faturamento_bruto, r.recebido, r.repasse, r.liquido_clinica, r.atendimentos;
  end if;
end $$;

-- ------------------------------------------------------ 13. painel por papel
-- admin: vê valor, pagamento e o aviso de contato diferente do cadastro
do $$
declare r record;
begin
  select * into r from public.agenda_painel(pg_temp.seg(0), pg_temp.seg(24)) where data_hora_inicio = pg_temp.seg(10);
  if r.contato_whatsapp <> '11944440000' or not r.contato_divergente or r.valor <> 220 or r.pagamento_status is null then
    raise exception 'FALHOU: painel do admin = %', r;
  end if;
end $$;
select set_config('teste.n_painel', count(*)::text, true) from public.agenda_painel(pg_temp.seg(0), pg_temp.seg(24));

-- profissional: só nome + WhatsApp do agendamento; sem valor/pagamento; sem acesso a clientes
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$
declare r record; n int;
begin
  select * into r from public.agenda_painel(pg_temp.seg(0), pg_temp.seg(24)) where data_hora_inicio = pg_temp.seg(10);
  if r.valor is not null or r.pagamento_status is not null or r.contato_divergente or r.paciente_nome is null then
    raise exception 'FALHOU: painel do profissional = %', r;
  end if;
  select count(*) into n from public.agenda_painel(pg_temp.seg(0), pg_temp.seg(24));
  if n <> current_setting('teste.n_painel')::int then
    raise exception 'FALHOU: profissional vê % de % atendimentos próprios', n, current_setting('teste.n_painel');
  end if;
  if (select count(*) from public.clientes) <> 0 then
    raise exception 'FALHOU: profissional ainda lê a tabela clientes';
  end if;
end $$;
select pg_temp.espera_erro($q$ select * from public.agenda_painel(now(), now() + interval '60 days') $q$,
  '22023', 'Período inválido', 'painel limita o período a 31 dias');
reset role;
set local role anon;
select pg_temp.espera_erro($q$ select * from public.agenda_painel(now(), now() + interval '1 day') $q$,
  '42501', 'permission denied', 'anon não acessa o painel');
reset role;

-- ------------------------ 14. pagamento aprovado avisa o contato do agendamento
update public.pagamentos set transacao_externa_id = 'tx-teste'
 where agendamento_id = (select id from public.agendamentos where data_hora_inicio = pg_temp.seg(10));
set local role service_role;
select public.confirmar_pagamento_externo('tx-teste', 'pago');
reset role;
do $$
begin
  if (select destino from public.notificacoes where template = 'pagamento_aprovado') <> '11944440000' then
    raise exception 'FALHOU: pagamento aprovado foi para o contato do cadastro, não do agendamento';
  end if;
end $$;

-- -------------------------------------------------- 15. parâmetros públicos
set local role anon;
do $$
declare r record;
begin
  select * into r from public.parametros_agendamento_publicos();
  if r.janela_dias is null or r.passo_minutos <> 10 then
    raise exception 'FALHOU: parâmetros públicos = %', r;
  end if;
end $$;
reset role;

select 'TODOS OS TESTES PASSARAM' as resultado;
rollback;
