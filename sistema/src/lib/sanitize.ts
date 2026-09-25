/**
 * Todo texto livre passa por aqui antes de ir para o banco: descrição de
 * não-conformidade, observação, nome de usuário, marca de veículo.
 * O Postgres não interpreta HTML e o React escapa na renderização — esta
 * é a terceira camada, para o dia em que o mesmo texto for parar num PDF,
 * num e-mail ou num relatório que não escapa nada.
 */
const CONTROLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g;
const TAGS = /<[^>]*>/g;

export function sanitizarTexto(valor: string, limite = 2000): string {
  return valor
    .replace(CONTROLE, "")
    .replace(TAGS, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, limite);
}

export function sanitizarLinha(valor: string, limite = 120): string {
  return sanitizarTexto(valor, limite).replace(/\s+/g, " ");
}

/** Placa: só letras e números, maiúsculas, no máximo 7 caracteres. */
export function sanitizarPlaca(valor: string): string {
  return valor.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
}

export function validarEmail(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor.trim());
}
