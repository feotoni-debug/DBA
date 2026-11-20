import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabasePublicEnv } from "./env";

/** Cliente com a sessão do usuário logado (cookies) — respeita RLS. */
export async function createClient() {
  const cookieStore = await cookies(); // antes de tudo: torna a rota dinâmica
  const { url, anonKey } = supabasePublicEnv();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Chamado de um Server Component: o middleware cuida de renovar a sessão.
        }
      },
    },
  });
}

/** Cliente anônimo (sem sessão) para dados públicos no servidor. */
export function createAnonClient() {
  const { url, anonKey } = supabasePublicEnv();
  return createPlainClient(url, anonKey, { auth: { persistSession: false } });
}

/**
 * Cliente service_role — ignora RLS. Use SOMENTE em rotas de servidor e só
 * para RPCs que exigem isso (ex.: criar_agendamento_publico).
 */
export function createAdminClient() {
  const { url } = supabasePublicEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Configure SUPABASE_SERVICE_ROLE_KEY (veja .env.example).");
  return createPlainClient(url, serviceKey, { auth: { persistSession: false } });
}
