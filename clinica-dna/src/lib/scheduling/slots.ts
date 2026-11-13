import { clinic } from "@/config/clinic";
import type {
  HorarioTrabalho,
  IntervaloOcupado,
  ParametrosAgendamento,
  Servico,
  Slot,
} from "@/lib/types/domain";
import {
  DATE_RE,
  MS_PER_MINUTE,
  addDays,
  dayOfWeek,
  epochToLocalDate,
  epochToLocalIso,
  epochToLocalLabel,
  localToEpoch,
  timeToMinutes,
  todayLocal,
} from "./time";

/* =============================================================================
 * Algoritmo de cálculo de slots livres
 *
 * Para um profissional, um serviço e uma data:
 *   1. pega as janelas de trabalho do dia da semana (pode haver mais de uma,
 *      ex.: 08:00–12:00 e 13:00–18:00);
 *   2. percorre cada janela em passos de `stepMinutes`;
 *   3. um candidato ocupa o bloco [início, início + duração + buffer);
 *      o ATENDIMENTO (início + duração) precisa caber inteiro na janela —
 *      o buffer de higienização pode coincidir com o fim do expediente;
 *   4. descarta candidatos que se sobrepõem a qualquer intervalo ocupado
 *      (agendamentos ativos — já com o buffer deles — e bloqueios pessoais);
 *   5. descarta horários no passado / dentro da antecedência mínima.
 *
 * A função `computeAvailableSlots` é pura (sem I/O), o que facilita testes.
 * `getAvailableSlots` faz a orquestração com o repositório de dados.
 * ===========================================================================*/

export interface ComputeSlotsInput {
  date: string; // "YYYY-MM-DD" no fuso da clínica
  profissionalId: string;
  servico: Pick<Servico, "duracao_minutos" | "buffer_minutos">;
  horarios: HorarioTrabalho[];
  ocupados: IntervaloOcupado[];
  /** Antecedência mínima — vem de `parametros_agendamento` no banco. */
  minAdvanceMinutes: number;
  now?: number; // epoch ms (injetável para testes)
  stepMinutes?: number;
}

interface EpochRange {
  start: number;
  end: number;
}

