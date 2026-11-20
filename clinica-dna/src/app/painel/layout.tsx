import Link from "next/link";
import { sair } from "./actions";
import { exigeSessao } from "./sessao";

// Dados por usuário: nunca pré-renderizar nem cachear
export const dynamic = "force-dynamic";

const PAPEL: Record<string, string> = { admin: "Administração", recepcao: "Recepção", profissional: "Profissional" };

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { perfil } = await exigeSessao();

  if (!perfil) {
    return (
      <div className="card mx-auto max-w-md space-y-3">
        <p>Seu usuário ainda não tem um perfil ativo na clínica. Peça ao administrador para liberar o acesso.</p>
        <form action={sair}>
          <button className="btn-secondary">Sair</button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="font-semibold">{perfil.nome}</p>
          <p className="text-sm text-muted">{PAPEL[perfil.role]}</p>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/painel" className="hover:text-primary">
            Agenda
          </Link>
          {perfil.role === "admin" && (
            <Link href="/painel/financeiro" className="hover:text-primary">
              Financeiro
            </Link>
          )}
          <form action={sair}>
            <button className="text-muted hover:text-foreground">Sair</button>
          </form>
        </nav>
      </div>
      {children}
    </div>
  );
}
