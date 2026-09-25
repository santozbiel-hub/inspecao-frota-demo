"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  Image as ImageIcon,
  MessageSquarePlus,
  NotebookPen,
  Truck,
} from "lucide-react";
import { useApp } from "@/components/app-provider";
import {
  Aviso,
  Botao,
  Campo,
  Cartao,
  Etiqueta,
  IndicadorSync,
  inputCls,
  Modal,
  SeletorStatus,
  Vazio,
} from "@/components/ui";
import { ehItemGeral, ITEM_GERAL, ITENS } from "@/lib/domain/items";
import { formatarDataExtenso, formatarPlaca, isBusinessDay, todayLocal } from "@/lib/domain/dates";
import { daysWithoutResponse, effectiveStatus, registrosDoDia } from "@/lib/domain/status";
import type { EntryStatus } from "@/lib/domain/types";
import { useIndice, useObservacoes, useRegistros } from "@/lib/offline/use-registros";
import { adicionarObservacao, anexarFoto, marcarItem } from "@/lib/offline/sync";
import { comprimirFoto, formatarBytes, FotoInvalida, obterUrlFoto } from "@/lib/offline/foto";
import { sanitizarTexto } from "@/lib/sanitize";

const CHAVE_VEICULO = "bp-frota-ultimo-veiculo";

