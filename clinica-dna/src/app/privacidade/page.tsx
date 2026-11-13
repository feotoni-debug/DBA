import type { Metadata } from "next";
import { clinic } from "@/config/clinic";

export const metadata: Metadata = { title: "Política de privacidade" };

/*
 * MODELO — este texto precisa ser revisado por assessoria jurídica antes de
 * publicar. Ao alterar o conteúdo, atualize `politicaPrivacidadeVersao` em
 * src/config/clinic.ts (cada agendamento registra a versão aceita).
 */
export default function PrivacidadePage() {
  return (
    <article className="mx-auto max-w-2xl space-y-4 leading-relaxed">
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Modelo em revisão — o texto definitivo será validado pela assessoria jurídica da clínica.
      </p>
      <h1 className="text-2xl font-semibold">Política de privacidade</h1>
      <p className="text-sm text-muted">Versão {clinic.politicaPrivacidadeVersao}</p>

      <h2 className="pt-2 text-lg font-semibold">Quem trata seus dados</h2>
      <p>
        {clinic.name}, CNPJ {clinic.cnpj}, {clinic.address}, {clinic.city}. Contato do encarregado de dados:{" "}
        {clinic.email}.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Quais dados coletamos no agendamento</h2>
      <p>Nome, CPF, WhatsApp e, se você informar, e-mail. Também registramos a data em que você aceitou esta política.</p>

      <h2 className="pt-2 text-lg font-semibold">Para que usamos</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Identificar você e marcar o atendimento escolhido;</li>
        <li>Enviar confirmação, lembretes e avisos sobre o atendimento;</li>
        <li>Cumprir obrigações legais e regulatórias da área da saúde, como o prontuário.</li>
      </ul>

      <h2 className="pt-2 text-lg font-semibold">Com quem compartilhamos</h2>
      <p>
        Apenas com os profissionais que vão atender você e com fornecedores necessários ao serviço (hospedagem,
        envio de mensagens e pagamento), sob contrato.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Seus direitos</h2>
      <p>
        Você pode pedir acesso, correção, portabilidade ou eliminação dos seus dados, e revogar este consentimento,
        pelo e-mail {clinic.email} ou pelo WhatsApp {clinic.whatsapp}. Alguns dados de saúde precisam ser mantidos
        pelo prazo exigido em lei mesmo após o pedido.
      </p>
    </article>
  );
}
