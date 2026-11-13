-- =============================================================================
-- Seed inicial — serviços do catálogo.
-- Usuários (admin, recepção, profissionais) são criados pelo painel
-- (/admin/usuarios) ou pelo script abaixo, depois do primeiro cadastro.
-- =============================================================================

insert into public.servicos (nome, descricao, especialidade, duracao_minutos, preco, buffer_minutos) values
  ('Consulta de Clínica Geral',  'Avaliação completa, solicitação de exames e acompanhamento.', 'Clínica Geral', 40, 220.00, 10),
  ('Consulta Nutricional',       'Plano alimentar individual com bioimpedância.',              'Nutrição',      50, 260.00, 10),
  ('Sessão de Psicoterapia',     'Atendimento individual em abordagem cognitivo-comportamental.', 'Psicologia',  50, 200.00, 10),
  ('Sessão de Fisioterapia',     'Reabilitação musculoesquelética e pós-operatória.',          'Fisioterapia',  45, 150.00, 10),
  ('Avaliação Fonoaudiológica',  'Voz, fala, linguagem e deglutição.',                          'Fonoaudiologia', 60, 230.00, 10),
  ('Consulta Dermatológica',     'Diagnóstico clínico e estético da pele.',                    'Dermatologia',  30, 280.00, 10);

-- -----------------------------------------------------------------------------
-- Bootstrap do primeiro administrador:
-- 1) Crie o usuário em Authentication → Users (ou faça sign-up em /login).
-- 2) Rode, trocando o e-mail:
--
-- insert into public.perfis (user_id, nome, email, role)
-- select id, 'Dona da Clínica', email, 'admin'
-- from auth.users where email = 'dona@suaclinica.com.br'
-- on conflict (user_id) do update set role = 'admin';
-- -----------------------------------------------------------------------------
