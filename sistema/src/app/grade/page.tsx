"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Lock, LockOpen, Printer, Truck } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { GradeMensal } from "@/components/grade-mensal";
import { FolhaImpressa } from "@/components/folha-impressa";
import { Aviso, Botao, Cartao, Etiqueta, inputCls, Modal, Vazio } from "@/components/ui";
import { ITENS, NC_STATUS_ROTULO, itemPorNumero } from "@/lib/domain/items";
import { formatarData, formatarDataHora, formatarPlaca, MESES, todayLocal } from "@/lib/domain/dates";
import { effectiveStatus, registrosDoDia } from "@/lib/domain/status";
import { useObservacoesDoVeiculo, useRegistros } from "@/lib/offline/use-registros";
import { supabase } from "@/lib/supabase/client";

export default function PaginaGrade() {
  return (
    <Suspense fallback={<p className="py-8 text-sm text-stone-500">Carregando…</p>}>
      <Grade />
    </Suspense>
  );
}

function Grade() {
  const { veiculos, perfis, ehAdmin, sessao, fechamentos, recarregarCatalogo } = useApp();
  const params = useSearchParams();
  const hoje = todayLocal();

  const [escolhaManual, setEscolhaManual] = useState<string | null>(null);
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)));
  const [celula, setCelula] = useState<{ item: number; data: string } | null>(null);

  // Derivado, não guardado num efeito: o link do painel manda o veículo
  // pela URL e a escolha do usuário passa por cima dele.
  const daUrl = params.get("veiculo");
  const veiculo = useMemo(
    () =>
      veiculos.find((v) => v.id === escolhaManual) ??
      veiculos.find((v) => v.id === daUrl) ??
      veiculos[0] ??
      null,
    [veiculos, escolhaManual, daUrl],
  );
  const veiculoId = veiculo?.id ?? null;
  const { entradas } = useRegistros(veiculoId, 120);
  const observacoes = useObservacoesDoVeiculo(veiculoId);

  const fechamento = fechamentos.find(
    (f) => f.vehicle_id === veiculoId && f.month === mes && f.year === ano,
  );

  const anos = useMemo(() => {
    const atual = Number(hoje.slice(0, 4));
    return [atual - 2, atual - 1, atual, atual + 1];
  }, [hoje]);

  async function alternarFechamento() {
    if (!veiculo || !sessao) return;
    const cliente = supabase();
    if (fechamento) {
      await cliente.from("month_closures").delete().eq("id", fechamento.id);
    } else {
      await cliente.from("month_closures").insert({
        vehicle_id: veiculo.id,
        month: mes,
        year: ano,
        closed_by: sessao.user.id,
      });
    }
    await recarregarCatalogo();
  }

  if (!veiculos.length) {
    return <Vazio icone={Truck} titulo="Nenhum veículo" texto="Cadastre um caminhão para ver a grade." />;
  }

  return (
    <div className="space-y-4">
      <header className="no-print space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Grade mensal</p>
            <h1 className="text-xl font-black text-stone-900">
              {MESES[mes - 1]} de {ano}
            </h1>
          </div>
          <Botao variante="secundario" onClick={() => window.print()}>
            <Printer size={16} />
            <span className="hidden sm:inline">Imprimir / PDF</span>
          </Botao>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select className={inputCls} value={veiculoId ?? ""} onChange={(e) => setEscolhaManual(e.target.value)}>
            {veiculos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.brand} — {formatarPlaca(v.plate)}
                {v.active ? "" : " (inativo)"}
              </option>
            ))}
          </select>
          <select className={inputCls} value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select className={inputCls} value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {fechamento && (
          <Aviso tipo="info">
            Mês fechado em {formatarDataHora(fechamento.closed_at)}. Inspetores não editam mais estes dias.
          </Aviso>
        )}

        {ehAdmin && (
          <Botao variante="secundario" onClick={alternarFechamento}>
            {fechamento ? <LockOpen size={16} /> : <Lock size={16} />}
            {fechamento ? "Reabrir o mês" : "Fechar o mês"}
          </Botao>
        )}
      </header>

      <div className="no-print">
        <GradeMensal
          entradas={entradas}
          ano={ano}
          mes={mes}
          aoAbrirCelula={(item, data) => setCelula({ item, data })}
        />
      </div>

      {veiculo && (
        <FolhaImpressa
          veiculo={veiculo}
          ano={ano}
          mes={mes}
          entradas={entradas}
          observacoes={observacoes.filter((o) =>
            o.entry_date.startsWith(`${ano}-${String(mes).padStart(2, "0")}`),
          )}
          perfis={perfis}
        />
      )}

      <Modal
        aberto={Boolean(celula)}
        aoFechar={() => setCelula(null)}
        titulo={
          celula
            ? `${itemPorNumero(celula.item).titulo} — ${formatarData(celula.data)}`
            : ""
        }
      >
        {celula && veiculo && (
          <DetalheCelula
            item={celula.item}
            data={celula.data}
            entradas={entradas}
            observacoes={observacoes}
            nomeDe={(id) => perfis.find((p) => p.id === id)?.name ?? "—"}
          />
        )}
      </Modal>
    </div>
  );
}

