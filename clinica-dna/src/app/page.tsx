import Link from "next/link";
import { clinic } from "@/config/clinic";
import { formataMoeda } from "@/lib/format";
import { createAnonClient } from "@/lib/supabase/server";
import type { Servico } from "@/lib/types/domain";

// Catálogo atualizado a cada 5 minutos
export const revalidate = 300;

async function carregaServicos(): Promise<Servico[]> {
  try {
    const { data, error } = await createAnonClient()
      .from("servicos")
      .select("id, nome, descricao, especialidade, duracao_minutos, preco, buffer_minutos, ativo")
      .eq("ativo", true)
      .order("nome");
    if (error) throw error;
    return (data ?? []) as Servico[];
  } catch (e) {
    console.error("[home] serviços", e);
    return [];
  }
}

export default async function Home() {
  const servicos = await carregaServicos();

  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-primary-soft px-6 py-12 sm:px-10">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{clinic.name}</h1>
        <p className="mt-3 max-w-xl text-lg text-muted">{clinic.tagline}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/agendar" className="btn">
            Agendar consulta
          </Link>
          <a href={clinic.whatsappHref} className="btn-secondary">
            Falar no WhatsApp
          </a>
        </div>
      </section>

      {servicos.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold">Especialidades</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {servicos.map((s) => (
              <li key={s.id} className="card flex flex-col">
                <p className="text-xs font-medium uppercase tracking-wide text-primary">{s.especialidade}</p>
                <h3 className="mt-1 font-semibold">{s.nome}</h3>
                {s.descricao && <p className="mt-2 flex-1 text-sm text-muted">{s.descricao}</p>}
                <p className="mt-4 text-sm">
                  {s.duracao_minutos} min · <strong>{formataMoeda(s.preco)}</strong>
                </p>
                <Link href={`/agendar?servico=${s.id}`} className="mt-3 text-sm font-medium text-primary hover:underline">
                  Agendar →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-semibold">Horário de funcionamento</h2>
          <dl className="space-y-1 text-sm">
            {clinic.hours.map((h) => (
              <div key={h.label} className="flex justify-between gap-4">
                <dt className="text-muted">{h.label}</dt>
                <dd>{h.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="card">
          <h2 className="mb-3 font-semibold">Antes da consulta</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {clinic.instrucoes.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