function overlaps(a: EpochRange, b: EpochRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function computeAvailableSlots(input: ComputeSlotsInput): Slot[] {
  const {
    date,
    profissionalId,
    servico,
    horarios,
    ocupados,
    minAdvanceMinutes,
    now = Date.now(),
    stepMinutes = clinic.slotStepMinutes,
  } = input;

  if (!DATE_RE.test(date)) throw new Error(`Data inválida: ${date}`);

  const dow = dayOfWeek(date);
  const janelas = horarios
    .filter((h) => h.profissional_id === profissionalId && h.dia_semana === dow)
    .map((h) => ({ ini: timeToMinutes(h.hora_inicio), fim: timeToMinutes(h.hora_fim) }))
    .sort((a, b) => a.ini - b.ini);

  if (janelas.length === 0) return [];

  const busy: EpochRange[] = ocupados
    .filter((o) => o.profissional_id === profissionalId)
    .map((o) => ({ start: Date.parse(o.inicio), end: Date.parse(o.fim) }))
    .sort((a, b) => a.start - b.start);

  const durMs = servico.duracao_minutos * MS_PER_MINUTE;
  const bufMs = servico.buffer_minutos * MS_PER_MINUTE;
  const stepMs = stepMinutes * MS_PER_MINUTE;
  const earliest = now + minAdvanceMinutes * MS_PER_MINUTE;

  const slots: Slot[] = [];
  const seen = new Set<number>();

  for (const janela of janelas) {
    const windowStart = localToEpoch(date, janela.ini);
    const windowEnd = localToEpoch(date, janela.fim);

    for (let t = windowStart; t + durMs <= windowEnd; t += stepMs) {
      if (t < earliest || seen.has(t)) continue;

      const block: EpochRange = { start: t, end: t + durMs + bufMs };

      // `busy` está ordenado: dá pra parar cedo quando os próximos começam depois do bloco
      let conflict = false;
      for (const b of busy) {
        if (b.start >= block.end) break;
        if (overlaps(block, b)) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue;

      seen.add(t);
      slots.push({
        inicio: epochToLocalIso(t),
        fim: epochToLocalIso(t + durMs),
        label: epochToLocalLabel(t),
        profissionalId,
      });
    }
  }

  return slots;
}

/**
 * "Primeiro disponível": junta os slots de vários profissionais e, para cada
 * horário, escolhe o profissional com MENOS atendimentos no dia (distribui a
 * carga); empate → ordem estável da lista.
 *
 * Só contam atendimentos que começam no próprio `date` — bloqueios pessoais e
 * atendimentos de dias vizinhos (que entram na consulta por causa da folga
 * de buffer) não pesam na escolha.
 */
export function mergeFirstAvailable(
  slotsPorProfissional: Record<string, Slot[]>,
  ocupados: IntervaloOcupado[],
  date: string,
): Slot[] {
  const carga = new Map<string, number>();
  for (const o of ocupados) {
    if (o.tipo !== "agendamento") continue;
    if (epochToLocalDate(Date.parse(o.inicio)) !== date) continue;
    carga.set(o.profissional_id, (carga.get(o.profissional_id) ?? 0) + 1);
  }

  const porHorario = new Map<string, Slot>();
  for (const [profId, slots] of Object.entries(slotsPorProfissional)) {
    for (const s of slots) {
      const atual = porHorario.get(s.inicio);
      if (!atual || (carga.get(profId) ?? 0) < (carga.get(atual.profissionalId) ?? 0)) {
        porHorario.set(s.inicio, s);
      }
    }
  }
  return [...porHorario.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/* -------------------------------------------------------------------------- */
/* Orquestração com a fonte de dados                                           */
/* -------------------------------------------------------------------------- */

export interface SlotsDataSource {
  getParametros(): Promise<ParametrosAgendamento>;
  getServico(servicoId: string): Promise<Servico | null>;
  getProfissionaisIdsDoServico(servicoId: string): Promise<string[]>;
  getHorariosTrabalho(profissionalIds: string[]): Promise<HorarioTrabalho[]>;
  getIntervalosOcupados(profissionalIds: string[], inicioIso: string, fimIso: string): Promise<IntervaloOcupado[]>;
}

export const FIRST_AVAILABLE = "primeiro-disponivel";

/**
 * Recebe `profissionalId` (ou "primeiro-disponivel"), `servicoId` e `data`,
 * consulta grade de trabalho + agendamentos/bloqueios e devolve apenas os
 * horários livres.
 */
export async function getAvailableSlots(
  params: { profissionalId: string; servicoId: string; data: string; now?: number },
  ds: SlotsDataSource,
): Promise<Slot[]> {
  const { profissionalId, servicoId, data, now = Date.now() } = params;
  if (!DATE_RE.test(data)) return [];

  const [parametros, servico] = await Promise.all([ds.getParametros(), ds.getServico(servicoId)]);
  if (!servico || !servico.ativo) return [];

  // Fora da janela de agendamento online → nada a oferecer
  const hoje = todayLocal(now);
  if (data < hoje || data > addDays(hoje, parametros.janela_dias)) return [];

  const habilitados = await ds.getProfissionaisIdsDoServico(servicoId);
  const alvo =
    profissionalId === FIRST_AVAILABLE
      ? habilitados
      : habilitados.includes(profissionalId)
        ? [profissionalId]
        : [];
  if (alvo.length === 0) return [];

  // Janela de consulta: o dia inteiro + folga para buffers que atravessam a meia-noite
  const inicio = new Date(localToEpoch(data, 0) - 4 * 60 * MS_PER_MINUTE).toISOString();
  const fim = new Date(localToEpoch(data, 24 * 60) + 4 * 60 * MS_PER_MINUTE).toISOString();

  const [horarios, ocupados] = await Promise.all([
    ds.getHorariosTrabalho(alvo),
    ds.getIntervalosOcupados(alvo, inicio, fim),
  ]);

  const porProf: Record<string, Slot[]> = {};
  for (const id of alvo) {
    porProf[id] = computeAvailableSlots({
      date: data,
      profissionalId: id,
      servico,
      horarios,
      ocupados,
      now,
      minAdvanceMinutes: parametros.antecedencia_minima_minutos,
    });
  }

  // Slots além do limite exato (janela em dias contada a partir de agora)
  const limite = now + parametros.janela_dias * 24 * 60 * MS_PER_MINUTE;
  const dentroDaJanela = (s: Slot) => Date.parse(s.inicio) <= limite;

  const slots = alvo.length === 1 ? porProf[alvo[0]] : mergeFirstAvailable(porProf, ocupados, data);
  return slots.filter(dentroDaJanela);
}
