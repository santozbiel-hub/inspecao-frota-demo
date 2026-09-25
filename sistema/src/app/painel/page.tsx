"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, CalendarX2, CheckCircle2, ClipboardList, Truck } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Cartao, Etiqueta, Vazio } from "@/components/ui";
import { ITENS, NC_STATUS_ROTULO, itemPorNumero } from "@/lib/domain/items";
import { formatarData, formatarPlaca, todayLocal } from "@/lib/domain/dates";
import { daysWithoutResponse, openNonconformities } from "@/lib/domain/status";
import { useRegistrosDaFrota } from "@/lib/offline/use-registros";

export default function PaginaPainel() {
  const { veiculos, perfis } = useApp();
  const hoje = todayLocal();
  const ativos = useMemo(() => veiculos.filter((v) => v.active), [veiculos]);
  const ids = useMemo(() => ativos.map((v) => v.id), [ativos]);
  const { entradas, carregando } = useRegistrosDaFrota(ids);

  const [ano, mes] = hoje.split("-");
  const prefixoMes = `${ano}-${mes}`;

  const doMes = entradas.filter((e) => e.entry_date.startsWith(prefixoMes));
  const naoConformidades = openNonconformities(entradas);
  const veiculoDe = (id: string) => ativos.find((v) => v.id === id);
  const nomeDe = (id: string | null) => perfis.find((p) => p.id === id)?.name ?? "—";

  // Dias com inspeção incompleta, olhando a frota inteira.
  const alertas = useMemo(() => {
    const lista: { veiculoId: string; dias: string[] }[] = [];
    for (const v of ativos) {
      const doVeiculo = entradas.filter((e) => e.vehicle_id === v.id);
      const dias = new Set<string>();
      for (const item of ITENS) {
        for (const d of daysWithoutResponse(doVeiculo, item.numero, hoje, v.created_at, 6, hoje)) {
          dias.add(d);
        }
      }
      if (dias.size) lista.push({ veiculoId: v.id, dias: [...dias].sort() });
    }
    return lista;
  }, [ativos, entradas, hoje]);

  const registradosHoje = new Set(
    entradas.filter((e) => e.entry_date === hoje).map((e) => `${e.vehicle_id}|${e.item_number}`),
  ).size;
  const esperadosHoje = ativos.length * ITENS.length;

  const metricas = [
    { rotulo: "Veículos ativos", valor: ativos.length, icone: Truck, cor: "text-marca-800" },
    { rotulo: "Registros no mês", valor: doMes.length, icone: ClipboardList, cor: "text-stone-700" },
    {
      rotulo: "Itens de hoje",
      valor: `${registradosHoje}/${esperadosHoje}`,
      icone: CheckCircle2,
      cor: registradosHoje >= esperadosHoje ? "text-conforme-700" : "text-atencao-700",
    },
    {
      rotulo: "NC em aberto",
      valor: naoConformidades.length,
      icone: AlertTriangle,
      cor: naoConformidades.length ? "text-naoconforme-700" : "text-stone-700",
    },
  ];

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Painel</p>
        <h1 className="text-xl font-black text-stone-900">Situação da frota</h1>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metricas.map((m) => (
          <Cartao key={m.rotulo} className="px-4 py-3.5">
            <m.icone size={18} className={m.cor} />
            <p className={`mt-2 text-2xl font-black ${m.cor}`}>{m.valor}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              {m.rotulo}
            </p>
          </Cartao>
        ))}
      </div>

      {carregando && <p className="text-sm text-stone-500">Carregando registros…</p>}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-naoconforme-700">Não conformidades em aberto</h2>
          <Link href="/nao-conformidades" className="toque inline-flex items-center px-2 text-xs font-bold text-stone-500 underline">
            ver todas
          </Link>
        </div>
        {naoConformidades.length === 0 ? (
          <Cartao className="px-4 py-6 text-center text-sm text-stone-500">
            Nenhuma pendência aberta na frota.
          </Cartao>
        ) : (
          <ul className="space-y-2">
            {naoConformidades.slice(0, 4).map((n) => {
              const v = veiculoDe(n.vehicle_id);
              return (
                <li key={n.id}>
                  <Cartao className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-naoconforme-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-stone-900">
                        {itemPorNumero(n.item_number).titulo}
                      </p>
                      <p className="truncate text-xs text-stone-600">{n.problem_description}</p>
                      <p className="mt-1 text-[11px] text-stone-500">
                        {v ? `${v.brand} — ${formatarPlaca(v.plate)}` : "veículo removido"} ·{" "}
                        {formatarData(n.entry_date)} · {nomeDe(n.created_by)}
                      </p>
                    </div>
                    <Etiqueta cor={n.nc_status === "manutencao" ? "ambar" : "vermelho"}>
                      {NC_STATUS_ROTULO[n.nc_status ?? "pendente"]}
                    </Etiqueta>
                  </Cartao>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-atencao-700">Dias sem registro</h2>
        {alertas.length === 0 ? (
          <Cartao className="px-4 py-6 text-center text-sm text-stone-500">
            Nenhuma inspeção em atraso nos últimos dias úteis.
          </Cartao>
        ) : (
          <ul className="space-y-2">
            {alertas.map((a) => {
              const v = veiculoDe(a.veiculoId);
              return (
                <li key={a.veiculoId}>
                  <Cartao className="flex items-start gap-3 px-4 py-3">
                    <CalendarX2 size={18} className="mt-0.5 shrink-0 text-atencao-700" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-stone-900">
                        {v?.brand} — {v ? formatarPlaca(v.plate) : ""}
                      </p>
                      <p className="text-xs text-stone-600">
                        {a.dias.map((d) => formatarData(d)).join(", ")}
                      </p>
                    </div>
                    <Link
                      href={`/grade?veiculo=${a.veiculoId}`}
                      className="toque inline-flex shrink-0 items-center rounded-lg px-2 text-xs font-bold text-marca-800 underline"
                    >
                      abrir
                    </Link>
                  </Cartao>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {ativos.length === 0 && (
        <Vazio
          icone={Truck}
          titulo="Nenhum veículo cadastrado"
          texto="Cadastre o primeiro caminhão para começar."
          acao={
            <Link href="/veiculos" className="toque inline-flex items-center px-2 text-sm font-bold text-marca-800 underline">
              Ir para Veículos
            </Link>
          }
        />
      )}
    </div>
  );
}
