export interface NormalizedInput {
  /** Texto original, preservado para buscas. */
  raw: string;
  /** Texto limpo: minúsculas, sem pontuação, espaços colapsados. */
  text: string;
  /** Texto sem acentos, usado para matching robusto. */
  ascii: string;
}

export function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normaliza a entrada do usuário.
 *
 * - trim, lowercase;
 * - colapsa espaços;
 * - remove pontuação irrelevante;
 * - mantém a versão original (raw) para buscas;
 * - gera variante sem acentos para matching.
 */
export function normalizeInput(input: string): NormalizedInput {
  const raw = input.trim();
  const text = raw
    .toLowerCase()
    .replace(/[.,;:!?¡¿"«»“”'()\[\]{}\\/@#$%^&*_+=<>|~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const ascii = removeAccents(text);
  return { raw, text, ascii };
}