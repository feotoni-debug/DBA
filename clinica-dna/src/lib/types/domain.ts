// Tipos de domínio espelhando o schema SQL (supabase/migrations).

export type UserRole = "admin" | "recepcao" | "profissional";

export type AgendamentoStatus =
  | "agendado"
  | "confirmado"
  | "aguardando_atendimento"
  | "em_atendimento"
  | "concluido"
  | "faltou"
  | "cancelado";

export type AgendamentoCanal = "online" | "balcao";
export type PagamentoMetodo = "pix" | "cartao_credito" | "cartao_debito" | "dinheiro" | "faturado";
export type PagamentoStatus = "pendente" | "pago" | "estornado";

export interface Perfil {
  id: string;
  user_id: string;
  nome: string;
  email: string;
  telefone: string | null;
  role: UserRole;
  ativo: boolean;
}

export interface Profissional {
  id: string;
  perfil_id: string;
  nome: string;
  registro_profissional: string | null;
  especialidades: string[];
  bio: string | null;
  foto_url: string | null;
  comissao_percentual?: number;
}

export interface HorarioTrabalho {
  id?: string;
  profissional_id: string;
  /** 0 = domingo … 6 = sábado */
  dia_semana: number;
  /** "HH:mm" ou "HH:mm:ss" */
  hora_inicio: string;
  hora_fim: string;
}

export interface Servico {
  id: string;
  nome: string;
  descricao: string | null;
  especialidade: string | null;
  duracao_minutos: number;
  preco: number;
  buffer_minutos: number;
  ativo: boolean;
}

export interface Cliente {
  id: string;
  nome: string;
  cpf: string;
  whatsapp: string;
  email: string | null;
  historico_observacoes: string | null;
}

export interface Agendamento {
  id: string;
  codigo: string;
  cliente_id: string;
  profissional_id: string;
  servico_id: string;
  data_hora_inicio: string;
  data_hora_fim: string;
  buffer_minutos: number;
  status: AgendamentoStatus;
  canal: AgendamentoCanal;
  valor: number;
  observacoes: string | null;
}

export interface Pagamento {
  id: string;
  agendamento_id: string;
  valor: number;
  metodo: PagamentoMetodo;
  status: PagamentoStatus;
  transacao_externa_id: string | null;
  pago_em: string | null;
}

/** Linha "achatada" usada no painel. */
export interface AgendamentoDetalhado extends Agendamento {
  cliente: Pick<Cliente, "id" | "nome" | "whatsapp" | "cpf">;
  profissional: Pick<Profissional, "id" | "nome">;
  servico: Pick<Servico, "id" | "nome" | "duracao_minutos">;
  pagamento: Pick<Pagamento, "id" | "metodo" | "status" | "valor"> | null;
}

export interface IntervaloOcupado {
  profissional_id: string;
  inicio: string; // ISO
  fim: string; // ISO (já inclui buffer do agendamento existente)
  tipo: "agendamento" | "bloqueio";
  /** Reserva online ainda não confirmada (conta para o teto por profissional/dia). */
  online_pendente?: boolean;
}

/** Espelha `parametros_agendamento_publicos()` no banco. */
export interface ParametrosAgendamento {
  antecedencia_minima_minutos: number;
  janela_dias: number;
  /** Passo da grade de horários (min) — o banco recusa horários fora dela. */
  passo_minutos: number;
  /** Teto de reservas online não confirmadas por profissional/dia (null = sem teto). */
  max_online_pendentes_por_profissional_dia: number | null;
}

/** Linha devolvida por `agenda_painel()` (colunas variam por papel). */
export interface AgendaPainelLinha {
  id: string;
  codigo: string;
  data_hora_inicio: string;
  data_hora_fim: string;
  status: AgendamentoStatus;
  canal: AgendamentoCanal;
  /** null para profissional */
  valor: number | null;
  observacoes: string | null;
  paciente_nome: string;
  contato_whatsapp: string | null;
  /** WhatsApp do agendamento ≠ do cadastro (só staff vê) */
  contato_divergente: boolean;
  servico_nome: string;
  profissional_nome: string;
  /** null para profissional */
  pagamento_status: PagamentoStatus | null;
}

export interface Slot {
  /** ISO com offset da clínica, ex.: 2026-11-12T14:30:00-03:00 */
  inicio: string;
  fim: string;
  /** "HH:mm" no fuso da clínica, para exibição */
  label: string;
  profissionalId: string;
}

export interface RelatorioFinanceiroLinha {
  profissional_id: string;
  profissional_nome: string;
  atendimentos: number;
  faturamento_bruto: number;
  recebido: number;
  pendente: number;
  comissao_percentual: number;
  repasse: number;
  liquido_clinica: number;
}

export interface SessionUser {
  perfilId: string;
  nome: string;
  email: string;
  role: UserRole;
  profissionalId: string | null;
}
