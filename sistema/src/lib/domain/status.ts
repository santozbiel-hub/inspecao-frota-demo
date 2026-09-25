import type { EffectiveStatus, InspectionEntry, IsoDate } from "./types";
import { addDays, isBusinessDay, toLocalDate, todayLocal } from "./dates";

/**
 * ATENÇÃO — espelho de propósito.
 *
 * A autoridade sobre estas regras é o Postgres: `public.effective_entries`
 * e `public.days_without_response` (migration 002). Todo caminho online
 * lê de lá. Este arquivo existe por um único motivo: o motorista marca
 * itens em pátio e doca, sem sinal, e a tela precisa mostrar o efeito da
 * marcação que acabou de entrar na fila local antes de o servidor ver.
 *
 * As duas implementações são checadas uma contra a outra em
 * `tests/paridade-sql.test.ts`: os mesmos cenários rodam no Postgres e
 * aqui, e o teste falha se divergirem. Ao mexer numa, mexa na outra.
 */

const ITENS_VALIDOS = [1, 2, 3, 4, 5];

/**
 * Não-conformidade do mesmo item e veículo, anterior a esta data, que o
 * administrador ainda não marcou como resolvida. Depois de resolvida ela
 * para de arrastar — mas continua marcada nos dias em que de fato esteve
 * aberta, por isso a comparação é com a data da resolução.
 */
export function openNonconformity(
  entries: InspectionEntry[],
  itemNumber: number,
  date: IsoDate,
): InspectionEntry | null {
  let achada: InspectionEntry | null = null;
  for (const e of entries) {
    if (e.item_number !== itemNumber) continue;
    if (e.entry_date >= date) continue;
    if (e.status !== "NC") continue;
    if (e.nc_status === "resolvido") {
      const resolvidoEm = toLocalDate(e.resolved_at);
      if (!resolvidoEm || resolvidoEm < date) continue;
    }
    if (!achada || maisRelevante(e, achada)) achada = e;
  }
  return achada;
}

/**
 * Desempate entre dois registros do mesmo item — espelho do `order by` de
 * `open_nonconformity` e `effective_entries` no SQL.
 *
 * Desde que cada inspetor passou a ter o próprio registro (migration 015),
 * pode haver mais de uma linha no mesmo item e dia. A regra da empresa é
 * "o mais grave manda": um Não Conforme que alguém viu nunca é escondido
 * por um Conforme de outro. Entre não conformidades, a ainda aberta vem
 * antes da resolvida; e, no empate, a mais recente.
 */
function maisRelevante(candidata: InspectionEntry, atual: InspectionEntry): boolean {
  if (candidata.entry_date !== atual.entry_date) {
    return candidata.entry_date > atual.entry_date;
  }
  const aberta = (e: InspectionEntry) => (e.nc_status !== "resolvido" ? 1 : 0);
  if (aberta(candidata) !== aberta(atual)) return aberta(candidata) > aberta(atual);
  return (candidata.updated_at ?? "") > (atual.updated_at ?? "");
}

/**
 * O registro que representa o item naquele dia, entre os de todos os
 * inspetores. Mesma ordenação do `left join lateral` de
 * `effective_entries`: Não Conforme primeiro, depois NC aberta, depois a
 * mais recente.
 */
function registroDoDia(
  entries: InspectionEntry[],
  itemNumber: number,
  date: IsoDate,
): InspectionEntry | null {
  let escolhida: InspectionEntry | null = null;
  for (const e of entries) {
    if (e.item_number !== itemNumber || e.entry_date !== date) continue;
    if (!escolhida) {
      escolhida = e;
      continue;
    }
    const nc = (x: InspectionEntry) => (x.status === "NC" ? 1 : 0);
    if (nc(e) !== nc(escolhida)) {
      if (nc(e) > nc(escolhida)) escolhida = e;
      continue;
    }
    if (maisRelevante(e, escolhida)) escolhida = e;
  }
  return escolhida;
}

/** Todos os registros de um item num dia, de qualquer inspetor, do mais
 *  grave para o menos — para as telas que mostram quem registrou o quê. */
export function registrosDoDia(
  entries: InspectionEntry[],
  itemNumber: number,
  date: IsoDate,
): InspectionEntry[] {
  return entries
    .filter((e) => e.item_number === itemNumber && e.entry_date === date)
    .sort((a, b) => {
      const nc = (x: InspectionEntry) => (x.status === "NC" ? 1 : 0);
      if (nc(a) !== nc(b)) return nc(b) - nc(a);
      return maisRelevante(a, b) ? -1 : 1;
    });
}

