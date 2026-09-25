"use client";

import { useMemo } from "react";
import { Truck } from "lucide-react";
import { ehItemGeral, ITENS, tituloDoAlvo } from "@/lib/domain/items";
import {
  DIAS_SEMANA,
  formatarData,
  formatarDataHora,
  formatarPlaca,
  MESES,
  semanasDoMes,
  todayLocal,
} from "@/lib/domain/dates";
import { effectiveStatus } from "@/lib/domain/status";
import type { InspectionEntry, Observation, Profile, Vehicle } from "@/lib/domain/types";

/**
 * A folha para imprimir / salvar em PDF.
 *
 * Reproduz o conceito do formulário de papel — logo, título, identificação
 * do caminhão, itens 1 a 5 com as descrições, dias da semana, legenda,
 * responsável — em A4 retrato. As regras de `@media print` que fazem isso
 * caber estão em globals.css, portadas do protótipo.
 *
 * Fica sempre no DOM, escondida na tela e visível só na impressão: é o
 * jeito de garantir que o que sai na folha é exatamente isto, sem uma
 * segunda rota que possa divergir da grade.
 */
export function FolhaImpressa({
  veiculo,
  ano,
  mes,
  entradas,
  observacoes,
  perfis,
}: {
  veiculo: Vehicle;
  ano: number;
  mes: number;
  entradas: InspectionEntry[];
  observacoes: Observation[];
  perfis: Profile[];
}) {
  const hoje = todayLocal();
  const semanas = useMemo(() => semanasDoMes(ano, mes), [ano, mes]);
  const nomeDe = (id: string | null) => perfis.find((p) => p.id === id)?.name ?? "—";

  const doMes = entradas.filter((e) => e.entry_date.startsWith(`${ano}-${String(mes).padStart(2, "0")}`));
  const ultima = doMes.reduce<InspectionEntry | null>(
    (a, e) => (!a || e.updated_at > a.updated_at ? e : a),
    null,
  );
  const responsaveis = [...new Set(doMes.map((e) => e.created_by))].map(nomeDe);

  // Uma ordenação só, aplicada às duas listas, para a folha sair sempre na
  // mesma sequência independentemente da ordem em que as linhas chegaram
  // do servidor ou da fila do aparelho.
  const ordenadas = observacoes
    .slice()
    .sort(
      (a, b) =>
        a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at),
    );
  const gerais = ordenadas.filter((o) => ehItemGeral(o.item_number));
  const porItem = ordenadas.filter((o) => !ehItemGeral(o.item_number));

  return (
    <div className="folha hidden bg-white p-8 text-stone-900 print:block">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4 border-b-4 border-marca-400 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-marca-400">
            <Truck size={22} className="text-marca-900" />
          </div>
          <div>
            <p className="text-lg font-black uppercase leading-none tracking-tight text-marca-900">
              Gestão de Entregas
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
              Controle de frota
            </p>
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-sm font-black uppercase tracking-wide text-stone-900">
            Check-list inspeção do caminhão
          </h1>
          <p className="text-xs text-stone-600">
            {MESES[mes - 1]} / {ano}
          </p>
        </div>
      </div>

      {/* Identificação do veículo */}
      <table className="mt-4 w-full border border-stone-300 text-xs">
        <tbody>
          <tr>
            <th className="w-28 border border-stone-300 bg-stone-100 px-2 py-1.5 text-left">Veículo</th>
            <td className="border border-stone-300 px-2 py-1.5 font-semibold">
              {veiculo.brand} {veiculo.model ?? ""}
            </td>
            <th className="w-20 border border-stone-300 bg-stone-100 px-2 py-1.5 text-left">Placa</th>
            <td className="border border-stone-300 px-2 py-1.5 font-mono font-bold tracking-widest">
              {formatarPlaca(veiculo.plate)}
            </td>
            <th className="w-16 border border-stone-300 bg-stone-100 px-2 py-1.5 text-left">Nº</th>
            <td className="border border-stone-300 px-2 py-1.5">{veiculo.internal_code ?? "—"}</td>
          </tr>
        </tbody>
      </table>

      {/* Descrição dos itens */}
      <div className="quebra mt-4">
        <h2 className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-stone-700">
          Itens de inspeção
        </h2>
        <table className="w-full border border-stone-300 text-[10px] leading-snug">
          <tbody>
            {ITENS.map((item) => (
              <tr key={item.numero}>
                <th className="w-6 border border-stone-300 bg-marca-50 px-1 py-1 text-center align-top font-bold">
                  {item.numero}
                </th>
                <th className="w-32 border border-stone-300 bg-marca-50 px-2 py-1 text-left align-top">
                  {item.titulo}
                </th>
                <td className="border border-stone-300 px-2 py-1 align-top">
                  {item.descricao.join(" ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Uma tabela por semana, como na folha */}
      {semanas.map((semana) => {
        const dias = DIAS_SEMANA.map((d) => ({ ...d, data: semana.dias[d.dow] })).filter(
          (d): d is typeof d & { data: string } => Boolean(d.data),
        );
        return (
          <div key={semana.numero} className="quebra mt-3">
            <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-stone-600">
              Semana {semana.numero}
            </h3>
            <table className="w-full border border-stone-300 text-[10px]">
              <thead>
                <tr>
                  <th className="border border-stone-300 bg-marca-50 px-2 py-1 text-left">Item</th>
                  {dias.map((d) => (
                    <th key={d.data} className="border border-stone-300 bg-marca-50 px-1 py-1 text-center">
                      {d.curto}
                      <span className="block font-normal text-stone-500">{d.data.slice(8)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ITENS.map((item) => (
                  <tr key={item.numero}>
                    <th className="border border-stone-300 px-2 py-1 text-left font-semibold">
                      {item.numero}. {item.titulo}
                    </th>
                    {dias.map((d) => {
                      const s = effectiveStatus(entradas, item.numero, d.data, hoje);
                      return (
                        <td
                          key={d.data}
                          className={`border border-stone-300 px-1 py-1 text-center font-bold ${
                            s.status === "NC"
                              ? "bg-naoconforme-50 text-naoconforme-700"
                              : s.status === "C"
                                ? "text-conforme-700"
                                : "text-stone-300"
                          }`}
                        >
                          {s.status ?? "—"}
                          {s.inherited && <span className="text-[8px]">*</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Não conformidades detalhadas */}
      {doMes.some((e) => e.status === "NC") && (
        <div className="quebra mt-4">
          <h2 className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-naoconforme-700">
            Não conformidades registradas
          </h2>
          <table className="w-full border border-stone-300 text-[10px]">
            <thead>
              <tr>
                <th className="border border-stone-300 bg-stone-100 px-2 py-1 text-left">Data</th>
                <th className="border border-stone-300 bg-stone-100 px-2 py-1 text-left">Item</th>
                <th className="border border-stone-300 bg-stone-100 px-2 py-1 text-left">O que foi encontrado</th>
                <th className="border border-stone-300 bg-stone-100 px-2 py-1 text-left">Situação</th>
              </tr>
            </thead>
            <tbody>
              {doMes
                .filter((e) => e.status === "NC")
                .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
                .map((e) => (
                  <tr key={e.id}>
                    <td className="border border-stone-300 px-2 py-1">{formatarData(e.entry_date)}</td>
                    <td className="border border-stone-300 px-2 py-1">
                      {e.item_number}. {ITENS[e.item_number - 1]?.titulo}
                    </td>
                    <td className="border border-stone-300 px-2 py-1">{e.problem_description}</td>
                    <td className="border border-stone-300 px-2 py-1">{e.nc_status}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Observações.
          Duas listas separadas de propósito: quem lê a folha impressa
          precisa distinguir a anotação sobre um item da inspeção da
          anotação do dia (atraso, ocorrência na entrega). Misturadas, como
          estavam, "item 0" apareceria sem significado nenhum no papel. */}
      <div className="quebra mt-4">
        <h2 className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-stone-700">
          Observações gerais do mês
        </h2>
        {gerais.length ? (
          <ul className="space-y-1 border border-stone-300 px-3 py-2 text-[10px]">
            {gerais.map((o) => (
              <li key={o.id}>
                <span className="font-semibold">{formatarData(o.entry_date)}</span> — {o.text}{" "}
                <span className="text-stone-500">({nomeDe(o.author_id)})</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="h-16 border border-stone-300" />
        )}
      </div>

      <div className="quebra mt-4">
        <h2 className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-stone-700">
          Observações por item
        </h2>
        {porItem.length ? (
          <ul className="space-y-1 border border-stone-300 px-3 py-2 text-[10px]">
            {porItem.map((o) => (
              <li key={o.id}>
                <span className="font-semibold">
                  {formatarData(o.entry_date)} · {tituloDoAlvo(o.item_number)}
                </span>{" "}
                — {o.text} <span className="text-stone-500">({nomeDe(o.author_id)})</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="h-12 border border-stone-300" />
        )}
      </div>

      {/* Legenda e responsável */}
      <div className="quebra mt-4 flex items-end justify-between gap-6 border-t-2 border-marca-400 pt-3 text-[10px]">
        <div>
          <p className="font-black uppercase tracking-wide text-stone-700">Legenda</p>
          <p>
            <span className="font-bold text-conforme-700">C</span> = Conforme ·{" "}
            <span className="font-bold text-naoconforme-700">NC</span> = Não Conforme ·{" "}
            <span className="font-bold">*</span> = não conformidade arrastada de um dia anterior,
            ainda não resolvida
          </p>
        </div>
        <div className="text-right">
          <p className="font-black uppercase tracking-wide text-stone-700">
            Responsável pela verificação
          </p>
          <p className="font-semibold">{responsaveis.length ? responsaveis.join(", ") : "—"}</p>
          <p className="text-stone-500">
            Última atualização: {ultima ? formatarDataHora(ultima.updated_at) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
