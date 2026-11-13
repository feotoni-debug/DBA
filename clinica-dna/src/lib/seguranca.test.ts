import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTCHA_ACAO, hostnameConfere, ipDaRequisicao, verificaCaptcha } from "./seguranca";

const h = (o: Record<string, string>) => new Headers(o);

describe("ipDaRequisicao", () => {
  it("prefere o cabeçalho da Vercel, depois x-real-ip", () => {
    expect(ipDaRequisicao(h({ "x-vercel-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(ipDaRequisicao(h({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "9.9.9.9" }))).toBe("2.2.2.2");
  });

  it("usa o ÚLTIMO x-forwarded-for — o primeiro é escrito pelo cliente", () => {
    expect(ipDaRequisicao(h({ "x-forwarded-for": "6.6.6.6, 3.3.3.3" }))).toBe("3.3.3.3");
    expect(ipDaRequisicao(h({}))).toBe("desconhecido");
  });
});

describe("hostnameConfere", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("compara com o host da requisição (sem porta)", () => {
    expect(hostnameConfere("clinicadna.com.br", "clinicadna.com.br:443")).toBe(true);
    expect(hostnameConfere("outro-site.com", "clinicadna.com.br")).toBe(false);
    expect(hostnameConfere(undefined, "clinicadna.com.br")).toBe(false);
  });

  it("TURNSTILE_HOSTNAMES fixa a lista permitida", () => {
    vi.stubEnv("TURNSTILE_HOSTNAMES", "clinicadna.com.br, clinica-dna.vercel.app");
    expect(hostnameConfere("clinica-dna.vercel.app", "proxy.interno")).toBe(true);
    expect(hostnameConfere("proxy.interno", "proxy.interno")).toBe(false);
  });
});

describe("verificaCaptcha", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const resposta = (json: object) => vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }));

  it("aceita token válido para a ação e o host certos", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "s");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", resposta({ success: true, action: CAPTCHA_ACAO, hostname: "clinicadna.com.br" }));
    expect(await verificaCaptcha("t", "1.1.1.1", "clinicadna.com.br")).toBe(true);
  });

  it("recusa ação diferente, host diferente e token ausente", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "s");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", resposta({ success: true, action: "login", hostname: "clinicadna.com.br" }));
    expect(await verificaCaptcha("t", "1.1.1.1", "clinicadna.com.br")).toBe(false);
    vi.stubGlobal("fetch", resposta({ success: true, action: CAPTCHA_ACAO, hostname: "site-falso.com" }));
    expect(await verificaCaptcha("t", "1.1.1.1", "clinicadna.com.br")).toBe(false);
    expect(await verificaCaptcha(undefined, "1.1.1.1", "clinicadna.com.br")).toBe(false);
  });

  it("falha (sem travar) se a Cloudflare não responder", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "s");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        throw new DOMException("timeout", "TimeoutError");
      }),
    );
    expect(await verificaCaptcha("t", "1.1.1.1", "clinicadna.com.br")).toBe(false);
  });

  it("em produção sem a chave secreta, recusa subir", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(verificaCaptcha("t", "1.1.1.1", "x")).rejects.toThrow(/TURNSTILE_SECRET_KEY/);
  });
});
