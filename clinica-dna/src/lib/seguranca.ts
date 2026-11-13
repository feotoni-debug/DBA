import "server-only";
import { createHmac } from "node:crypto";

/**
 * IP do visitante (atrás da Vercel/proxy vem em x-forwarded-for).
 * Usado só para limitar abuso — guardamos um HMAC, nunca o IP em si.
 */
export function ipDaRequisicao(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "desconhecido";
}

export function hashIp(ip: string): string {
  const segredo = process.env.IP_HASH_SECRET;
  if (!segredo) throw new Error("Configure IP_HASH_SECRET (veja .env.example).");
  return createHmac("sha256", segredo).update(ip).digest("hex");
}

/**
 * Verifica o token do Cloudflare Turnstile.
 * Em produção é obrigatório; em desenvolvimento, sem TURNSTILE_SECRET_KEY,
 * a verificação é pulada (com aviso no log).
 */
export async function verificaCaptcha(token: string | undefined, ip: string): Promise<boolean> {
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
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { success?: boolean };
  return json.success === true;
}
