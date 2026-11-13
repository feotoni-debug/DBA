"use client";

import { useActionState } from "react";
import { STATUS_LABEL } from "@/lib/format";
import type { AgendamentoStatus } from "@/lib/types/domain";
import { atualizarStatus, type ResultadoStatus } from "./actions";

const inicial: ResultadoStatus = { ok: true, mensagem: null };

export function StatusForm({ id, status }: { id: string; status: AgendamentoStatus }) {
  const [resultado, acao, salvando] = useActionState(atualizarStatus, inicial);

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
          {Object.entries(STATUS_LABEL).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
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
