import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_COR, STATUS_LABEL, formataDataLonga, formataMoeda } from "@/lib/format";
import { DATE_RE, addDays, dayRangeUtc, epochToLocalLabel, todayLocal } from "@/lib/scheduling/time";
import type { AgendamentoStatus } from "@/lib/types/domain";
import { atualizarStatus } from "./actions";
import { exigeSessao } from "./sessao";

export const metadata: Metadata = { title: "Agenda" };

interface Linha {
  id: string;
  codigo: string;
  data_hora_inicio: string;
  data_hora_fim: string;
  status: AgendamentoStatus;
  canal: "online" | "balcao";
  valor: number;
  observacoes: string | null;
  cliente: { nome: string; whatsapp: string } | null;
  servico: { nome: string } | null;
  profissional: { id: string; perfil: { nome: string } | null } | null;
  pagamentos: { status: string; metodo: string }[];
}

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const { data: dataParam } = await searchParams;
  const data = dataParam && DATE_RE.test(dataParam) ? dataParam : todayLocal();
  const { supabase, perfil } = await exigeSessao();
  if (!perfil) return null;

  const { inicio, fim } = dayRangeUtc(data);
  const { data: rows, error } = await supabase
    .from("agendamentos")
    .select(
      `id, codigo, data_hora_inicio, data_hora_fim, status, canal, valor, observacoes,
       cliente:clientes (nome, whatsapp),
       servico:servicos (nome),
       profissional:profissionais (id, perfil:perfis (nome)),
       pagamentos (status, metodo)`,
    )
    .gte("data_hora_inicio", inicio)
    .lt("data_hora_inicio", fim)
    .order("data_hora_inicio");

  const linhas = (rows ?? []) as unknown as Linha[];
  const ativos = linhas.filter((l) => l.status !== "cancelado");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold capitalize">{formataDataLonga(data)}</h1>
          <p className="text-sm text-muted">
            {ativos.length} {ativos.length === 1 ? "atendimento" : "atendimentos"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/painel?data=${addDays(data, -1)}`} className="btn-secondary px-3" aria-label="Dia anterior">
            ←
          </Link>
          <form className="flex items-center gap-2">
            <input type="date" name="data" defaultValue={data} className="input py-2" aria-label="Data" />
            <button className="btn-secondary py-2">Ir</button>
          </form>
          <Link href={`/painel?data=${addDays(data, 1)}`} className="btn-secondary px-3" aria-label="Próximo dia">
            →
          </Link>
          {data !== todayLocal() && (
            <Link href="/painel" className="text-sm text-primary hover:underline">
              Hoje
            </Link>
          )}
        </div>
      </div>

      {error && <p className="card text-danger">Não foi possível carregar a agenda.</p>}

      {!error && linhas.length === 0 && <p className="card text-muted">Nenhum atendimento neste dia.</p>}

      <ul className="space-y-2">
        {linhas.map((l) => {
          const pag = l.pagamentos[0];
          return (
            <li key={l.id} className="card flex flex-wrap items-center gap-4 py-4">
              <div className="w-24 font-mono">
                <p className="text-lg font-semibold">{epochToLocalLabel(Date.parse(l.data_hora_inicio))}</p>
                <p className="text-xs text-muted">até {epochToLocalLabel(Date.parse(l.data_hora_fim))}</p>
              </div>
              <div className="min-w-48 flex-1">
                <p className="font-medium">{l.cliente?.nome ?? "—"}</p>
                <p className="text-sm text-muted">
                  {l.servico?.nome}
                  {perfil.role !== "profissional" && l.profissional?.perfil && ` · ${l.profissional.perfil.nome}`}
                </p>
                <p className="text-xs text-muted">
                  {l.codigo} · {l.canal === "online" ? "Online" : "Balcão"}
                  {l.cliente?.whatsapp && ` · WhatsApp ${l.cliente.whatsapp}`}
                  {perfil.role !== "profissional" && ` · ${formataMoeda(l.valor)}`}
                  {pag && ` · pagamento ${pag.status}`}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COR[l.status]}`}>
                {STATUS_LABEL[l.status]}
              </span>
              <form action={atualizarStatus} className="flex items-center gap-2">
                <input type="hidden" name="id" value={l.id} />
                <select name="status" defaultValue={l.status} className="input w-auto py-1.5 text-sm" aria-label="Status">
                  {Object.entries(STATUS_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <button className="btn-secondary px-3 py-1.5 text-sm">Salvar</button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
