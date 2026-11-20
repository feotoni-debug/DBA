"use client";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_ID = "cf-turnstile";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Widget do Cloudflare Turnstile. Sem NEXT_PUBLIC_TURNSTILE_SITE_KEY, não renderiza nada.
 *
 * O token vale para uma única verificação no servidor: para obter outro depois
 * de um erro, o componente pai remonta este widget trocando a `key`.
 */
export function Turnstile({
  onToken,
  onErro,
}: {
  onToken: (token: string | null) => void;
  onErro?: () => void;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef({ onToken, onErro });
  cb.current = { onToken, onErro };

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let widgetId: string | undefined;
    const el = ref.current;

    const render = () => {
      if (!window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(el, {
        sitekey: siteKey,
        language: "pt-br",
        action: "agendamento",
        callback: (t: string) => cb.current.onToken(t),
        "expired-callback": () => cb.current.onToken(null),
        "error-callback": () => {
          cb.current.onToken(null);
          cb.current.onErro?.();
        },
      });
    };
    const falhou = () => cb.current.onErro?.();

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    if (window.turnstile) render();
    else {
      script.addEventListener("load", render);
      script.addEventListener("error", falhou);
    }

    return () => {
      script?.removeEventListener("load", render);
      script?.removeEventListener("error", falhou);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      cb.current.onToken(null);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={ref} className="min-h-[65px]" />;
}

export const captchaAtivo = () => Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