export default function PaginaHoje() {
  const { veiculos, perfis, perfil, sessao, fechamentos, ehAdmin } = useApp();
  const nomeDe = (id: string | null) =>
    perfis.find((p) => p.id === id)?.name ?? "outro inspetor";
  const hoje = todayLocal();
  // A fábrica roda de segunda a sábado. Domingo não é dia de inspeção: a
  // grade mensal e o cálculo de dias sem resposta já ignoram domingo, então
  // deixar marcar aqui geraria registro que some da grade depois.
  const diaDeInspecao = isBusinessDay(hoje);

  const ativos = useMemo(() => veiculos.filter((v) => v.active), [veiculos]);

  // O veículo é derivado, não guardado em efeito: enquanto o motorista não
  // escolher, vale o último que ele usou neste aparelho — e, na falta
  // dele, o primeiro da lista.
  const [escolhaManual, setEscolhaManual] = useState<string | null>(null);
  const veiculo = useMemo(() => {
    if (!ativos.length) return null;
    const guardado =
      typeof localStorage !== "undefined" ? localStorage.getItem(CHAVE_VEICULO) : null;
    return (
      ativos.find((v) => v.id === escolhaManual) ??
      ativos.find((v) => v.id === guardado) ??
      ativos[0]
    );
  }, [ativos, escolhaManual]);
  const veiculoId = veiculo?.id ?? null;

  useEffect(() => {
    if (veiculoId && typeof localStorage !== "undefined") {
      localStorage.setItem(CHAVE_VEICULO, veiculoId);
    }
  }, [veiculoId]);
  const { entradas, carregando } = useRegistros(veiculoId);
  const indice = useIndice(entradas);

  const mesFechado = useMemo(() => {
    if (!veiculo) return false;
    const [ano, mes] = hoje.split("-").map(Number);
    return fechamentos.some((f) => f.vehicle_id === veiculo.id && f.month === mes && f.year === ano);
  }, [fechamentos, veiculo, hoje]);

  const marcadosHoje = ITENS.filter((i) => indice.has(`${i.numero}|${hoje}`)).length;

  const diasEmFalta = useMemo(() => {
    if (!veiculo) return [];
    const porItem = ITENS.map((i) =>
      daysWithoutResponse(entradas, i.numero, hoje, veiculo.created_at, 6, hoje),
    );
    const todos = new Set(porItem.flat());
    return [...todos].sort();
  }, [entradas, veiculo, hoje]);

  if (!ativos.length) {
    return (
      <Vazio
        icone={Truck}
        titulo="Nenhum veículo disponível"
        texto={
          ehAdmin
            ? "Cadastre um caminhão em Veículos para começar a registrar as inspeções."
            : "Peça ao administrador para cadastrar o caminhão que você dirige."
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Inspeção de hoje</p>
          <h1 className="text-xl font-black capitalize text-stone-900">{formatarDataExtenso(hoje)}</h1>
        </div>

        {ativos.length > 1 ? (
          <label className="relative block">
            <span className="sr-only">Caminhão</span>
            <select
              className={`${inputCls} toque appearance-none pr-10 font-bold`}
              value={veiculoId ?? ""}
              onChange={(e) => setEscolhaManual(e.target.value)}
            >
              {ativos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.brand} {v.model ?? ""} — {formatarPlaca(v.plate)}
                </option>
              ))}
            </select>
            <ChevronDown size={18} className="pointer-events-none absolute right-3 top-3.5 text-stone-400" />
          </label>
        ) : (
          veiculo && (
            <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
              <Truck size={20} className="text-marca-800" />
              <div>
                <p className="text-sm font-bold text-stone-900">
                  {veiculo.brand} {veiculo.model ?? ""}
                </p>
                <p className="font-mono text-xs font-bold tracking-widest text-stone-500">
                  {formatarPlaca(veiculo.plate)}
                </p>
              </div>
            </div>
          )
        )}

        {diaDeInspecao && <ProgressoDoDia marcados={marcadosHoje} total={ITENS.length} />}

        {/* Aviso que não bloqueia: informa e sai da frente. */}
        {diasEmFalta.length > 0 && (
          <Aviso tipo="alerta">
            {diasEmFalta.length === 1
              ? `O dia ${diasEmFalta[0].split("-").reverse().join("/")} ficou sem registro em algum item.`
              : `${diasEmFalta.length} dias anteriores ficaram sem registro em algum item.`}{" "}
            Você pode seguir com a inspeção de hoje normalmente.
          </Aviso>
        )}

        {mesFechado && (
          <Aviso tipo="info">
            Este mês já foi fechado pelo administrador. Só ele pode alterar registros agora.
          </Aviso>
        )}
      </header>

      {!diaDeInspecao ? (
        <Vazio
          icone={CheckCircle2}
          titulo="Domingo não tem inspeção"
          texto="A inspeção acontece de segunda a sábado. Volte amanhã — os registros dos outros dias continuam disponíveis nas outras telas."
        />
      ) : carregando || !veiculo ? (
        <p className="py-8 text-center text-sm text-stone-500">Carregando…</p>
      ) : (
        <ul className="space-y-3">
          {ITENS.map((item) => (
            <li key={item.numero}>
              <CartaoItem
                veiculoId={veiculo.id}
                veiculoCriadoEm={veiculo.created_at}
                numero={item.numero}
                titulo={item.titulo}
                descricao={item.descricao}
                data={hoje}
                entradas={entradas}
                usuarioId={sessao?.user.id ?? perfil?.id ?? ""}
                bloqueado={mesFechado && !ehAdmin}
                nomeDe={nomeDe}
              />
            </li>
          ))}
          <li>
            <CartaoObservacoesGerais
              veiculoId={veiculo.id}
              data={hoje}
              usuarioId={sessao?.user.id ?? perfil?.id ?? ""}
              bloqueado={mesFechado && !ehAdmin}
            />
          </li>
        </ul>
      )}

      {marcadosHoje === ITENS.length && (
        <Aviso tipo="sucesso">
          <span className="flex items-center gap-2 font-semibold">
            <CheckCircle2 size={16} />
            Inspeção de hoje completa. Pode fechar o app — o que estiver na fila sobe sozinho.
          </span>
        </Aviso>
      )}
    </div>
  );
}

