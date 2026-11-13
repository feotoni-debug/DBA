/** Dados institucionais — edite aqui para trocar marca, contato e endereço. */
export const clinic = {
  name: "Clínica DNA",
  shortName: "DNA",
  tagline: "Cuidado multidisciplinar, no seu tempo.",
  phone: "(11) 4000-0000",
  phoneHref: "tel:+551140000000",
  whatsapp: "(11) 90000-0000",
  whatsappHref: "https://wa.me/5511900000000",
  email: "contato@clinicadna.com.br",
  address: "Rua das Acácias, 120 — Sala 4, Centro",
  city: "São Paulo — SP",
  cnpj: "00.000.000/0001-00",
  responsavelTecnico: "Responsável técnica: Dra. Nome Sobrenome — CRM-SP 000000",
  timezone: "America/Sao_Paulo",
  /** Offset fixo do fuso (o Brasil não usa horário de verão desde 2019). */
  utcOffset: "-03:00",
  hours: [
    { label: "Segunda a sexta", value: "07:00 – 20:00", days: [1, 2, 3, 4, 5] },
    { label: "Sábado", value: "08:00 – 13:00", days: [6] },
    { label: "Domingo e feriados", value: "Fechado", days: [0] },
  ],
  instrucoes: [
    "Chegue com 10 minutos de antecedência para o check-in.",
    "Traga documento com foto e, se tiver, exames recentes.",
    "Cancelamentos ou remarcações: até 24h antes, pelo WhatsApp.",
  ],
  /** Antecedência mínima para agendar online (minutos). */
  minAdvanceMinutes: 30,
  /** Quantos dias à frente o paciente pode agendar. */
  bookingWindowDays: 30,
  /** Granularidade de início dos horários oferecidos (minutos). */
  slotStepMinutes: 10,
} as const;
