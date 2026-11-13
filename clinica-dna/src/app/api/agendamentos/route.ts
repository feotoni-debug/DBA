import { NextResponse, type NextRequest } from "next/server";
import { clinic } from "@/config/clinic";
import { createAdminClient } from "@/lib/supabase/server";
import { hashIp, ipDaRequisicao, verificaCaptcha } from "@/lib/seguranca";
import type { PagamentoMetodo } from "@/lib/types/domain";
import { normalizaNome, normalizaWhatsapp, onlyDigits, validaPaciente } from "@/lib/validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Pix (online) ou pagar na clínica com cartão de crédito, débito ou dinheiro. */
const METODOS_PUBLICOS: PagamentoMetodo[] = ["pix", "cartao_credito", "cartao_debito", "dinheiro"];

interface Corpo {
  servicoId?: string;
  profissionalId?: string;
  inicio?: string;
  nome?: string;
  cpf?: string;
  whatsapp?: string;
  email?: string;
  metodoPagamento?: PagamentoMetodo;
  aceitePolitica?: boolean;
  captchaToken?: string;
}

const erro = (mensagem: string, status: number) => NextResponse.json({ erro: mensagem }, { status });

/** POST /api/agendamentos — único caminho para o paciente criar um agendamento. */
export async function POST(req: NextRequest) {
  let corpo: Corpo;
  try {
    corpo = (await req.json()) as Corpo;
  } catch {
    return erro("Requisição inválida", 400);
  }

  const { servicoId = "", profissionalId = "", inicio = "", metodoPagamento } = corpo;
  const paciente = {
    nome: corpo.nome ?? "",
    cpf: corpo.cpf ?? "",
    whatsapp: corpo.whatsapp ?? "",
    email: corpo.email ?? "",
  };

  if (!UUID_RE.test(servicoId) || !UUID_RE.test(profissionalId) || Number.isNaN(Date.parse(inicio))) {
    return erro("Escolha serviço, profissional e horário", 400);
  }
  if (!metodoPagamento || !METODOS_PUBLICOS.includes(metodoPagamento)) {
    return erro("Forma de pagamento inválida", 400);
  }
  const erros = validaPaciente(paciente);
  if (Object.keys(erros).length > 0) {
    return NextResponse.json({ erro: "Confira os dados informados", campos: erros }, { status: 400 });
  }
  if (corpo.aceitePolitica !== true) {
    return erro("É necessário aceitar a política de privacidade", 400);
  }

  const ip = ipDaRequisicao(req.headers);
  try {
    if (!(await verificaCaptcha(corpo.captchaToken, ip, req.headers.get("host")))) {
      return erro("Não foi possível confirmar que você não é um robô. Tente novamente.", 400);
    }

    const { data, error } = await createAdminClient()
      .rpc("criar_agendamento_publico", {
        p_servico_id: servicoId,
        p_profissional_id: profissionalId,
        p_inicio: inicio,
        p_nome: normalizaNome(paciente.nome),
        p_cpf: onlyDigits(paciente.cpf),
        p_whatsapp: normalizaWhatsapp(paciente.whatsapp),
        p_email: paciente.email.trim() || null,
        p_metodo_pagamento: metodoPagamento,
        p_consentimento_versao: clinic.politicaPrivacidadeVersao,
        p_ip_hash: hashIp(ip),
      })
      .single();

    if (error) {
      // P0001 = validação, P0002 = horário tomado, P0003 = limite de abuso
      if (error.code === "P0001") return erro(error.message, 400);
      if (error.code === "P0002") return erro(error.message, 409);
      if (error.code === "P0003") return erro(error.message, 429);
      console.error("[api/agendamentos] rpc", error.code, error.message);
      return erro("Não foi possível concluir o agendamento", 500);
    }

    const r = data as { agendamento_id: string; codigo: string; pagamento_id: string; valor: number };
    return NextResponse.json({ codigo: r.codigo, valor: Number(r.valor) }, { status: 201 });
  } catch (e) {
    console.error("[api/agendamentos]", (e as Error).name, (e as Error).message);
    return erro("Não foi possível concluir o agendamento", 500);
  }
}
