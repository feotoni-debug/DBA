import type { AgendamentoStatus } from "@/lib/types/domain";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formataMoeda = (v: number | string) => brl.format(Number(v));

/** "2026-11-16" → "segunda-feira, 16 de novembro" */
export function formataDataLonga(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "2026-11-16" → { semana: "seg", dia: "16", mes: "nov" } */
export function partesData(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { ...o, timeZone: "UTC" }).format(dt).replace(".", "");
  return { semana: fmt({ weekday: "short" }), dia: String(d), mes: fmt({ month: "short" }) };
}

export const STATUS_LABEL: Record<AgendamentoStatus, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  aguardando_atendimento: "Na recepção",
  em_atendimento: "Em atendimento",
  concluido: "Concluído",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

/**
 * Para onde o PROFISSIONAL pode levar um atendimento (o banco aplica a mesma
 * regra no trigger agendamentos_protege_campos_profissional).
 */
export const PROXIMOS_STATUS_PROFISSIONAL: Record<AgendamentoStatus, AgendamentoStatus[]> = {
  agendado: ["em_atendimento", "faltou"],
  confirmado: ["em_atendimento", "faltou"],
  aguardando_atendimento: ["em_atendimento", "faltou"],
  em_atendimento: ["concluido"],
  concluido: [],
  faltou: [],
  cancelado: [],
};

export const STATUS_COR: Record<AgendamentoStatus, string> = {
  agendado: "bg-slate-100 text-slate-700",
  confirmado: "bg-sky-100 text-sky-800",
  aguardando_atendimento: "bg-amber-100 text-amber-800",
  em_atendimento: "bg-violet-100 text-violet-800",
  concluido: "bg-emerald-100 text-emerald-800",
  faltou: "bg-rose-100 text-rose-800",
  cancelado: "bg-zinc-200 text-zinc-600 line-through",
};
