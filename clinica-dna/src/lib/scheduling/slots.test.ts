import { describe, expect, it } from "vitest";
import type { HorarioTrabalho, IntervaloOcupado, Servico, Slot } from "@/lib/types/domain";
import {
  FIRST_AVAILABLE,
  computeAvailableSlots,
  getAvailableSlots,
  mergeFirstAvailable,
  type SlotsDataSource,
} from "./slots";

const DIA = "2026-11-16"; // segunda-feira
const ANTES = Date.parse("2026-11-10T12:00:00Z"); // "agora" bem antes do dia testado
const iso = (hhmm: string, date = DIA) => `${date}T${hhmm}:00-03:00`;
const labels = (s: Slot[]) => s.map((x) => x.label);

const servico = { duracao_minutos: 40, buffer_minutos: 10 };
const grade = (prof: string, ...janelas: [string, string][]): HorarioTrabalho[] =>
  janelas.map(([i, f]) => ({ profissional_id: prof, dia_semana: 1, hora_inicio: i, hora_fim: f }));

const base = {
  date: DIA,
  profissionalId: "p1",
  servico,
  ocupados: [] as IntervaloOcupado[],
  now: ANTES,
  minAdvanceMinutes: 30,
  stepMinutes: 30,
};

describe("computeAvailableSlots", () => {
  it("o atendimento precisa caber na janela; o buffer pode passar do fim", () => {
    const slots = computeAvailableSlots({ ...base, horarios: grade("p1", ["08:00", "10:00"]) });
    // 09:30 + 40 = 10:10 > 10:00 → fora; 09:00 + 40 = 09:40 ✓ (buffer até 09:50)
    expect(labels(slots)).toEqual(["08:00", "08:30", "09:00"]);
    expect(slots[0]).toMatchObject({ inicio: iso("08:00"), fim: iso("08:40"), profissionalId: "p1" });
  });

  it("várias janelas no dia (manhã e tarde)", () => {
    const slots = computeAvailableSlots({
      ...base,
      horarios: grade("p1", ["13:00", "14:00"], ["08:00", "09:00"]),
    });
    expect(labels(slots)).toEqual(["08:00", "13:00"]);
  });

  it("respeita atendimentos existentes (com buffer) e o buffer do novo atendimento", () => {
    const ocupados: IntervaloOcupado[] = [
      // 09:00–09:40 + 10 de buffer → ocupado até 09:50
      { profissional_id: "p1", inicio: iso("09:00"), fim: iso("09:50"), tipo: "agendamento" },
    ];
    const slots = computeAvailableSlots({ ...base, ocupados, horarios: grade("p1", ["08:00", "11:00"]) });
    // 08:30 → 08:30–09:10 (+buffer 09:20) colide; 09:30 colide com o buffer até 09:50
    expect(labels(slots)).toEqual(["08:00", "10:00"]);
  });

  it("bloqueios pessoais tiram o horário; intervalos de outro profissional não", () => {
    const ocupados: IntervaloOcupado[] = [
      { profissional_id: "p1", inicio: iso("08:00"), fim: iso("09:00"), tipo: "bloqueio" },
      { profissional_id: "p2", inicio: iso("09:00"), fim: iso("10:00"), tipo: "agendamento" },
    ];
    const slots = computeAvailableSlots({ ...base, ocupados, horarios: grade("p1", ["08:00", "10:00"]) });
    expect(labels(slots)).toEqual(["09:00"]);
  });

  it("não oferece horários dentro da antecedência mínima", () => {
    const now = Date.parse(iso("08:10"));
    const slots = computeAvailableSlots({ ...base, now, horarios: grade("p1", ["08:00", "10:00"]) });
    // mínimo = 08:40 → primeiro passo de 30 min depois disso é 09:00
    expect(labels(slots)).toEqual(["09:00"]);
  });

  it("sem grade no dia → vazio; data inválida → erro", () => {
    expect(computeAvailableSlots({ ...base, horarios: [] })).toEqual([]);
    expect(() => computeAvailableSlots({ ...base, date: "16/11/2026", horarios: [] })).toThrow();
  });
});

