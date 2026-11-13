import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_COR, STATUS_LABEL, formataDataLonga, formataMoeda } from "@/lib/format";
import { DATE_RE, addDays, dayRangeUtc, epochToLocalLabel, todayLocal } from "@/lib/scheduling/time";
import type { AgendaPainelLinha } from "@/lib/types/domain";
import { StatusForm } from "./StatusForm";
import { exigeSessao } from "./sessao";

export const metadata: Metadata = { title: "Agenda" };

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const { data: dataParam } = await searchParams;
  const data = dataParam && DATE_RE.test(dataParam) ? dataParam : todayLocal();
  const { supabase, perfil } = await exigeSessao();
  if (!perfil) return null;

  // `agenda_painel` devolve só as colunas que o papel do usuário pode ver
  const { inicio, fim } = dayRangeUtc(data);
  const { data: rows, error } = await supabase.rpc("agenda_painel", { p_inicio: inicio, p_fim: fim });
  if (error) console.error("[painel] agenda_painel", error.code, error.message);

  const linhas = (rows ?? []) as AgendaPainelLinha[];
  const ativos = linhas.filter((l) => l.status !== "cancelado");
  const staff = perfil.role !== "profissional";

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

      {error && (
        <p role="alert" className="card text-danger">
          Não foi possível carregar a agenda.
        </p>
      )}

      {!error && linhas.length === 0 && <p className="card text-muted">Nenhum atendimento neste dia.</p>}

      <ul className="space-y-2">
        {linhas.map((l) => (
          <li key={l.id} className="card flex flex-wrap items-center gap-4 py-4">
            <div className="w-24 font-mono">
              <p className="text-lg font-semibold">{epochToLocalLabel(Date.parse(l.data_hora_inicio))}</p>
              <p className="text-xs text-muted">até {epochToLocalLabel(Date.parse(l.data_hora_fim))}</p>
            </div>
            <div className="min-w-48 flex-1">
              <p className="font-medium">{l.paciente_nome}</p>
              <p className="text-sm text-muted">
                {l.servico_nome}
                {staff && ` · ${l.profissional_nome}`}
              </p>
              <p className="text-xs text-muted">
                {l.codigo} · {l.canal === "online" ? "Online" : "Balcão"}
                {l.contato_whatsapp && ` · WhatsApp ${l.contato_whatsapp}`}
                {staff && l.valor !== null && ` · ${formataMoeda(l.valor)}`}
                {staff && l.pagamento_status && ` · pagamento ${l.pagamento_status}`}
              </p>
              {l.contato_divergente && (
                <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                  WhatsApp informado no agendamento é diferente do cadastro — confirme com o paciente
                </p>
              )}
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COR[l.status]}`}>
              {STATUS_LABEL[l.status]}
            </span>
            <StatusForm id={l.id} status={l.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