/** O status que vale para o dia: o que foi marcado, ou a pendência que
 *  veio se arrastando. Dia futuro nunca herda nada. */
export function effectiveStatus(
  entries: InspectionEntry[],
  itemNumber: number,
  date: IsoDate,
  hoje: IsoDate = todayLocal(),
): EffectiveStatus {
  const base: EffectiveStatus = {
    item_number: itemNumber,
    entry_date: date,
    status: null,
    nc_status: null,
    problem_description: null,
    photo_url: null,
    inherited: false,
    source_date: null,
    entry_id: null,
    created_by: null,
    updated_at: null,
  };

  const marcada = registroDoDia(entries, itemNumber, date);
  if (marcada) {
    return {
      ...base,
      status: marcada.status,
      nc_status: marcada.nc_status,
      problem_description: marcada.problem_description,
      photo_url: marcada.photo_url,
      entry_id: marcada.id,
      created_by: marcada.created_by,
      updated_at: marcada.updated_at,
    };
  }

  if (date > hoje) return base;

  const pendencia = openNonconformity(entries, itemNumber, date);
  if (!pendencia) return base;

  return {
    ...base,
    status: "NC",
    nc_status: pendencia.nc_status,
    problem_description: pendencia.problem_description,
    photo_url: pendencia.photo_url,
    inherited: true,
    source_date: pendencia.entry_date,
  };
}

/** A grade inteira (5 itens × dias úteis do período) já resolvida. */
export function effectiveGrid(
  entries: InspectionEntry[],
  from: IsoDate,
  to: IsoDate,
  hoje: IsoDate = todayLocal(),
): EffectiveStatus[] {
  const out: EffectiveStatus[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isBusinessDay(d)) continue;
    for (const item of ITENS_VALIDOS) {
      out.push(effectiveStatus(entries, item, d, hoje));
    }
  }
  return out;
}

/**
 * Dias úteis logo antes desta data em que ninguém marcou nada. Janela
 * deslizante: atravessa a virada do mês (no protótipo o alerta zerava
 * todo dia 1º) e nunca olha antes do cadastro do veículo, senão um
 * caminhão novo nasceria cheio de alerta.
 */
export function daysWithoutResponse(
  entries: InspectionEntry[],
  itemNumber: number,
  date: IsoDate,
  vehicleCreatedAt: string,
  lookback = 12,
  hoje: IsoDate = todayLocal(),
): IsoDate[] {
  const inicio = toLocalDate(vehicleCreatedAt);
  if (!inicio) return [];

  const faltantes: IsoDate[] = [];
  let d = addDays(date, -1);
  let n = 0;

  while (n < lookback && d >= inicio) {
    if (isBusinessDay(d) && d <= hoje) {
      n += 1;
      const temResposta = entries.some(
        (e) => e.item_number === itemNumber && e.entry_date === d,
      );
      if (temResposta) break;
      faltantes.unshift(d);
    }
    d = addDays(d, -1);
  }
  return faltantes;
}

/** Dias em que a inspeção ficou incompleta (menos de 5 itens marcados). */
export function incompleteDays(
  entries: InspectionEntry[],
  from: IsoDate,
  to: IsoDate,
  hoje: IsoDate = todayLocal(),
): { entry_date: IsoDate; marcados: number; faltando: number }[] {
  const limite = to > hoje ? hoje : to;
  const out: { entry_date: IsoDate; marcados: number; faltando: number }[] = [];
  for (let d = from; d <= limite; d = addDays(d, 1)) {
    if (!isBusinessDay(d)) continue;
    // Itens DISTINTOS respondidos, não número de respostas: dois
    // inspetores marcando os mesmos cinco itens dariam dez e o dia nunca
    // mais apareceria como incompleto.
    const marcados = new Set(
      entries.filter((e) => e.entry_date === d).map((e) => e.item_number),
    ).size;
    if (marcados < 5) out.push({ entry_date: d, marcados, faltando: 5 - marcados });
  }
  return out.reverse();
}

/** Não-conformidades em aberto (o que a tela do administrador lista). */
export function openNonconformities(entries: InspectionEntry[]): InspectionEntry[] {
  return entries
    .filter((e) => e.status === "NC" && e.nc_status !== "resolvido")
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
}
