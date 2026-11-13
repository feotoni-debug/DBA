"use client";

import { useActionState } from "react";
import { PROXIMOS_STATUS_PROFISSIONAL, STATUS_LABEL } from "@/lib/format";
import type { AgendamentoStatus, UserRole } from "@/lib/types/domain";
import { atualizarStatus, type ResultadoStatus } from "./actions";

const inicial: ResultadoStatus = { ok: true, mensagem: null };

export function StatusForm({ id, status, papel }: { id: string; status: AgendamentoStatus; papel: UserRole }) {
  const [resultado, acao, salvando] = useActionState(atualizarStatus, inicial);

  // Recepção/admin: qualquer status. Profissional: só avançar o atendimento.
  const opcoes: AgendamentoStatus[] =
    papel === "profissional"
      ? [status, ...PROXIMOS_STATUS_PROFISSIONAL[status]]
      : (Object.keys(STATUS_LABEL) as AgendamentoStatus[]);
  if (opcoes.length <= 1) return null;

  return (
    <form action={acao} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        {/* key: volta ao valor salvo quando a gravação falha e a página recarrega */}
        <select
          key={status}
          name="status"
          defaultValue={status}
          className="input w-auto py-1.5 text-sm"
          aria-label="Status do atendimento"
        >
          {opcoes.map((v) => (
            <option key={v} value={v}>
              {STATUS_LABEL[v]}
            </option>
          ))}
        </select>
        <button className="btn-secondary px-3 py-1.5 text-sm" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
      {resultado.mensagem && (
        <p role={resultado.ok ? "status" : "alert"} className={`text-xs ${resultado.ok ? "text-primary" : "text-danger"}`}>
          {resultado.mensagem}
        </p>
      )}
    </form>
  );
}