function ProgressoDoDia({ marcados, total }: { marcados: number; total: number }) {
  const pct = Math.round((marcados / total) * 100);
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-bold text-stone-900">
          {marcados} de {total} registrados
        </span>
        <span className="text-xs font-semibold text-stone-500">{pct}%</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
        aria-valuenow={marcados}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Itens registrados hoje"
      >
        <div
          className={`h-full rounded-full transition-all ${marcados === total ? "bg-conforme-500" : "bg-marca-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CartaoItem({
  veiculoId,
  numero,
  titulo,
  descricao,
  data,
  entradas,
  usuarioId,
  bloqueado,
  nomeDe,
}: {
  veiculoId: string;
  veiculoCriadoEm: string;
  numero: number;
  titulo: string;
  descricao: string[];
  data: string;
  entradas: ReturnType<typeof useRegistros>["entradas"];
  usuarioId: string;
  bloqueado: boolean;
  nomeDe: (id: string | null) => string;
}) {
  const efetivo = useMemo(
    () => effectiveStatus(entradas, numero, data, data),
    [entradas, numero, data],
  );
  // Desde a migration 015 cada inspetor tem o próprio registro do item no
  // dia. O seletor tem de mostrar O MEU — se mostrasse o do colega, eu
  // veria o status dele e, ao corrigir, tentaria sobrescrever um registro
  // que não é meu (era o 42501 silencioso).
  const local = entradas.find(
    (e) => e.item_number === numero && e.entry_date === data && e.created_by === usuarioId,
  );
  const deOutros = useMemo(
    () =>
      registrosDoDia(entradas, numero, data).filter((e) => e.created_by !== usuarioId),
    [entradas, numero, data, usuarioId],
  );

  const [modalNC, setModalNC] = useState(false);
  const [modalObs, setModalObs] = useState(false);
  const [detalhes, setDetalhes] = useState(false);
  const [erro, setErro] = useState("");

  const [modalFotoAberto, setModalFotoAberto] = useState(false);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [carregandoFoto, setCarregandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState("");

  async function verFoto(caminho: string) {
    setErroFoto("");
    setFotoUrl(null);
    setModalFotoAberto(true);
    setCarregandoFoto(true);
    try {
      setFotoUrl(await obterUrlFoto(caminho));
    } catch {
      setErroFoto("Não foi possível carregar a foto agora. Tente de novo quando o sinal estiver melhor.");
    } finally {
      setCarregandoFoto(false);
    }
  }

  async function escolher(status: EntryStatus) {
    setErro("");
    if (status === "NC") {
      setModalNC(true);
      return;
    }
    try {
      await marcarItem({ vehicleId: veiculoId, itemNumber: numero, status: "C", userId: usuarioId });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }

  const herdado = efetivo.inherited;

  return (
    <Cartao className={`overflow-hidden ${herdado ? "ring-1 ring-naoconforme-500/40" : ""}`}>
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-marca-800 text-sm font-bold text-marca-400">
          {numero}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-stone-900">{titulo}</h2>
          <button
            type="button"
            aria-expanded={detalhes}
            onClick={() => setDetalhes((d) => !d)}
            className="toque -ml-2 inline-flex items-center gap-1 rounded-lg px-2 text-xs font-semibold text-stone-500 underline underline-offset-2"
          >
            {detalhes ? "Ocultar o que verificar" : "O que verificar"}
          </button>
          {detalhes && (
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-stone-600">
              {descricao.map((d) => (
                <li key={d} className="flex gap-1.5">
                  <span className="text-marca-500">•</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {local && <IndicadorSync estado={local._sync} className="shrink-0" />}
      </div>

      {herdado && (
        <div className="mx-4 mt-3 rounded-xl border border-naoconforme-500/30 bg-naoconforme-50 px-3 py-2 text-xs text-naoconforme-700">
          <p className="font-bold">Não conformidade em aberto desde {efetivo.source_date?.split("-").reverse().join("/")}</p>
          {efetivo.problem_description && <p className="mt-0.5">{efetivo.problem_description}</p>}
          <p className="mt-1 text-[11px]">
            Continua valendo até o administrador marcar como resolvida. Registre o item de hoje normalmente.
          </p>
        </div>
      )}

      <div className="px-4 py-3">
        <SeletorStatus
          valor={local?.status ?? null}
          aoMudar={escolher}
          desabilitado={bloqueado}
        />
        {erro && (
          <p role="alert" className="mt-2 text-xs font-semibold text-naoconforme-700">
            {erro}
          </p>
        )}
      </div>

      {local?.status === "NC" && (
        <div className="mx-4 mb-3 rounded-xl bg-naoconforme-50 px-3 py-2.5 text-xs text-naoconforme-700">
          <p className="font-bold">O que foi encontrado</p>
          <p className="mt-0.5">{local.problem_description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {local.photo_url ? (
              <button
                type="button"
                onClick={() => void verFoto(local.photo_url as string)}
                className="toque -m-1 rounded-lg"
              >
                <Etiqueta cor="vermelho">
                  <ImageIcon size={12} /> Ver foto anexada
                </Etiqueta>
              </button>
            ) : local._fotoLocalId ? (
              <Etiqueta cor="ambar">
                <ImageIcon size={12} /> Foto na fila de envio
              </Etiqueta>
            ) : null}
            <button
              onClick={() => setModalNC(true)}
              className="toque rounded-lg px-2 py-1 text-xs font-bold underline"
            >
              Editar descrição / foto
            </button>
          </div>
        </div>
      )}

      {deOutros.length > 0 && (
        <div className="mx-4 mb-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          <p className="font-bold uppercase tracking-wide text-stone-500">
            Também registrado hoje
          </p>
          <ul className="mt-1 space-y-0.5">
            {deOutros.map((e) => (
              <li key={e.id} className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    e.status === "NC" ? "bg-naoconforme-500" : "bg-conforme-500"
                  }`}
                />
                <span className="font-semibold">
                  {e.status === "NC" ? "Não Conforme" : "Conforme"}
                </span>
                <span className="text-stone-500">por {nomeDe(e.created_by)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-stone-500">
            O registro de cada um fica guardado separado. Marque o seu normalmente.
          </p>
        </div>
      )}

      {/* Observação fica sempre à mão, tenha ou não status marcado. */}
      <div className="border-t border-stone-100 px-4 py-2">
        <button
          onClick={() => setModalObs(true)}
          className="toque flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50"
        >
          <MessageSquarePlus size={16} />
          Observação
        </button>
      </div>

      <ModalNaoConformidade
        aberto={modalNC}
        aoFechar={() => setModalNC(false)}
        veiculoId={veiculoId}
        numero={numero}
        titulo={titulo}
        data={data}
        usuarioId={usuarioId}
        descricaoAtual={local?.problem_description ?? ""}
      />
      <ModalObservacao
        aberto={modalObs}
        aoFechar={() => setModalObs(false)}
        bloqueado={bloqueado}
        veiculoId={veiculoId}
        numero={numero}
        titulo={titulo}
        data={data}
        usuarioId={usuarioId}
      />

      <Modal aberto={modalFotoAberto} aoFechar={() => setModalFotoAberto(false)} titulo="Foto anexada">
        {carregandoFoto && <p className="text-sm text-stone-500">Carregando foto…</p>}
        {erroFoto && <Aviso tipo="erro">{erroFoto}</Aviso>}
        {!carregandoFoto && !erroFoto && fotoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária do Storage
          <img src={fotoUrl} alt="Foto anexada à não conformidade" className="w-full rounded-xl border border-stone-200" />
        )}
      </Modal>

    </Cartao>
  );
}

