import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** Origem do Supabase (REST + Realtime) liberada no connect-src. */
function supabaseOrigins(): string[] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return ["https://*.supabase.co", "wss://*.supabase.co"];
  const { origin, host, protocol } = new URL(url);
  return [origin, `${protocol === "https:" ? "wss" : "ws"}://${host}`];
}

const TURNSTILE = "https://challenges.cloudflare.com";

/*
 * CSP: o Next injeta scripts inline de hidratação, por isso 'unsafe-inline' em
 * script-src (nonce exigiria renderização dinâmica em todas as páginas).
 * Mesmo assim, a política bloqueia scripts de origens desconhecidas, iframes de
 * terceiros (exceto o captcha), envio de formulários para fora e o site ser
 * embutido em outra página (frame-ancestors 'none' → evita clickjacking).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigins().join(" ")} ${TURNSTILE}`,
  `frame-src ${TURNSTILE}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Dados de pacientes: nunca em cache compartilhado
      {
        source: "/painel/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
