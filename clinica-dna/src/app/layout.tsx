import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { clinic } from "@/config/clinic";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: clinic.name, template: `%s · ${clinic.name}` },
  description: `${clinic.name} — ${clinic.tagline} Agende sua consulta online.`,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}>
        <header className="border-b border-border bg-surface">
          <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="text-lg font-semibold text-primary">
              {clinic.name}
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/agendar" className="btn py-2">
                Agendar
              </Link>
              <Link href="/painel" className="text-muted hover:text-foreground">
                Equipe
              </Link>
            </div>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>

        <footer className="border-t border-border bg-surface text-sm text-muted">
          <div className="mx-auto grid max-w-5xl gap-2 px-4 py-6 sm:grid-cols-2">
            <div>
              <p className="font-medium text-foreground">{clinic.name}</p>
              <p>
                {clinic.address} · {clinic.city}
              </p>
              <p>CNPJ {clinic.cnpj}</p>
              <p>{clinic.responsavelTecnico}</p>
            </div>
            <div className="sm:text-right">
              <p>
                <a href={clinic.phoneHref} className="hover:text-foreground">
                  {clinic.phone}
                </a>{" "}
                ·{" "}
                <a href={clinic.whatsappHref} className="hover:text-foreground">
                  WhatsApp {clinic.whatsapp}
                </a>
              </p>
              <p>{clinic.email}</p>
              <p>
                <Link href="/privacidade" className="underline hover:text-foreground">
                  Política de privacidade
                </Link>
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
