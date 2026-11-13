import { clinic } from "@/config/clinic";

/** Utilitários de data/hora no fuso fixo da clínica (sem dependência de TZ do servidor). */

const MS_MIN = 60_000;
const OFFSET = clinic.utcOffset; // "-03:00"
const OFFSET_MIN = (() => {
  const sign = OFFSET.startsWith("-") ? -1 : 1;
  const [h, m] = OFFSET.slice(1).split(":").map(Number);
  return sign * (h * 60 + m);
})();

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "HH:mm[:ss]" → minutos desde meia-noite */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Epoch (ms) de uma data local da clínica + minutos desde a meia-noite. */
export function localToEpoch(date: string, minutes: number): number {
  return Date.parse(`${date}T${minutesToLabel(minutes)}:00${OFFSET}`);
}

/** Epoch → ISO com offset da clínica (ex.: 2026-11-12T14:30:00-03:00). */
export function epochToLocalIso(epoch: number): string {
  const d = new Date(epoch + OFFSET_MIN * MS_MIN);
  const iso = d.toISOString().slice(0, 19); // "YYYY-MM-DDTHH:mm:ss" já deslocado
  return `${iso}${OFFSET}`;
}

/** Epoch → "HH:mm" no fuso da clínica. */
export function epochToLocalLabel(epoch: number): string {
  return epochToLocalIso(epoch).slice(11, 16);
}

/** Epoch → "YYYY-MM-DD" no fuso da clínica. */
export function epochToLocalDate(epoch: number): string {
  return epochToLocalIso(epoch).slice(0, 10);
}

/** Dia da semana (0 = domingo) de uma data "YYYY-MM-DD". */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Soma dias a uma data "YYYY-MM-DD". */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Hoje no fuso da clínica. */
export function todayLocal(now: number = Date.now()): string {
  return epochToLocalDate(now);
}

/** Intervalo [início, fim) do dia local em ISO UTC — útil para queries. */
export function dayRangeUtc(date: string): { inicio: string; fim: string } {
  return {
    inicio: new Date(localToEpoch(date, 0)).toISOString(),
    fim: new Date(localToEpoch(addDays(date, 1), 0)).toISOString(),
  };
}

export const MS_PER_MINUTE = MS_MIN;
