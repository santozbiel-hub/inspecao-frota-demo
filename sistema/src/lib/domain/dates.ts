import type { IsoDate } from "./types";

/** A empresa opera em Brasília. Se "hoje" fosse o dia do relógio do
 *  aparelho, um motorista com o celular em outro fuso — ou o servidor em
 *  UTC às 21h — cairia no dia errado. Tudo passa por aqui. */
export const TZ = "America/Sao_Paulo";

const FORMATADOR_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Data de hoje no fuso da empresa, em `YYYY-MM-DD`. */
export function todayLocal(agora: Date = new Date()): IsoDate {
  return FORMATADOR_ISO.format(agora);
}

/** Converte um timestamptz do banco na data local (fuso da empresa). */
export function toLocalDate(timestamp: string | null | undefined): IsoDate | null {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  return FORMATADOR_ISO.format(d);
}

/** Aritmética em cima da string ISO, ancorada ao meio-dia UTC para que
 *  horário de verão e fuso nunca empurrem a data para o dia vizinho. */
function comoData(iso: IsoDate): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  const d = comoData(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado */
export function dayOfWeek(iso: IsoDate): number {
  return comoData(iso).getUTCDay();
}

/** Segunda a sábado. Domingo não é dia de inspeção. */
export function isBusinessDay(iso: IsoDate): boolean {
  return dayOfWeek(iso) !== 0;
}

export function daysBetween(inicio: IsoDate, fim: IsoDate): number {
  return Math.round((comoData(fim).getTime() - comoData(inicio).getTime()) / 86_400_000);
}

export const DIAS_SEMANA = [
  { dow: 1, curto: "Seg", longo: "Segunda-feira" },
  { dow: 2, curto: "Ter", longo: "Terça-feira" },
  { dow: 3, curto: "Qua", longo: "Quarta-feira" },
  { dow: 4, curto: "Qui", longo: "Quinta-feira" },
  { dow: 5, curto: "Sex", longo: "Sexta-feira" },
  { dow: 6, curto: "Sáb", longo: "Sábado" },
] as const;

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
] as const;

export function primeiroDiaDoMes(ano: number, mes: number): IsoDate {
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

export function ultimoDiaDoMes(ano: number, mes: number): IsoDate {
  const d = new Date(Date.UTC(ano, mes, 0));
  return d.toISOString().slice(0, 10);
}

/** Dias úteis do mês, em ordem. */
export function diasUteisDoMes(ano: number, mes: number): IsoDate[] {
  const dias: IsoDate[] = [];
  let d = primeiroDiaDoMes(ano, mes);
  const fim = ultimoDiaDoMes(ano, mes);
  while (d <= fim) {
    if (isBusinessDay(d)) dias.push(d);
    d = addDays(d, 1);
  }
  return dias;
}

export interface SemanaDoMes {
  numero: number;
  dias: Partial<Record<number, IsoDate>>; // dow 1..6 -> data
}

/** Semanas úteis (Seg–Sáb) do mês, com as datas reais — a mesma quebra
 *  da folha impressa. */
export function semanasDoMes(ano: number, mes: number): SemanaDoMes[] {
  const semanas: SemanaDoMes[] = [];
  let atual: SemanaDoMes | null = null;
  for (const dia of diasUteisDoMes(ano, mes)) {
    const dow = dayOfWeek(dia);
    if (!atual || dow === 1) {
      atual = { numero: semanas.length + 1, dias: {} };
      semanas.push(atual);
    }
    atual.dias[dow] = dia;
  }
  return semanas;
}

/** Os N dias úteis anteriores a `data`, do mais recente para o mais antigo. */
export function diasUteisAntes(data: IsoDate, n: number): IsoDate[] {
  const out: IsoDate[] = [];
  let d = addDays(data, -1);
  while (out.length < n) {
    if (isBusinessDay(d)) out.push(d);
    d = addDays(d, -1);
  }
  return out;
}

// ------------------------------------------------------------ formatação
export function formatarData(iso: IsoDate | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function formatarDataHora(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d).replace(", ", " às ");
}

export function formatarDataExtenso(iso: IsoDate): string {
  const d = comoData(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  }).format(d);
}

/** Placa no padrão da folha: 3 letras, espaço, resto. */
export function formatarPlaca(v: string): string {
  const limpa = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  return limpa.length > 3 ? `${limpa.slice(0, 3)} ${limpa.slice(3)}` : limpa;
}

export function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}
