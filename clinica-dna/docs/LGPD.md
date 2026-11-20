# LGPD — o que o sistema já faz e o que falta

> Este documento é um levantamento técnico, **não é parecer jurídico**. A clínica trata dados de saúde (dados
> pessoais sensíveis, art. 11 da LGPD); as decisões abaixo precisam ser validadas por assessoria jurídica.

## Dados tratados

| Onde | Dados | Quem acessa |
| --- | --- | --- |
| `clientes` | nome, CPF, WhatsApp, e-mail, data de nascimento, observações de histórico | admin, recepção (profissional vê só nome e WhatsApp dos próprios atendimentos, pela função `agenda_painel`) |
| `agendamentos` | serviço, profissional, horário, status, hash do IP de origem | admin, recepção; profissional só os próprios |
| `pagamentos` | valor, método, status, ids do gateway | admin, recepção |
| `consentimentos` | versão da política aceita, data, hash do IP | admin |

O site público nunca lê essas tabelas diretamente — só por funções que devolvem dados não pessoais.

## Já implementado

- **Controle de acesso por papel** com Row Level Security em todas as tabelas.
- **Registro de consentimento**: cada agendamento online grava a versão da política aceita (`consentimentos`). A
  versão fica em `src/config/clinic.ts` → `politicaPrivacidadeVersao`.
- **Minimização no site**: o formulário pede só nome, CPF, WhatsApp e e-mail opcional.
- **IP não é armazenado**: guardamos apenas um HMAC do IP (com segredo `IP_HASH_SECRET`), usado para limitar abuso.
- **Contato protegido**: o fluxo público não altera dados de um paciente existente, e as mensagens de cada
  agendamento vão só para o contato informado nele — digitar o CPF de outra pessoa não dá acesso a nada dela.
- **Mínimo necessário para o profissional**: sem acesso à tabela `clientes` (CPF, e-mail, nascimento, histórico).
- **Página `/privacidade`** com um modelo de texto (precisa de revisão jurídica).

## Pendências recomendadas

1. **Revisão jurídica** da política de privacidade e da base legal de cada finalidade (agendamento, lembretes,
   prontuário, financeiro).
2. **Encarregado (DPO)**: definir e publicar o contato.
3. **Retenção e eliminação**: definir prazos (prontuário tem prazo legal próprio) e criar rotina para anonimizar
   clientes sem atendimento após o prazo; limpar `origem_ip_hash` antigo.
4. **Direitos do titular**: procedimento para acesso, correção, portabilidade e eliminação (hoje manual, pela
   recepção).
5. **Registro de acesso**: auditoria de quem consultou dados de pacientes (ex.: `pgaudit` ou log de leitura via RPC).
6. **Criptografia de campos sensíveis** (CPF, observações de histórico) com chave fora do banco, se a análise de
   risco indicar.
7. **Contratos com operadores**: Supabase, Vercel, provedor de WhatsApp/e-mail e gateway de pagamento.
8. **Validar a constraint de CPF** nos dados antigos depois de revisá-los:
   `alter table public.clientes validate constraint clientes_cpf_valido;`
