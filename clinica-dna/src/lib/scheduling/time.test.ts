import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeek,
  dayRangeUtc,
  epochToLocalDate,
  epochToLocalIso,
  epochToLocalLabel,
  localToEpoch,
  timeToMinutes,
  todayLocal,
} from "./time";

describe("time", () => {
  it("converte horário local da clínica (-03:00) para epoch e volta", () => {
    const t = localToEpoch("2026-11-16", 9 * 60 + 30);
    expect(new Date(t).toISOString()).toBe("2026-11-16T12:30:00.000Z");
    expect(epochToLocalIso(t)).toBe("2026-11-16T09:30:00-03:00");
    expect(epochToLocalLabel(t)).toBe("09:30");
  });

  it("data local muda à meia-noite de São Paulo, não à meia-noite UTC", () => {
    const t = Date.parse("2026-11-17T02:00:00Z"); // 23:00 do dia 16 em SP
    expect(epochToLocalDate(t)).toBe("2026-11-16");
    expect(todayLocal(t)).toBe("2026-11-16");
  });

  it("dia da semana e soma de dias atravessando mês/ano", () => {
    expect(dayOfWeek("2026-11-15")).toBe(0); // domingo
    expect(dayOfWeek("2026-11-16")).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("aceita HH:mm:ss vindo do Postgres", () => {
    expect(timeToMinutes("13:45:00")).toBe(13 * 60 + 45);
  });

  it("intervalo do dia em UTC", () => {
    expect(dayRangeUtc("2026-11-16")).toEqual({
      inicio: "2026-11-16T03:00:00.000Z",
      fim: "2026-11-17T03:00:00.000Z",
    });
  });
});