function DetalheCelula({
  item,
  data,
  entradas,
  observacoes,
  nomeDe,
}: {
  item: number;
  data: string;
  entradas: ReturnType<typeof useRegistros>["entradas"];
  observacoes: ReturnType<typeof useObservacoesDoVeiculo>;
  nomeDe: (id: string | null) => string;
}) {
  const hoje = todayLocal();
  const s = effectiveStatus(entradas, item, data, hoje);
  // Cada inspetor tem o próprio registro (migration 015). A célula da
  // grade mostra um só — o mais grave —, então é aqui, no detalhe, que
  // quem lê vê o que cada um marcou.
  const registros = registrosDoDia(entradas, item, data);
  const doDia = observacoes.filter((o) => o.item_number === item && o.entry_date === data);
  const descricao = ITENS[item - 1]?.descricao ?? [];

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {s.status ? (
          <Etiqueta cor={s.status === "C" ? "verde" : "vermelho"}>
            {s.status === "C" ? "Conforme" : "Não Conforme"}
          </Etiqueta>
        ) : (
          <Etiqueta>Sem registro</Etiqueta>
        )}
        {s.inherited && <Etiqueta cor="ambar">arrastada de {formatarData(s.source_date)}</Etiqueta>}
        {s.nc_status && <Etiqueta cor="vermelho">{NC_STATUS_ROTULO[s.nc_status]}</Etiqueta>}
      </div>

      {s.problem_description && (
        <Cartao className="bg-naoconforme-50 px-3 py-2 text-naoconforme-700">
          <p className="text-xs font-bold uppercase tracking-wide">O que foi encontrado</p>
          <p className="mt-0.5">{s.problem_description}</p>
        </Cartao>
      )}

      {registros.length > 1 ? (
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-stone-500">
            Registros deste dia ({registros.length})
          </p>
          <ul className="space-y-1.5">
            {registros.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-stone-700">
                    {nomeDe(e.created_by)}
                  </span>
                  <span className="block text-[11px] text-stone-400">
                    {formatarDataHora(e.updated_at)}
                  </span>
                </span>
                <Etiqueta cor={e.status === "C" ? "verde" : "vermelho"}>
                  {e.status === "C" ? "Conforme" : "Não Conforme"}
                </Etiqueta>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-stone-500">
            A grade mostra o mais grave: basta um Não Conforme para o dia sair como NC.
          </p>
        </div>
      ) : (
        s.created_by && (
          <p className="text-xs text-stone-500">
            Registrado por {nomeDe(s.created_by)} · {formatarDataHora(s.updated_at)}
          </p>
        )
      )}

      {doDia.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-stone-500">Observações</p>
          <ul className="space-y-1.5">
            {doDia.map((o) => (
              <li key={o.id} className="rounded-lg bg-stone-50 px-3 py-2 text-stone-700">
                {o.text}
                <span className="mt-0.5 block text-[11px] text-stone-400">{nomeDe(o.author_id)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-stone-500">O que verificar</p>
        <ul className="space-y-1 text-xs text-stone-600">
          {descricao.map((d) => (
            <li key={d}>• {d}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
