"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ITENS } from "@/lib/domain/items";
import { DIAS_SEMANA, formatarData, semanasDoMes, todayLocal } from "@/lib/domain/dates";
import { effectiveStatus } from "@/lib/domain/status";
import type { EffectiveStatus, InspectionEntry } from "@/lib/domain/types";
import { Marcador } from "./ui";

/**
 * A grade do mês.
 *
 * Um componente só, dois desenhos: no celular vira lista de dias que
 * abrem; no computador vira a tabela igual à folha impressa. Os dois
 * desenhos leem a MESMA matriz calculada uma única vez logo abaixo —
 * duplicar a lógica seria o caminho mais curto para as duas telas
 * discordarem uma da outra.
 */
export function GradeMensal({
  entradas,
  ano,
  mes,
  aoAbrirCelula,
}: {
  entradas: InspectionEntry[];
  ano: number;
  mes: number;
  aoAbrirCelula?: (item: number, data: string) => void;
}) {
  const hoje = todayLocal();
  const semanas = useMemo(() => semanasDoMes(ano, mes), [ano, mes]);

  // Abre na semana de hoje, não na semana 1: quem abre a grade quer ver o
  // que está acontecendo agora. Em mês passado, abre na primeira.
  const semanaDeHoje = useMemo(() => {
    const i = semanas.findIndex((s) => Object.values(s.dias).includes(hoje));
    return i >= 0 ? i : 0;
  }, [semanas, hoje]);

  const [semanaAberta, setSemanaAberta] = useState(semanaDeHoje);
  const [mesExibido, setMesExibido] = useState(`${ano}-${mes}`);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  // Trocar de mês recoloca a semana certa — ajuste na renderização, sem
  // um efeito que faria a tela piscar na semana errada antes de corrigir.
  if (mesExibido !== `${ano}-${mes}`) {
    setMesExibido(`${ano}-${mes}`);
    setSemanaAberta(semanaDeHoje);
    setDiaAberto(null);
  }

  // A matriz: item × data → status efetivo. Calculada uma vez, usada pelos
  // dois desenhos e pela contagem do cabeçalho.
  const matriz = useMemo(() => {
    const mapa = new Map<string, EffectiveStatus>();
    for (const semana of semanas) {
      for (const data of Object.values(semana.dias)) {
        if (!data) continue;
        for (const item of ITENS) {
          mapa.set(`${item.numero}|${data}`, effectiveStatus(entradas, item.numero, data, hoje));
        }
      }
    }
    return mapa;
  }, [semanas, entradas, hoje]);

  const status = (item: number, data: string) => matriz.get(`${item}|${data}`);

  const semana = semanas[Math.min(semanaAberta, semanas.length - 1)];
  if (!semana) return null;

  const diasDaSemana = DIAS_SEMANA.map((d) => ({ ...d, data: semana.dias[d.dow] })).filter(
    (d): d is typeof d & { data: string } => Boolean(d.data),
  );

  return (
    <div className="space-y-3">
      {/* Seletor de semana: igual nos dois tamanhos de tela. */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {semanas.map((s, i) => (
          <button
            key={s.numero}
            onClick={() => {
              setSemanaAberta(i);
              setDiaAberto(null);
            }}
            className={`toque shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              i === semanaAberta
                ? "bg-marca-800 text-marca-400"
                : "border border-stone-200 bg-white text-stone-600"
            }`}
          >
            Semana {s.numero}
          </button>
        ))}
      </div>

      {/* ---------------- Celular: lista de dias que abrem ---------------- */}
      <ul className="space-y-2 md:hidden">
        {diasDaSemana.map((d) => {
          const aberto = diaAberto === d.data;
          const marcados = ITENS.filter((i) => status(i.numero, d.data)?.status).length;
          const temNC = ITENS.some((i) => status(i.numero, d.data)?.status === "NC");
          return (
            <li key={d.data} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              <button
                onClick={() => setDiaAberto(aberto ? null : d.data)}
                aria-expanded={aberto}
                className="toque flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                {aberto ? (
                  <ChevronDown size={18} className="shrink-0 text-stone-400" />
                ) : (
                  <ChevronRight size={18} className="shrink-0 text-stone-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-stone-900">{d.longo}</p>
                  <p className="text-xs text-stone-500">{formatarData(d.data)}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    temNC
                      ? "bg-naoconforme-50 text-naoconforme-700"
                      : marcados === ITENS.length
                        ? "bg-conforme-50 text-conforme-700"
                        : "bg-stone-100 text-stone-600"
                  }`}
                >
                  {marcados}/{ITENS.length}
                </span>
              </button>

              {aberto && (
                <ul className="divide-y divide-stone-100 border-t border-stone-100">
                  {ITENS.map((item) => {
                    const s = status(item.numero, d.data);
                    return (
                      <li key={item.numero}>
                        <button
                          onClick={() => aoAbrirCelula?.(item.numero, d.data)}
                          className="toque flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-stone-50"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-marca-800 text-[11px] font-bold text-marca-400">
                            {item.numero}
                          </span>
                          <span className="min-w-0 flex-1 text-sm font-semibold text-stone-800">
                            {item.titulo}
                            {s?.inherited && (
                              <span className="block text-[11px] font-normal text-naoconforme-700">
                                arrastada de {formatarData(s.source_date)}
                              </span>
                            )}
                          </span>
                          <Marcador status={s?.status ?? null} herdado={s?.inherited} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {/* ---------------- Computador: a tabela da folha ---------------- */}
      <div className="hidden overflow-x-auto rounded-2xl border border-stone-200 bg-white md:block">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-marca-400 bg-marca-50">
              <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-stone-600">
                Item
              </th>
              {diasDaSemana.map((d) => (
                <th key={d.data} className="px-2 py-2.5 text-center text-xs font-bold text-stone-700">
                  <span className="block">{d.curto}</span>
                  <span className="block text-[10px] font-normal text-stone-500">
                    {d.data.slice(8)}/{d.data.slice(5, 7)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ITENS.map((item) => (
              <tr key={item.numero} className="border-b border-stone-100 last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-semibold text-stone-800">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded bg-marca-800 text-[11px] font-bold text-marca-400">
                    {item.numero}
                  </span>
                  {item.titulo}
                </th>
                {diasDaSemana.map((d) => {
                  const s = status(item.numero, d.data);
                  return (
                    <td key={d.data} className="px-2 py-2 text-center">
                      <button
                        onClick={() => aoAbrirCelula?.(item.numero, d.data)}
                        title={
                          s?.inherited
                            ? `Não conformidade arrastada de ${formatarData(s.source_date)}`
                            : s?.problem_description ?? undefined
                        }
                        className="toque rounded-lg p-0.5"
                      >
                        <Marcador status={s?.status ?? null} herdado={s?.inherited} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Legenda />
    </div>
  );
}

export function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-xs text-stone-600">
      <span className="font-bold uppercase tracking-wide text-stone-500">Legenda</span>
      <span className="flex items-center gap-1.5">
        <Marcador status="C" /> C = Conforme
      </span>
      <span className="flex items-center gap-1.5">
        <Marcador status="NC" /> NC = Não Conforme
      </span>
      <span className="flex items-center gap-1.5">
        <Marcador status="NC" herdado /> arrastada de um dia anterior
      </span>
      <span className="flex items-center gap-1.5">
        <Marcador status={null} /> sem registro
      </span>
    </div>
  );
}
