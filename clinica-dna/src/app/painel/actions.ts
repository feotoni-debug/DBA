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

/** Muda o status — quem pode o quê é decidido pelas policies RLS e triggers. */
export async function atualizarStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as AgendamentoStatus;
  if (!id || !STATUS.includes(status)) return;

  const supabase = await createClient();
  const patch: { status: AgendamentoStatus; checkin_em?: string } = { status };
  if (status === "aguardando_atendimento") patch.checkin_em = new Date().toISOString();

  const { error } = await supabase.from("agendamentos").update(patch).eq("id", id);
  if (error) console.error("[painel] atualizarStatus", error);
  revalidatePath("/painel");
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
