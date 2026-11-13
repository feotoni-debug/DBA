import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/domain";

/** Usuário logado + perfil ativo; redireciona para /login se não houver. */
export async function exigeSessao() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("perfis")
    .select("id, nome, role")
    .eq("user_id", user.id)
    .eq("ativo", true)
    .maybeSingle();

  return {
    supabase,
    perfil: perfil as { id: string; nome: string; role: UserRole } | null,
  };
}
