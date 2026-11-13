import "server-only";
import { createHmac } from "node:crypto";

/**
 * IP do visitante, usado só para limitar abuso — guardamos um HMAC, nunca o IP.
 *
 * Ordem de confiança:
 *  1. `x-vercel-forwarded-for` — preenchido pela própria Vercel, o cliente não forja;
 *  2. `x-real-ip` — preenchido pelo proxy (Vercel/Nginx);
 *  3. ÚLTIMO valor de `x-forwarded-for` — o que o proxy mais próximo viu. O
 *     PRIMEIRO valor é escrito pelo cliente e não serve para limitar abuso.
 */
export function ipDaRequisicao(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff && xff.length > 0) return xff[xff.length - 1];
  return "desconhecido";
}

export function hashIp(ip: string): string {
  const segredo = process.env.IP_HASH_SECRET;
  if (!segredo) throw new Error("Configure IP_HASH_SECRET (veja .env.example).");
  return createHmac("sha256", segredo).update(ip).digest("hex");
}

/** Ação declarada no widget e conferida na resposta do Turnstile. */
export const CAPTCHA_ACAO = "agendamento";

interface RespostaTurnstile {
  success?: boolean;
  hostname?: string;
  action?: string;
}

/**
 * Verifica o token do Cloudflare Turnstile.
 * - Em produção é obrigatório; em desenvolvimento, sem TURNSTILE_SECRET_KEY,
 *   a verificação é pulada (com aviso no log).
 * - Timeout de 5 s: se a Cloudflare não responder, o pedido falha em vez de
 *   prender a função serverless.
 * - Confere a ação e, em produção, se o token foi emitido para este site.
 */
export async function verificaCaptcha(
  token: string | undefined,
  ip: string,
  hostDaRequisicao: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Configure TURNSTILE_SECRET_KEY em produção (veja .env.example).");
    }
    console.warn("[captcha] TURNSTILE_SECRET_KEY ausente — verificação ignorada em desenvolvimento.");
    return true;
  }
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip !== "desconhecido") body.set("remoteip", ip);

  let json: RespostaTurnstile;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    json = (await res.json()) as RespostaTurnstile;
  } catch (e) {
    console.error("[captcha] falha ao verificar:", (e as Error).name);
    return false;
  }

  if (json.success !== true) return false;
  if (json.action && json.action !== CAPTCHA_ACAO) return false;
  if (process.env.NODE_ENV === "production" && !hostnameConfere(json.hostname, hostDaRequisicao)) return false;
  return true;
}

/**
 * O hostname devolvido pelo Turnstile precisa ser o do site. Por padrão vale o
 * host da requisição; TURNSTILE_HOSTNAMES (separados por vírgula) permite fixar
 * a lista, útil atrás de proxy ou com domínio próprio + domínio da Vercel.
 */
export function hostnameConfere(hostnameToken: string | undefined, hostDaRequisicao: string | null): boolean {
  if (!hostnameToken) return false;
  const permitidos = (process.env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (permitidos.length === 0 && hostDaRequisicao) permitidos.push(hostDaRequisicao.split(":")[0].toLowerCase());
  return permitidos.includes(hostnameToken.toLowerCase());
}
