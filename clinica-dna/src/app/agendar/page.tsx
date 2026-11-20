import type { Metadata } from "next";
import { Suspense } from "react";
import { Agendamento } from "./Agendamento";

export const metadata: Metadata = { title: "Agendar consulta" };

export default function AgendarPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold">Agendar consulta</h1>
      <Suspense>
        <Agendamento />
      </Suspense>
    </div>
  );
}
