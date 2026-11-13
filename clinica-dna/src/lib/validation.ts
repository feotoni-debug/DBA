/**
 * Validações do formulário de agendamento. Espelham as regras da RPC
 * `criar_agendamento_publico` — o banco continua sendo a validação final.
 */

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function cpfValido(cpf: string): boolean {
  const d = onlyDigits(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const nums = d.split("").map(Number);
  const dv = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += nums[i] * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === nums[9] && dv(10) === nums[10];
}

/** DDD + número (10 ou 11 dígitos). Aceita "+55" na frente e remove. */
export function normalizaWhatsapp(input: string): string | null {
  let d = onlyDigits(input);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  return /^[1-9]\d{9,10}$/.test(d) ? d : null;
}

export function emailValido(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

export function normalizaNome(nome: string): string {
  return nome.trim().replace(/\s+/g, " ");
}

export function formataCpf(cpf: string): string {
  const d = onlyDigits(cpf).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export interface DadosPaciente {
  nome: string;
  cpf: string;
  whatsapp: string;
  email: string;
}

/** Devolve os erros por campo (vazio = válido). */
export function validaPaciente(d: DadosPaciente): Partial<Record<keyof DadosPaciente, string>> {
  const erros: Partial<Record<keyof DadosPaciente, string>> = {};
  const nome = normalizaNome(d.nome);
  if (nome.length < 2 || nome.length > 120) erros.nome = "Informe o nome completo";
  if (!cpfValido(d.cpf)) erros.cpf = "CPF inválido";
  if (!normalizaWhatsapp(d.whatsapp)) erros.whatsapp = "Informe DDD + número";
  if (d.email.trim() && !emailValido(d.email)) erros.email = "E-mail inválido";
  return erros;
}
