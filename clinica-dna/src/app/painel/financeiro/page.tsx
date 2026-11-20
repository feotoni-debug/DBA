import type { Metadata } from "next";
import { formataMoeda } from "@/lib/format";
import { localToEpoch, todayLocal } from "@/lib/scheduling/time";
import type { RelatorioFinanceiroLinha } from "@/lib/types/domain";
import { exigeSessao } from "../sessao";

export const metadata: Metadata = { title: "Financeiro" };

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function proximoMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { supabase, perfil } = await exigeSessao();
  if (perfil?.role !== "admin") {
    return <p className="card text-muted">Acesso restrito ao administrador.</p>;
  }

  const { mes: mesParam } = await searchParams;
  const mes = mesParam && MES_RE.test(mesParam) ? mesParam : todayLocal().slice(0, 7);
  const inicio = new Date(localToEpoch(`${mes}-01`, 0)).toISOString();
  const fim = new Date(localToEpoch(`${proximoMes(mes)}-01`, 0)).toISOString();

  const { data, error } = await supabase.rpc("relatorio_financeiro", { p_inicio: inicio, p_fim: fim });
  const linhas = (data ?? []) as RelatorioFinanceiroLinha[];

  const total = (k: keyof RelatorioFinanceiroLinha) => linhas.reduce((s, l) => s + Number(l[k]), 0);
  const colunas: { k: keyof RelatorioFinanceiroLinha; label: string; moeda: boolean }[] = [
    { k: "atendimentos", label: "Atend.", moeda: false },
    { k: "faturamento_bruto", label: "Bruto (concluídos)", moeda: true },
    { k: "recebido", label: "Recebido", moeda: true },
    { k: "pendente", label: "Pendente", moeda: true },
    { k: "repasse", label: "Repasse", moeda: true },
    { k: "liquido_clinica", label: "Líquido clínica", moeda: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Financeiro</h1>
        <form className="flex items-center gap-2">
          <input type="month" name="mes" defaultValue={mes} className="input py-2" />
          <button className="btn-secondary py-2">Ver</button>
        </form>
      </div>

      {error ? (
        <p className="card text-danger">Não foi possível carregar o relatório.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Profissional</th>
                {colunas.map((c) => (
                  <th key={c.k} className="px-4 py-3 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.profissional_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    {l.profissional_nome}
                    <span className="block text-xs text-muted">comissão {Number(l.comissao_percentual)}%</span>
                  </td>
                  {colunas.map((c) => (
                    <td key={c.k} className="px-4 py-3 text-right tabular-nums">
                      {c.moeda ? formataMoeda(l[c.k] as number) : String(l[c.k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border font-semibold">
              <tr>
                <td className="px-4 py-3">Total</td>
                {colunas.map((c) => (
                  <td key={c.k} className="px-4 py-3 text-right tabular-nums">
                    {c.moeda ? formataMoeda(total(c.k)) : total(c.k)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
