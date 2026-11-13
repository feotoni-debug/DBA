# Clínica DNA

Site e sistema de agendamento da Clínica DNA: Next.js 15 (App Router) + Supabase (Postgres, Auth, RLS).

- **Site público** — `/` (apresentação e especialidades), `/agendar` (agendamento online em 4 passos), `/privacidade`.
- **Área da equipe** — `/login`, `/painel` (agenda do dia, mudança de status) e `/painel/financeiro` (somente admin).

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha as variáveis
npm run dev
```

Abra <http://localhost:3000>.

## Banco de dados

As migrations ficam em `supabase/migrations/` e são aplicadas em ordem:

| Arquivo | Conteúdo |
| --- | --- |
| `…0001_schema.sql` | Tabelas, enums, índices, constraint que impede horários sobrepostos |
| `…0002_rls.sql` | Políticas de acesso por papel (admin, recepção, profissional, anônimo) |
| `…0003_rpc.sql` | Funções chamadas pelo site e pelo painel |
| `…0004_seguranca_agendamento.sql` | Correções de segurança, consentimento LGPD, parâmetros, relatório |
| `…0005_correcoes_conselho.sql` | Contato por agendamento, grade de horários, travas nos limites, expiração de Pix, agenda do painel por papel |

Com a [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase db push        # aplica no projeto remoto
```

Depois rode `supabase/seed.sql` para criar o catálogo de serviços e siga as instruções do fim desse arquivo para
criar o primeiro administrador.

### Parâmetros de agendamento

Antecedência mínima, quantos dias à frente o paciente pode agendar, o passo da grade de horários e os limites contra
abuso ficam na tabela `parametros_agendamento` (uma linha só). O site lê esses valores do banco — não há cópia no
código.

```sql
update public.parametros_agendamento set antecedencia_minima_minutos = 60, janela_dias = 45;
```

### Expiração de reservas Pix não pagas

Desligada por padrão. **Só ligue depois que o webhook de pagamento estiver confirmando os Pix**, senão todas as
reservas Pix serão canceladas:

```sql
update public.parametros_agendamento set expira_pix_pendente_minutos = 30;
select cron.schedule('expirar-pix', '*/5 * * * *', $$select public.expirar_reservas_pix_pendentes()$$);
```

## Como o agendamento online é protegido

1. O navegador lê serviços, profissionais e horários livres com a chave pública (`anon`), que só enxerga dados não
   sensíveis.
2. Para criar o agendamento, o navegador chama `POST /api/agendamentos`. A rota valida os dados, confere o captcha
   (Cloudflare Turnstile) e só então chama a função `criar_agendamento_publico` com a chave `service_role`. A chave
   pública **não** pode chamar essa função.
3. No banco, a função valida CPF, horário e grade, limita agendamentos por IP/hora e por CPF, registra o
   consentimento, exige que o horário esteja na grade e serializa os limites (pedidos paralelos não furam o limite).
4. **Cada agendamento guarda o contato informado nele**, e as mensagens daquele agendamento vão só para esse
   contato. O cadastro de um paciente existente nunca é alterado pelo site. Assim, quem digita o CPF de outra pessoa
   não recebe nada sobre os agendamentos dela, e a resposta não revela se o CPF já é paciente. No painel, a recepção
   vê um aviso quando o WhatsApp do agendamento é diferente do cadastro.

## Testes

```bash
npm test             # testes unitários (algoritmo de horários, datas, validações)
npm run typecheck
npm run lint
```

Testes do banco (rodam numa transação e desfazem tudo no final), com o Supabase local:

```bash
supabase start && supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
  -f supabase/tests/agendamento_publico.test.sql
```

## Antes de publicar

- Preencha os dados reais em `src/config/clinic.ts` (telefone, CNPJ, endereço, responsável técnico).
- Revise o texto de `/privacidade` com a assessoria jurídica e veja `docs/LGPD.md`.
- Configure todas as variáveis de `.env.example` na Vercel, incluindo o Turnstile.

## Ainda não implementado

- Envio das notificações: a fila `notificacoes` é preenchida, mas falta o worker/Edge Function que envia WhatsApp e
  e-mail.
- Integração de pagamento (Pix / gateway) e o webhook que chama `confirmar_pagamento_externo`.
- Cadastro de usuários, profissionais, grade de horários e bloqueios pelo painel (hoje, via SQL / Supabase Studio).
- Agendamento pelo balcão no painel.
