"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ImageIcon, MessageSquareText, Wrench } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Aviso, Botao, Cartao, Etiqueta, Modal, Vazio } from "@/components/ui";
import { NC_STATUS_ROTULO, itemPorNumero, tituloDoAlvo } from "@/lib/domain/items";
import { daysBetween, formatarData, formatarPlaca, plural, todayLocal } from "@/lib/domain/dates";
import type { NcStatus } from "@/lib/domain/types";
import { useObservacoesDaFrota, useRegistrosDaFrota } from "@/lib/offline/use-registros";
import { supabase } from "@/lib/supabase/client";
import { baixarRegistros } from "@/lib/offline/sync";
import { obterUrlFoto } from "@/lib/offline/foto";
import { addDays } from "@/lib/domain/dates";

const JANELA_DIAS = 180;

const FILTROS: { valor: "abertas" | NcStatus | "observacoes" | "todas"; rotulo: string }[] = [
  { valor: "abertas", rotulo: "Em aberto" },
  { valor: "pendente", rotulo: "Pendentes" },
  { valor: "manutencao", rotulo: "Em manutenção" },
  { valor: "resolvido", rotulo: "Resolvidas" },
  { valor: "observacoes", rotulo: "Observações" },
  { valor: "todas", rotulo: "Todas" },
];

