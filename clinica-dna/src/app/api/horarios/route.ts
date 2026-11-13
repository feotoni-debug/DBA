import { NextResponse, type NextRequest } from "next/server";
import { getAvailableSlots, FIRST_AVAILABLE } from "@/lib/scheduling/slots";
import { supabaseSlotsSource } from "@/lib/scheduling/supabase-source";
import { DATE_RE } from "@/lib/scheduling/time";
import { createAnonClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/horarios?servico=<uuid>&profissional=<uuid|primeiro-disponivel>&data=YYYY-MM-DD */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const servicoId = sp.get("servico") ?? "";
  const profissionalId = sp.get("profissional") ?? "";
  const data = sp.get("data") ?? "";

  if (
    !UUID_RE.test(servicoId) ||
    !(profissionalId === FIRST_AVAILABLE || UUID_RE.test(profissionalId)) ||
    !DATE_RE.test(data)
  ) {
    return NextResponse.json({ erro: "Parâmetros inválidos" }, { status: 400 });
  }

  try {
    const slots = await getAvailableSlots(
      { servicoId, profissionalId, data },
      supabaseSlotsSource(createAnonClient()),
    );
    return NextResponse.json({ slots }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/horarios]", e);
    return NextResponse.json({ erro: "Não foi possível carregar os horários" }, { status: 500 });
  }
}
