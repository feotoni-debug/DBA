"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { clinic } from "@/config/clinic";
import { formataDataLonga, formataMoeda, partesData } from "@/lib/format";
import { FIRST_AVAILABLE } from "@/lib/scheduling/slots";
import { addDays, todayLocal } from "@/lib/scheduling/time";
import { createClient } from "@/lib/supabase/client";
import type { PagamentoMetodo, ParametrosAgendamento, Servico, Slot } from "@/lib/types/domain";
import { formataCpf, validaPaciente, type DadosPaciente } from "@/lib/validation";
import { Turnstile, captchaAtivo } from "./Turnstile";

interface ProfissionalPublico {
  id: string;
  nome: string;
  registro_profissional: string | null;
  especialidades: string[];
  bio: string | null;
}

const METODOS: { valor: PagamentoMetodo; label: string }[] = [
  { valor: "pix", label: "Pix" },
  { valor: "cartao_credito", label: "Cartão de crédito (na clínica)" },
  { valor: "cartao_debito", label: "Cartão de débito (na clínica)" },
  { valor: "dinheiro", label: "Dinheiro (na clínica)" },
];

const diasFechados = new Set<number>(
  clinic.hours.filter((h) => h.value === "Fechado").flatMap((h) => h.days),
);

export function Agendamento() {
  // Só no navegador (no prerender do build as variáveis podem não existir)
  const supabase = useMemo(() => (typeof window === "undefined" ? null : createClient()), []);
  const params = useSearchParams();

  const [servicos, setServicos] = useState<Servico[] | null>(null);
  const [parametros, setParametros] = useState<ParametrosAgendamento | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);

  const [servico, setServico] = useState<Servico | null>(null);
  const [profissionais, setProfissionais] = useState<ProfissionalPublico[] | null>(null);
  const [profissionalId, setProfissionalId] = useState<string | null>(null);
  const [data, setData] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);

  const [dados, setDados] = useState<DadosPaciente>({ nome: "", cpf: "", whatsapp: "", email: "" });
  const [errosCampos, setErrosCampos] = useState<Partial<Record<keyof DadosPaciente, string>>>({});
  const [metodo, setMetodo] = useState<PagamentoMetodo>("pix");
  const [aceite, setAceite] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ codigo: string; valor: number } | null>(null);

  // Catálogo e parâmetros
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [s, p] = await Promise.all([
        supabase
          .from("servicos")
          .select("id, nome, descricao, especialidade, duracao_minutos, preco, buffer_minutos, ativo")
          .eq("ativo", true)
          .order("nome"),
        supabase.rpc("parametros_agendamento_publicos").single(),
      ]);
      if (s.error || p.error) {
        setErroCarga("Não foi possível carregar os serviços. Tente novamente em instantes.");
        return;
      }
      const lista = (s.data ?? []) as Servico[];
      setServicos(lista);
      setParametros(p.data as ParametrosAgendamento);
      const pre = params.get("servico");
      if (pre) setServico(lista.find((x) => x.id === pre) ?? null);
    })();
  }, [supabase, params]);

  // Profissionais do serviço
  useEffect(() => {
    setProfissionais(null);
    setProfissionalId(null);
    if (!supabase || !servico) return;
    (async () => {
      const { data: profs, error } = await supabase.rpc("profissionais_do_servico", {
        p_servico_id: servico.id,
      });
      if (error) setErroCarga("Não foi possível carregar os profissionais.");
      else setProfissionais((profs ?? []) as ProfissionalPublico[]);
    })();
  }, [supabase, servico]);

  // Horários do dia
  useEffect(() => {
    setSlots(null);
    setSlot(null);
    if (!servico || !profissionalId || !data) return;
    const ctrl = new AbortController();
    const qs = new URLSearchParams({ servico: servico.id, profissional: profissionalId, data });
    fetch(`/api/horarios?${qs}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j: { slots?: Slot[] }) => setSlots(j.slots ?? []))
      .catch((e) => {
        if (e.name !== "AbortError") setSlots([]);
      });
    return () => ctrl.abort();
  }, [servico, profissionalId, data]);

  const datas = useMemo(() => {
    if (!parametros) return [];
    const hoje = todayLocal();
    const out: string[] = [];
    for (let i = 0; i <= parametros.janela_dias; i++) {
      const d = addDays(hoje, i);
      const [y, m, dd] = d.split("-").map(Number);
      if (!diasFechados.has(new Date(Date.UTC(y, m - 1, dd)).getUTCDay())) out.push(d);
    }
    return out;
  }, [parametros]);

  const nomeProfissional = (id: string) => profissionais?.find((p) => p.id === id)?.nome ?? "";

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!servico || !slot) return;
    const erros = validaPaciente(dados);
    setErrosCampos(erros);
    setErroEnvio(null);
    if (Object.keys(erros).length > 0) return;
    if (!aceite) {
      setErroEnvio("Para agendar, aceite a política de privacidade.");
      return;
    }
    if (captchaAtivo() && !captcha) {
      setErroEnvio("Conclua a verificação de segurança.");
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/agendamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicoId: servico.id,
          profissionalId: slot.profissionalId,
          inicio: slot.inicio,
          ...dados,
          metodoPagamento: metodo,
          aceitePolitica: aceite,
          captchaToken: captcha,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        if (j.campos) setErrosCampos(j.campos);
        setErroEnvio(j.erro ?? "Não foi possível concluir o agendamento.");
        if (res.status === 409 && profissionalId && data) {
          // Horário tomado por outra pessoa: volta para a lista atualizada
          setSlot(null);
          setSlots(null);
          const qs = new URLSearchParams({ servico: servico.id, profissional: profissionalId, data });
          const r2 = await fetch(`/api/horarios?${qs}`);
          setSlots(((await r2.json()) as { slots?: Slot[] }).slots ?? []);
        }
        return;
      }
      setResultado(j);
    } catch {
      setErroEnvio("Falha de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  // ------------------------------------------------------------------ render
  if (erroCarga) return <p className="card text-danger">{erroCarga}</p>;
  if (!servicos) return <p className="text-muted">Carregando…</p>;

  if (resultado && servico && slot) {
    return (
      <div className="card space-y-4 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">Agendamento recebido</p>
        <p className="font-mono text-3xl font-semibold tracking-widest">{resultado.codigo}</p>
        <p>
          {servico.nome} com {nomeProfissional(slot.profissionalId)}
          <br />
          {formataDataLonga(slot.inicio.slice(0, 10))}, às {slot.label}
        </p>
        <p className="text-sm text-muted">
          Valor: {formataMoeda(resultado.valor)} · pagamento pendente (
          {METODOS.find((m) => m.valor === metodo)?.label})
        </p>
        <p className="text-sm text-muted">
          Guarde este código. A confirmação será enviada para o WhatsApp cadastrado.
        </p>
        <ul className="mx-auto max-w-md list-disc pl-5 text-left text-sm text-muted">
          {clinic.instrucoes.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <Link href="/" className="btn-secondary">
          Voltar ao início
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Serviço */}
      <Etapa numero={1} titulo="Serviço" resumo={servico?.nome} onAlterar={servico ? () => setServico(null) : undefined}>
        <ul className="grid gap-2">
          {servicos.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setServico(s)}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left hover:border-primary"
              >
                <span>
                  <span className="block font-medium">{s.nome}</span>
                  <span className="text-sm text-muted">{s.duracao_minutos} min</span>
                </span>
                <span className="font-medium">{formataMoeda(s.preco)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Etapa>

      {/* 2. Profissional */}
      {servico && (
        <Etapa
          numero={2}
          titulo="Profissional"
          resumo={
            profissionalId === FIRST_AVAILABLE
              ? "Primeiro disponível"
              : profissionalId
                ? nomeProfissional(profissionalId)
                : undefined
          }
          onAlterar={profissionalId ? () => setProfissionalId(null) : undefined}
        >
          {!profissionais ? (
            <p className="text-muted">Carregando…</p>
          ) : profissionais.length === 0 ? (
            <p className="text-muted">Nenhum profissional disponível para este serviço no momento.</p>
          ) : (
            <ul className="grid gap-2">
              {profissionais.length > 1 && (
                <li>
                  <OpcaoBotao onClick={() => setProfissionalId(FIRST_AVAILABLE)}>
                    <span className="font-medium">Primeiro disponível</span>
                    <span className="block text-sm text-muted">Mostra todos os horários livres da equipe</span>
                  </OpcaoBotao>
                </li>
              )}
              {profissionais.map((p) => (
                <li key={p.id}>
                  <OpcaoBotao onClick={() => setProfissionalId(p.id)}>
                    <span className="font-medium">{p.nome}</span>
                    <span className="block text-sm text-muted">
                      {[p.registro_profissional, ...p.especialidades].filter(Boolean).join(" · ")}
                    </span>
                  </OpcaoBotao>
                </li>
              ))}
            </ul>
          )}
        </Etapa>
      )}

      {/* 3. Data e horário */}
      {servico && profissionalId && (
        <Etapa
          numero={3}
          titulo="Data e horário"
          resumo={slot && data ? `${formataDataLonga(data)}, às ${slot.label}` : undefined}
          onAlterar={slot ? () => setSlot(null) : undefined}
        >
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {datas.map((d) => {
              const p = partesData(d);
              const ativo = d === data;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setData(d)}
                  aria-pressed={ativo}
                  className={`flex w-16 shrink-0 flex-col items-center rounded-lg border px-2 py-2 text-sm ${
                    ativo ? "border-primary bg-primary text-white" : "border-border bg-surface hover:border-primary"
                  }`}
                >
                  <span className="capitalize">{p.semana}</span>
                  <span className="text-lg font-semibold">{p.dia}</span>
                  <span className="capitalize">{p.mes}</span>
                </button>
              );
            })}
          </div>

          {data && (
            <div className="mt-4">
              {erroEnvio && !slot && (
                <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-danger">{erroEnvio}</p>
              )}
              {!slots ? (
                <p className="text-muted">Buscando horários…</p>
              ) : slots.length === 0 ? (
                <p className="text-muted">Sem horários livres neste dia. Escolha outra data.</p>
              ) : (
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {slots.map((s) => (
                    <li key={`${s.inicio}-${s.profissionalId}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setErroEnvio(null);
                          setSlot(s);
                        }}
                        className="w-full rounded-lg border border-border bg-surface py-2 text-sm font-medium hover:border-primary"
                      >
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Etapa>
      )}

      {/* 4. Dados do paciente */}
      {servico && slot && (
        <Etapa numero={4} titulo="Seus dados">
          {profissionalId === FIRST_AVAILABLE && (
            <p className="mb-4 rounded-lg bg-primary-soft px-3 py-2 text-sm">
              Atendimento com <strong>{nomeProfissional(slot.profissionalId)}</strong>.
            </p>
          )}
          <form onSubmit={confirmar} className="space-y-4" noValidate>
            <Campo label="Nome completo" erro={errosCampos.nome}>
              <input
                className="input"
                autoComplete="name"
                value={dados.nome}
                onChange={(e) => setDados({ ...dados, nome: e.target.value })}
              />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="CPF" erro={errosCampos.cpf}>
                <input
                  className="input"
                  inputMode="numeric"
                  value={dados.cpf}
                  onChange={(e) => setDados({ ...dados, cpf: formataCpf(e.target.value) })}
                />
              </Campo>
              <Campo label="WhatsApp (com DDD)" erro={errosCampos.whatsapp}>
                <input
                  className="input"
                  inputMode="tel"
                  autoComplete="tel-national"
                  value={dados.whatsapp}
                  onChange={(e) => setDados({ ...dados, whatsapp: e.target.value })}
                />
              </Campo>
            </div>
            <Campo label="E-mail (opcional)" erro={errosCampos.email}>
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={dados.email}
                onChange={(e) => setDados({ ...dados, email: e.target.value })}
              />
            </Campo>

            <fieldset>
              <legend className="label">Forma de pagamento</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {METODOS.map((m) => (
                  <label key={m.valor} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                    <input type="radio" name="metodo" checked={metodo === m.valor} onChange={() => setMetodo(m.valor)} />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
              <span>
                Li e aceito a{" "}
                <Link href="/privacidade" target="_blank" className="text-primary underline">
                  política de privacidade
                </Link>{" "}
                e autorizo o uso dos meus dados para agendamento e contato sobre o atendimento.
              </span>
            </label>

            <Turnstile onToken={setCaptcha} />

            <p className="text-sm text-muted">
              Se você já é paciente, as mensagens serão enviadas para o contato que está no seu cadastro. Para
              alterá-lo, fale com a recepção.
            </p>

            {erroEnvio && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-danger">{erroEnvio}</p>}

            <button type="submit" className="btn w-full" disabled={enviando}>
              {enviando ? "Agendando…" : `Confirmar agendamento · ${formataMoeda(servico.preco)}`}
            </button>
          </form>
        </Etapa>
      )}
    </div>
  );
}

function Etapa(props: {
  numero: number;
  titulo: string;
  resumo?: string;
  onAlterar?: () => void;
  children: React.ReactNode;
}) {
  const fechada = Boolean(props.resumo);
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold">
          <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-sm text-primary">
            {props.numero}
          </span>
          {props.titulo}
        </h2>
        {props.onAlterar && (
          <button type="button" onClick={props.onAlterar} className="text-sm text-primary hover:underline">
            Alterar
          </button>
        )}
      </div>
      {fechada ? <p className="mt-2 text-muted">{props.resumo}</p> : <div className="mt-4">{props.children}</div>}
    </section>
  );
}

function OpcaoBotao({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left hover:border-primary"
    >
      {children}
    </button>
  );
}

function Campo({ label, erro, children }: { label: string; erro?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {erro && <span className="mt-1 block text-sm text-danger">{erro}</span>}
    </label>
  );
}
