"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AgendamentoStatus } from "@/lib/types/domain";

const STATUS: AgendamentoStatus[] = [
  "agendado",
  "confirmado",
  "aguardando_atendimento",
  "em_atendimento",
  "concluido",
  "faltou",
  "cancelado",
];

export interface ResultadoStatus {
  ok: boolean;
  mensagem: string | null;
}

/**
 * Muda o status — quem pode o quê é decidido pelas policies RLS e triggers.
 * Uma atualização bloqueada pela RLS NÃO gera erro no Postgres: só afeta 0
 * linhas. Por isso conferimos as linhas devolvidas e avisamos a tela.
 */
export async function atualizarStatus(_anterior: ResultadoStatus, formData: FormData): Promise<ResultadoStatus> {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as AgendamentoStatus;
  if (!id || !STATUS.includes(status)) return { ok: false, mensagem: "Status inválido." };

  const supabase = await createClient();
  const patch: { status: AgendamentoStatus; checkin_em?: string } = { status };
  if (status === "aguardando_atendimento") patch.checkin_em = new Date().toISOString();

  const { data, error } = await supabase.from("agendamentos").update(patch).eq("id", id).select("id");

  if (error) {
    console.error("[painel] atualizarStatus", error.code, error.message);
    if (error.code === "P0001") {
      // mensagens controladas, vindas dos triggers de permissão
      return { ok: false, mensagem: error.message };
    }
    if (error.code === "23P01") {
      return { ok: false, mensagem: "Já existe outro atendimento neste horário para este profissional." };
    }
    return { ok: false, mensagem: "Não foi possível salvar. Tente novamente." };
  }
  if (!data || data.length === 0) {
    return { ok: false, mensagem: "Você não tem permissão para alterar este atendimento." };
  }

  revalidatePath("/painel");
  return { ok: true, mensagem: "Salvo." };
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
