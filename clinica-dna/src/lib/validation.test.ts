import { describe, expect, it } from "vitest";
import { cpfValido, emailValido, formataCpf, normalizaWhatsapp, validaPaciente } from "./validation";

describe("validação do paciente", () => {
  it("CPF: dígitos verificadores, máscara e repetidos", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("39053344705")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cpfValido("123")).toBe(false);
  });

  it("WhatsApp: DDD + número, com ou sem +55", () => {
    expect(normalizaWhatsapp("(11) 91234-5678")).toBe("11912345678");
    expect(normalizaWhatsapp("+55 11 91234-5678")).toBe("11912345678");
    expect(normalizaWhatsapp("1140000000")).toBe("1140000000");
    expect(normalizaWhatsapp("91234-5678")).toBeNull();
    expect(normalizaWhatsapp("01912345678")).toBeNull();
  });

  it("e-mail e máscara de CPF", () => {
    expect(emailValido("a@b.co")).toBe(true);
    expect(emailValido("a@b")).toBe(false);
    expect(formataCpf("52998224725")).toBe("529.982.247-25");
    expect(formataCpf("5299")).toBe("529.9");
  });

  it("validaPaciente aponta cada campo; e-mail é opcional", () => {
    expect(validaPaciente({ nome: "Maria Silva", cpf: "52998224725", whatsapp: "11912345678", email: "" })).toEqual({});
    expect(Object.keys(validaPaciente({ nome: "M", cpf: "1", whatsapp: "1", email: "x" })).sort()).toEqual([
      "cpf",
      "email",
      "nome",
      "whatsapp",
    ]);
  });
});