describe("mergeFirstAvailable", () => {
  const slot = (prof: string, hhmm: string): Slot => ({
    inicio: iso(hhmm),
    fim: iso(hhmm),
    label: hhmm,
    profissionalId: prof,
  });

  it("escolhe quem tem menos atendimentos no dia", () => {
    const ocupados: IntervaloOcupado[] = [
      { profissional_id: "p1", inicio: iso("14:00"), fim: iso("14:50"), tipo: "agendamento" },
    ];
    const r = mergeFirstAvailable({ p1: [slot("p1", "08:00")], p2: [slot("p2", "08:00")] }, ocupados, DIA);
    expect(r).toEqual([slot("p2", "08:00")]);
  });

  it("bloqueios e atendimentos de outro dia não contam como carga", () => {
    const ocupados: IntervaloOcupado[] = [
      { profissional_id: "p2", inicio: iso("08:00"), fim: iso("18:00"), tipo: "bloqueio" },
      { profissional_id: "p2", inicio: iso("22:00", "2026-11-15"), fim: iso("23:00", "2026-11-15"), tipo: "agendamento" },
      { profissional_id: "p1", inicio: iso("15:00"), fim: iso("15:50"), tipo: "agendamento" },
    ];
    const r = mergeFirstAvailable({ p1: [slot("p1", "09:00")], p2: [slot("p2", "09:00")] }, ocupados, DIA);
    expect(r[0].profissionalId).toBe("p2");
  });

  it("empate mantém a ordem e o resultado sai ordenado por horário", () => {
    const r = mergeFirstAvailable(
      { p1: [slot("p1", "10:00"), slot("p1", "08:00")], p2: [slot("p2", "08:00"), slot("p2", "09:00")] },
      [],
      DIA,
    );
    expect(r.map((s) => `${s.label}/${s.profissionalId}`)).toEqual(["08:00/p1", "09:00/p2", "10:00/p1"]);
  });
});

describe("getAvailableSlots", () => {
  const servicoAtivo: Servico = {
    id: "s1",
    nome: "Consulta",
    descricao: null,
    especialidade: null,
    duracao_minutos: 40,
    preco: 200,
    buffer_minutos: 10,
    ativo: true,
  };

  function fonte(over: Partial<SlotsDataSource> = {}): SlotsDataSource {
    return {
      getParametros: async () => ({ antecedencia_minima_minutos: 30, janela_dias: 30 }),
      getServico: async () => servicoAtivo,
      getProfissionaisIdsDoServico: async () => ["p1", "p2"],
      getHorariosTrabalho: async (ids) => ids.flatMap((id) => grade(id, ["08:00", "10:00"])),
      getIntervalosOcupados: async () => [],
      ...over,
    };
  }

  it("usa a antecedência vinda do banco", async () => {
    const now = Date.parse(iso("07:50"));
    const ds = fonte({ getParametros: async () => ({ antecedencia_minima_minutos: 60, janela_dias: 30 }) });
    const slots = await getAvailableSlots({ profissionalId: "p1", servicoId: "s1", data: DIA, now }, ds);
    expect(slots[0].label).toBe("08:50"); // 07:50 + 60 min
  });

  it("fora da janela de agendamento → vazio", async () => {
    const ds = fonte({ getParametros: async () => ({ antecedencia_minima_minutos: 30, janela_dias: 3 }) });
    expect(await getAvailableSlots({ profissionalId: "p1", servicoId: "s1", data: DIA, now: ANTES }, ds)).toEqual([]);
    // data no passado
    const depois = Date.parse("2026-11-20T12:00:00Z");
    expect(await getAvailableSlots({ profissionalId: "p1", servicoId: "s1", data: DIA, now: depois }, fonte())).toEqual([]);
  });

  it("profissional que não atende o serviço ou serviço inativo → vazio", async () => {
    expect(await getAvailableSlots({ profissionalId: "p9", servicoId: "s1", data: DIA, now: ANTES }, fonte())).toEqual([]);
    const inativo = fonte({ getServico: async () => ({ ...servicoAtivo, ativo: false }) });
    expect(await getAvailableSlots({ profissionalId: "p1", servicoId: "s1", data: DIA, now: ANTES }, inativo)).toEqual([]);
  });

  it("primeiro disponível junta os profissionais habilitados", async () => {
    const ds = fonte({
      getIntervalosOcupados: async () => [
        { profissional_id: "p1", inicio: iso("08:00"), fim: iso("08:50"), tipo: "agendamento" },
      ],
    });
    const slots = await getAvailableSlots(
      { profissionalId: FIRST_AVAILABLE, servicoId: "s1", data: DIA, now: ANTES },
      ds,
    );
    expect(slots.find((s) => s.label === "08:00")?.profissionalId).toBe("p2");
  });
});