export default function PaginaNaoConformidades() {
  const { veiculos, perfis, ehAdmin } = useApp();
  const hoje = todayLocal();
  const ids = useMemo(() => veiculos.map((v) => v.id), [veiculos]);
  const { entradas, carregando } = useRegistrosDaFrota(ids, JANELA_DIAS);
  const { observacoes, carregando: carregandoObs } = useObservacoesDaFrota(ids, JANELA_DIAS);

  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["valor"]>("abertas");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);

  const [modalFotoAberto, setModalFotoAberto] = useState(false);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [carregandoFoto, setCarregandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState("");

  async function verFoto(caminho: string) {
    setErroFoto("");
    setFotoUrl(null);
    setModalFotoAberto(true); // abre o modal já, com o spinner, antes da URL chegar
    setCarregandoFoto(true);
    try {
      const url = await obterUrlFoto(caminho);
      setFotoUrl(url);
    } catch {
      setErroFoto("Não foi possível carregar a foto agora. Tente de novo quando o sinal estiver melhor.");
    } finally {
      setCarregandoFoto(false);
    }
  }

  const nomeDe = (id: string | null) => perfis.find((p) => p.id === id)?.name ?? "—";
  const veiculoDe = (id: string) => veiculos.find((v) => v.id === id);

  const lista = useMemo(() => {
    const ncs = entradas.filter((e) => e.status === "NC");
    const filtradas =
      filtro === "abertas"
        ? ncs.filter((e) => e.nc_status !== "resolvido")
        : filtro === "todas"
          ? ncs
          : ncs.filter((e) => e.nc_status === filtro);
    return filtradas.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [entradas, filtro]);

  // Observações mais recentes primeiro. Não importa se o item ficou
  // Conforme ou Não Conforme: quem escreveu quis que alguém lesse.
  const listaObs = useMemo(
    () =>
      observacoes
        .slice()
        .sort(
          (a, b) =>
            b.entry_date.localeCompare(a.entry_date) ||
            b.created_at.localeCompare(a.created_at),
        ),
    [observacoes],
  );

  /** As observações escritas naquele mesmo item, naquele mesmo dia. */
  const obsDoRegistro = (vehicleId: string, item: number, data: string) =>
    listaObs.filter(
      (o) => o.vehicle_id === vehicleId && o.item_number === item && o.entry_date === data,
    );

  async function mudarSituacao(id: string, vehicleId: string, novo: NcStatus) {
    setErro("");
    setOcupado(id);
    try {
      const { error } = await supabase()
        .from("inspection_entries")
        .update({ nc_status: novo })
        .eq("id", id);
      if (error) {
        setErro(
          error.code === "42501"
            ? "Só o administrador pode alterar a situação de uma não conformidade."
            : "Não foi possível atualizar agora. Tente de novo quando o sinal estiver melhor.",
        );
        return;
      }
      await baixarRegistros(vehicleId, addDays(hoje, -JANELA_DIAS));
    } finally {
      setOcupado(null);
    }
  }

  const vendoObservacoes = filtro === "observacoes";

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Pendências</p>
        <h1 className="text-xl font-black text-stone-900">
          {vendoObservacoes ? "Observações" : "Não conformidades"}
        </h1>
      </header>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            onClick={() => setFiltro(f.valor)}
            className={`toque shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
              filtro === f.valor
                ? "bg-marca-800 text-marca-400"
                : "border border-stone-200 bg-white text-stone-600"
            }`}
          >
            {f.rotulo}
            {f.valor === "observacoes" && listaObs.length > 0 && (
              <span className="ml-1.5 opacity-70">{listaObs.length}</span>
            )}
          </button>
        ))}
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {(vendoObservacoes ? carregandoObs : carregando) && (
        <p className="text-sm text-stone-500">Carregando…</p>
      )}

      {/* ------------------------------------------------ observações */}
      {vendoObservacoes ? (
        !carregandoObs && listaObs.length === 0 ? (
          <Vazio
            icone={MessageSquareText}
            titulo="Nenhuma observação"
            texto="As anotações que os motoristas deixam — nos itens ou como observação geral do dia — aparecem aqui, tenham eles marcado Conforme ou Não Conforme."
          />
        ) : (
          <ul className="space-y-2.5">
            {listaObs.map((o) => {
              const v = veiculoDe(o.vehicle_id);
              const doItem = entradas.find(
                (e) =>
                  e.vehicle_id === o.vehicle_id &&
                  e.item_number === o.item_number &&
                  e.entry_date === o.entry_date,
              );
              return (
                <li key={o.id}>
                  <Cartao className="px-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <MessageSquareText size={18} className="mt-0.5 shrink-0 text-stone-400" />
                      <div className="min-w-0 flex-1">
                        {/* `itemPorNumero` cai no primeiro item quando não
                            encontra o número, e rotularia toda observação
                            geral (item 0) como "Óleo". */}
                        <p className="text-sm font-bold text-stone-900">
                          {tituloDoAlvo(o.item_number)}
                        </p>
                        <p className="mt-0.5 whitespace-pre-line text-sm text-stone-700">{o.text}</p>
                        <p className="mt-1.5 text-xs text-stone-500">
                          {v ? `${v.brand} — ${formatarPlaca(v.plate)}` : "veículo removido"} ·{" "}
                          {formatarData(o.entry_date)}
                        </p>
                        <p className="text-xs text-stone-400">
                          por {nomeDe(o.author_id)}
                          {o._sync !== "sincronizado" && " · ainda na fila deste aparelho"}
                        </p>
                      </div>
                      {/* O status do item naquele dia dá o contexto da anotação. */}
                      {doItem && (
                        <Etiqueta cor={doItem.status === "C" ? "verde" : "vermelho"}>
                          {doItem.status === "C" ? "Conforme" : "Não Conforme"}
                        </Etiqueta>
                      )}
                    </div>
                  </Cartao>
                </li>
              );
            })}
          </ul>
        )
      ) : !carregando && lista.length === 0 ? (
        <Vazio
          icone={CheckCircle2}
          titulo="Nada por aqui"
          texto="Nenhuma não conformidade neste filtro."
        />
      ) : (
        <ul className="space-y-2.5">
          {lista.map((n) => {
            const v = veiculoDe(n.vehicle_id);
            const dias = daysBetween(n.entry_date, hoje);
            const resolvida = n.nc_status === "resolvido";
            const anotacoes = obsDoRegistro(n.vehicle_id, n.item_number, n.entry_date);
            return (
              <li key={n.id}>
                <Cartao className="px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      size={18}
                      className={`mt-0.5 shrink-0 ${resolvida ? "text-conforme-700" : "text-naoconforme-700"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-stone-900">
                        {itemPorNumero(n.item_number).titulo}
                      </p>
                      <p className="mt-0.5 text-sm text-stone-700">{n.problem_description}</p>
                      <p className="mt-1.5 text-xs text-stone-500">
                        {v ? `${v.brand} — ${formatarPlaca(v.plate)}` : "veículo removido"} ·
                        registrada em {formatarData(n.entry_date)}
                        {!resolvida && dias > 0 && ` · ${plural(dias, "dia em aberto", "dias em aberto")}`}
                      </p>
                      <p className="text-xs text-stone-400">
                        por {perfis.find((p) => p.id === n.created_by)?.name ?? "—"}
                      </p>
                      {n.photo_url && (
                        <button
                          type="button"
                          onClick={() => void verFoto(n.photo_url as string)}
                          className="toque -ml-2 mt-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-marca-700 hover:bg-marca-50"
                        >
                          <ImageIcon size={13} /> Ver foto
                        </button>
                      )}
                    </div>
                    <Etiqueta
                      cor={resolvida ? "verde" : n.nc_status === "manutencao" ? "ambar" : "vermelho"}
                    >
                      {NC_STATUS_ROTULO[n.nc_status ?? "pendente"]}
                    </Etiqueta>
                  </div>

                  {/* Observação escrita no mesmo item, no mesmo dia: é
                      contexto da não conformidade, não some numa aba à parte. */}
                  {anotacoes.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-stone-100 pt-3">
                      {anotacoes.map((o) => (
                        <li key={o.id} className="flex gap-2 text-xs text-stone-600">
                          <MessageSquareText size={13} className="mt-0.5 shrink-0 text-stone-400" />
                          <span className="min-w-0">
                            <span className="whitespace-pre-line">{o.text}</span>
                            <span className="block text-[11px] text-stone-400">
                              {nomeDe(o.author_id)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {ehAdmin && !resolvida && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
                      {n.nc_status !== "manutencao" && (
                        <Botao
                          variante="secundario"
                          disabled={ocupado === n.id}
                          onClick={() => mudarSituacao(n.id, n.vehicle_id, "manutencao")}
                        >
                          <Wrench size={15} />
                          Em manutenção
                        </Botao>
                      )}
                      <Botao
                        disabled={ocupado === n.id}
                        onClick={() => mudarSituacao(n.id, n.vehicle_id, "resolvido")}
                      >
                        <CheckCircle2 size={15} />
                        Marcar como resolvida
                      </Botao>
                    </div>
                  )}
                </Cartao>
              </li>
            );
          })}
        </ul>
      )}

      {!ehAdmin && !vendoObservacoes && (
        <Aviso tipo="info">
          Só o administrador encerra uma não conformidade. Até lá, ela continua valendo nos dias
          seguintes — é assim que ela não some sem alguém resolver.
        </Aviso>
      )}

      <Modal aberto={modalFotoAberto} aoFechar={() => setModalFotoAberto(false)} titulo="Foto da não conformidade">
        {carregandoFoto && <p className="text-sm text-stone-500">Carregando foto…</p>}
        {erroFoto && <Aviso tipo="erro">{erroFoto}</Aviso>}
        {!carregandoFoto && !erroFoto && fotoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária do Storage, não um asset do build
          <img src={fotoUrl} alt="Foto anexada à não conformidade" className="w-full rounded-xl border border-stone-200" />
        )}
      </Modal>

    </div>
  );
}
