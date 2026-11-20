import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  HorarioTrabalho,
  IntervaloOcupado,
  ParametrosAgendamento,
  Servico,
} from "@/lib/types/domain";
import type { SlotsDataSource } from "./slots";

/**
 * Implementação de `SlotsDataSource`.
 * - `publico`: cliente anônimo, para catálogo, profissionais e grade.
 * - `servidor`: cliente service_role, SÓ para `intervalos_ocupados`, que não é
 *   público (a ocupação da agenda não pode ser lida por qualquer um).
 */
export function supabaseSlotsSource(publico: SupabaseClient, servidor: SupabaseClient): SlotsDataSource {
  const supabase = publico;
  return {
    async getParametros() {
      const { data, error } = await supabase.rpc("parametros_agendamento_publicos").single();
      if (error) throw error;
      return data as ParametrosAgendamento;
    },

    async getServico(servicoId) {
      const { data, error } = await supabase
        .from("servicos")
        .select("id, nome, descricao, especialidade, duracao_minutos, preco, buffer_minutos, ativo")
        .eq("id", servicoId)
        .maybeSingle();
      if (error) throw error;
      return data as Servico | null;
    },

    async getProfissionaisIdsDoServico(servicoId) {
      const { data, error } = await supabase.rpc("profissionais_do_servico", { p_servico_id: servicoId });
      if (error) throw error;
      return ((data ?? []) as { id: string }[]).map((p) => p.id);
    },

    async getHorariosTrabalho(profissionalIds) {
      const { data, error } = await supabase
        .from("horarios_trabalho")
        .select("profissional_id, dia_semana, hora_inicio, hora_fim")
        .in("profissional_id", profissionalIds);
      if (error) throw error;
      return (data ?? []) as HorarioTrabalho[];
    },

    async getIntervalosOcupados(profissionalIds, inicioIso, fimIso) {
      const { data, error } = await servidor.rpc("intervalos_ocupados", {
        p_profissional_ids: profissionalIds,
        p_inicio: inicioIso,
        p_fim: fimIso,
      });
      if (error) throw error;
      return (data ?? []) as IntervaloOcupado[];
    },
  };
}