function ModalNaoConformidade({
  aberto,
  aoFechar,
  veiculoId,
  numero,
  titulo,
  data,
  usuarioId,
  descricaoAtual,
}: {
  aberto: boolean;
  aoFechar: () => void;
  veiculoId: string;
  numero: number;
  titulo: string;
  data: string;
  usuarioId: string;
  descricaoAtual: string;
}) {
  const [problema, setProblema] = useState(descricaoAtual);
  const [foto, setFoto] = useState<Blob | null>(null);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState("");

  // Ao abrir, o formulário volta ao estado da marcação atual. O ajuste é
  // feito na própria renderização (padrão recomendado do React) em vez de
  // num efeito, que só rodaria depois de a tela já ter piscado.
  const [estavaAberto, setEstavaAberto] = useState(aberto);
  if (aberto !== estavaAberto) {
    setEstavaAberto(aberto);
    if (aberto) {
      setProblema(descricaoAtual);
      setFoto(null);
      setErro("");
    }
  }

  async function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setErro("");
    setProcessando(true);
    try {
      setFoto(await comprimirFoto(arquivo));
    } catch (err) {
      setErro(err instanceof FotoInvalida ? err.message : "Não foi possível preparar a foto.");
    } finally {
      setProcessando(false);
    }
  }

  async function salvar() {
    const texto = sanitizarTexto(problema);
    if (!texto) return setErro("Descreva o que foi encontrado — sem isso o registro não ajuda ninguém.");
    setProcessando(true);
    try {
      await marcarItem({
        vehicleId: veiculoId,
        itemNumber: numero,
        status: "NC",
        problema: texto,
        userId: usuarioId,
        entryDate: data,
      });
      if (foto) {
        await anexarFoto({
          vehicleId: veiculoId,
          itemNumber: numero,
          entryDate: data,
          blob: foto,
          userId: usuarioId,
        });
      }
      aoFechar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo={`Item ${numero} — ${titulo}`}>
      <div className="space-y-4">
        <Campo label="O que foi encontrado?" dica="Obrigatório. Escreva como diria para o mecânico.">
          <textarea
            className={`${inputCls} min-h-28`}
            value={problema}
            onChange={(e) => setProblema(e.target.value)}
            placeholder="Ex.: Pneu dianteiro esquerdo com desgaste no ombro."
            maxLength={2000}
          />
        </Campo>

        <div>
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-stone-500">
            Foto (opcional)
          </span>
          <div className="flex flex-wrap gap-2">
            <label className="toque inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700">
              <Camera size={18} />
              Câmera
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={escolherFoto} />
            </label>
            <label className="toque inline-flex cursor-pointer items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700">
              <ImageIcon size={18} />
              Galeria
              <input type="file" accept="image/*" className="sr-only" onChange={escolherFoto} />
            </label>
          </div>
          {foto && (
            <p className="mt-2 text-xs font-semibold text-conforme-700">
              Foto pronta ({formatarBytes(foto.size)}). Ela sobe numa fila separada, sem segurar a marcação.
            </p>
          )}
        </div>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <div className="flex gap-2">
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="perigo" className="flex-1" onClick={salvar} disabled={processando}>
            {processando ? "Salvando…" : "Salvar não conformidade"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

function ModalObservacao({
  aberto,
  aoFechar,
  veiculoId,
  numero,
  titulo,
  data,
  usuarioId,
  bloqueado = false,
}: {
  aberto: boolean;
  aoFechar: () => void;
  veiculoId: string;
  numero: number;
  titulo: string;
  data: string;
  usuarioId: string;
  /** Mês fechado: o banco vai recusar a gravação, então nem deixamos
   *  chegar lá — antes isso virava anotação presa na fila para sempre. */
  bloqueado?: boolean;
}) {
  const { observacoes } = useObservacoes(veiculoId, numero, data);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const geral = ehItemGeral(numero);

  // Ao abrir, limpa o rascunho e o erro da vez anterior — mesmo padrão da
  // modal de não conformidade: ajuste na renderização, sem efeito.
  const [estavaAberto, setEstavaAberto] = useState(aberto);
  if (aberto !== estavaAberto) {
    setEstavaAberto(aberto);
    if (aberto) {
      setTexto("");
      setErro("");
    }
  }

  /**
   * Antes esta função não tratava erro nenhum: qualquer falha ao gravar
   * virava uma promise rejeitada e sumia. Para quem estava usando, o
   * botão simplesmente não fazia nada. Agora a falha aparece na tela.
   */
  async function enviar() {
    setErro("");
    setSalvando(true);
    try {
      const gravada = await adicionarObservacao({
        vehicleId: veiculoId,
        itemNumber: numero,
        entryDate: data,
        texto,
        userId: usuarioId,
      });
      if (!gravada) {
        setErro("Escreva alguma coisa antes de adicionar.");
        return;
      }
      setTexto("");
    } catch (e) {
      setErro(
        e instanceof Error && e.message
          ? `Não foi possível guardar a observação: ${e.message}`
          : "Não foi possível guardar a observação neste aparelho. Tente de novo.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={geral ? "Observações gerais do dia" : `Observações — item ${numero}, ${titulo}`}
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-stone-500">
          {geral
            ? "Para o que não é sobre os itens da inspeção: atraso, ocorrência na entrega, algo que o próximo turno precisa saber. As observações de cada item continuam no cartão do item."
            : "Anotação livre sobre este item. Ela fica registrada mesmo com o item Conforme."}
        </p>

        {observacoes.length > 0 && (
          <ul className="space-y-2">
            {observacoes.map((o) => (
              <li key={o.id} className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-700">
                <span className="whitespace-pre-line">{o.text}</span>
                <span className="mt-1 block text-[11px] text-stone-400">
                  {new Date(o.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  {o._sync === "sincronizado"
                    ? " · salva no servidor"
                    : o._sync === "falha"
                      ? " · não subiu ainda"
                      : " · na fila"}
                </span>
                {/* O motivo da falha fica à vista: sem isto, a anotação
                    parecia salva e nunca chegava a ninguém. */}
                {o._sync === "falha" && o._erro && (
                  <span className="mt-1 block text-[11px] font-semibold text-naoconforme-700">
                    {o._erro}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {bloqueado ? (
          <Aviso tipo="info">
            Este mês já foi fechado pelo administrador. Não dá para acrescentar observações agora —
            fale com ele se precisar registrar alguma coisa.
          </Aviso>
        ) : (
          <Campo label="Nova observação">
            <textarea
              className={`${inputCls} min-h-24`}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={
                geral
                  ? "Ex.: saída atrasada por causa do trânsito na Dutra."
                  : "Anote qualquer coisa que o próximo turno precise saber."
              }
              maxLength={2000}
            />
          </Campo>
        )}

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <div className="flex gap-2">
          <Botao variante="secundario" className="flex-1" onClick={aoFechar}>
            Fechar
          </Botao>
          {!bloqueado && (
            <Botao
              className="flex-1"
              onClick={enviar}
              disabled={!sanitizarTexto(texto) || salvando}
            >
              {salvando ? "Salvando…" : "Adicionar"}
            </Botao>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Observações que não pertencem a nenhum dos cinco itens.
 *
 * Fica depois da lista de itens de propósito: é o fecho do dia, o
 * equivalente ao campo "OBSERVAÇÕES" que existia no rodapé da folha de
 * papel e que o sistema não tinha.
 */
function CartaoObservacoesGerais({
  veiculoId,
  data,
  usuarioId,
  bloqueado,
}: {
  veiculoId: string;
  data: string;
  usuarioId: string;
  bloqueado: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const { observacoes } = useObservacoes(veiculoId, ITEM_GERAL, data);

  return (
    <Cartao className="overflow-hidden">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-800 text-marca-400">
          <NotebookPen size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-stone-900">Observações gerais do dia</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
            O que não tem a ver com os itens da inspeção.
          </p>
        </div>
      </div>

      {observacoes.length > 0 && (
        <ul className="mx-4 mt-3 space-y-1.5">
          {observacoes.map((o) => (
            <li key={o.id} className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-700">
              <span className="whitespace-pre-line">{o.text}</span>
              {o._sync !== "sincronizado" && (
                <span className="mt-1 block text-[11px] text-stone-400">
                  {o._sync === "falha" ? "não subiu ainda" : "na fila"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-stone-100 px-4 py-2">
        <button
          onClick={() => setAberto(true)}
          className="toque flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50"
        >
          <MessageSquarePlus size={16} />
          {observacoes.length ? "Ver observações gerais" : "Escrever observação geral"}
        </button>
      </div>

      <ModalObservacao
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        veiculoId={veiculoId}
        numero={ITEM_GERAL}
        titulo="Observação geral"
        data={data}
        usuarioId={usuarioId}
        bloqueado={bloqueado}
      />
    </Cartao>
  );
}
