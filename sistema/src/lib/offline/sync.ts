"use client";

import { supabase } from "@/lib/supabase/client";
import { sanitizarTexto } from "@/lib/sanitize";
import { todayLocal } from "@/lib/domain/dates";
import type {
  EntryStatus,
  InspectionEntry,
  IsoDate,
  NcStatus,
  Observation,
  SyncState,
} from "@/lib/domain/types";
import {
  apagarFotoLocal,
  chaveEntrada,
  db,
  entradasDoVeiculo,
  fotosPendentes,
  gravarEntradaLocal,
  gravarFotoLocal,
  gravarMeta,
  gravarObservacaoLocal,
  guardarCatalogo,
  lerMeta,
  mesclarDoServidor,
  mesclarObservacoesDoServidor,
  normalizarEntrada,
  pendentesDeTexto,
  type EntradaLocal,
  type FotoLocal,
  type ObservacaoLocal,
} from "./db";

/**
 * O motor de sincronização.
 *
 * Duas filas separadas de propósito: texto e foto. Uma marcação de
 * "Não Conforme" tem 200 bytes e precisa chegar; a foto tem 200 KB e
 * pode demorar. Se fossem a mesma fila, uma foto travada num sinal ruim
 * seguraria todas as marcações atrás dela.
 */

export const BUCKET = "inspection-photos";
const MAX_TENTATIVAS_ANTES_DE_AVISAR = 3;

// ------------------------------------------------------ eventos para a UI
type Ouvinte = () => void;
const ouvintes = new Set<Ouvinte>();

export function aoMudar(fn: Ouvinte): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisar() {
  for (const fn of ouvintes) fn();
}

// ------------------------------------------------------------ conexão
let sincronizando = false;
/**
 * Alguém pediu sincronização enquanto uma já estava em curso.
 *
 * Sem isto, o pedido era simplesmente descartado (`if (sincronizando)
 * return`), e o que tivesse entrado na fila DEPOIS de `enviarTextos` ter
 * lido `pendentesDeTexto()` ficava parado até o tique de 60 segundos.
 * Escrever duas observações seguidas é exatamente esse caso: a segunda
 * nasce durante o envio da primeira. Se o motorista fechasse o app antes
 * do tique — ou saísse da conta, que limpa o aparelho — a anotação era
 * perdida sem nenhum aviso.
 */
let pedidoPendente = false;
let agendado: ReturnType<typeof setTimeout> | null = null;

/** Trava de segurança: cada rodada extra só existe para escoar o que
 *  chegou durante a anterior, e isso converge em poucas voltas. O limite
 *  impede que um erro novo transforme a convergência em laço infinito. */
const MAX_RODADAS_SEGUIDAS = 5;

export function online(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export interface ResumoFila {
  entradasPendentes: number;
  observacoesPendentes: number;
  fotosPendentes: number;
  falhas: number;
  ultimaSincronizacao: number | null;
  sincronizando: boolean;
  online: boolean;
}

export async function resumoDaFila(): Promise<ResumoFila> {
  const { entradas, observacoes } = await pendentesDeTexto();
  const fotos = await fotosPendentes();
  return {
    entradasPendentes: entradas.length,
    observacoesPendentes: observacoes.length,
    fotosPendentes: fotos.length,
    falhas:
      entradas.filter((e) => e._sync === "falha").length +
      observacoes.filter((o) => o._sync === "falha").length +
      fotos.filter((f) => f.state === "falha").length,
    ultimaSincronizacao: (await lerMeta<number>("ultimaSincronizacao")) ?? null,
    sincronizando,
    online: online(),
  };
}

// ------------------------------------------------------------- escrita
function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export interface MarcacaoInput {
  vehicleId: string;
  itemNumber: number;
  entryDate?: IsoDate;
  status: EntryStatus;
  ncStatus?: NcStatus | null;
  problema?: string | null;
  userId: string;
}

/**
 * Marca um item. Grava no aparelho e devolve na hora — a tela não espera
 * a rede. A fila cuida do resto.
 */
export async function marcarItem(input: MarcacaoInput): Promise<EntradaLocal> {
  const entryDate = input.entryDate ?? todayLocal();
  const agora = new Date().toISOString();
  // A chave carrega o autor: buscar "o registro anterior" significa o
  // registro ANTERIOR DESTE INSPETOR, nunca o do colega.
  const chave = chaveEntrada(input.vehicleId, input.itemNumber, entryDate, input.userId);
  const base = await db();
  const anterior = await base.get("entries", chave);

  if (input.status === "NC" && !sanitizarTexto(input.problema ?? "")) {
    throw new Error("Descreva o que foi encontrado antes de salvar a não conformidade.");
  }

  const entrada: EntradaLocal = {
    id: anterior?.id ?? novoId(),
    vehicle_id: input.vehicleId,
    item_number: input.itemNumber,
    entry_date: entryDate,
    status: input.status,
    nc_status:
      input.status === "NC" ? (input.ncStatus ?? anterior?.nc_status ?? "pendente") : null,
    problem_description:
      input.status === "NC" ? sanitizarTexto(input.problema ?? anterior?.problem_description ?? "") : null,
    photo_url: input.status === "NC" ? (anterior?.photo_url ?? null) : null,
    created_by: input.userId,
    created_at: anterior?.created_at ?? agora,
    updated_at: agora,
    resolved_at: input.status === "NC" ? (anterior?.resolved_at ?? null) : null,
    _sync: "pendente",
    _localUpdatedAt: Date.now(),
    _tentativas: 0,
    _fotoLocalId: input.status === "NC" ? anterior?._fotoLocalId : undefined,
  };

  await gravarEntradaLocal(entrada);
  avisar();
  agendarSincronizacao();
  return entrada;
}

/**
 * Grava uma observação na fila do aparelho.
 *
 * `itemNumber` aceita 1..5 (a observação daquele item da folha) e 0 —
 * `ITEM_GERAL`, a observação geral do dia, que não pertence a nenhum item.
 * Devolve a linha gravada para a tela poder confirmar o que entrou; um
 * texto vazio devolve `null` em vez de gravar nada.
 */
export async function adicionarObservacao(params: {
  vehicleId: string;
  itemNumber: number;
  entryDate?: IsoDate;
  texto: string;
  userId: string;
}): Promise<ObservacaoLocal | null> {
  const texto = sanitizarTexto(params.texto);
  if (!texto) return null;
  const obs: ObservacaoLocal = {
    id: novoId(),
    vehicle_id: params.vehicleId,
    item_number: params.itemNumber,
    entry_date: params.entryDate ?? todayLocal(),
    text: texto,
    author_id: params.userId,
    created_at: new Date().toISOString(),
    _sync: "pendente",
    _localUpdatedAt: Date.now(),
    _tentativas: 0,
  };
  await gravarObservacaoLocal(obs);
  avisar();
  agendarSincronizacao();
  return obs;
}

/** Guarda a foto já comprimida na fila própria e liga na marcação. */
export async function anexarFoto(params: {
  vehicleId: string;
  itemNumber: number;
  entryDate?: IsoDate;
  blob: Blob;
  userId: string;
}): Promise<void> {
  const entryDate = params.entryDate ?? todayLocal();
  const foto: FotoLocal = {
    id: novoId(),
    vehicle_id: params.vehicleId,
    item_number: params.itemNumber,
    entry_date: entryDate,
    blob: params.blob,
    bytes: params.blob.size,
    state: "pendente",
    tentativas: 0,
    criadoEm: Date.now(),
  };
  await gravarFotoLocal(foto);

  const base = await db();
  const chave = chaveEntrada(params.vehicleId, params.itemNumber, entryDate, params.userId);
  const entrada = await base.get("entries", chave);
  if (entrada) {
    await gravarEntradaLocal({ ...entrada, _fotoLocalId: foto.id });
  }
  avisar();
  agendarSincronizacao();
}

// ------------------------------------------------------- sincronização
export function agendarSincronizacao(atrasoMs = 300): void {
  if (agendado) clearTimeout(agendado);
  agendado = setTimeout(() => {
    agendado = null;
    void sincronizar();
  }, atrasoMs);
}

function ehErroDeRede(erro: unknown): boolean {
  const msg = String((erro as { message?: string })?.message ?? erro ?? "");
  return (
    !online() ||
    /fetch|network|Failed to fetch|timeout|ECONN|offline|NetworkError/i.test(msg)
  );
}

function ehErroDePermissao(erro: unknown): boolean {
  const e = erro as { code?: string; status?: number };
  return e?.code === "42501" || e?.status === 403 || e?.status === 401;
}

export async function sincronizar(): Promise<ResumoFila> {
  // Já tem uma rodando: em vez de jogar o pedido fora, anota que ficou
  // coisa nova para trás. Quem está rodando dá mais uma volta no fim.
  if (sincronizando) {
    pedidoPendente = true;
    return resumoDaFila();
  }
  if (!online()) return resumoDaFila();

  sincronizando = true;
  avisar();
  try {
    let rodadas = 0;
    do {
      pedidoPendente = false;
      await enviarTextos();
      await enviarFotos();
      await gravarMeta("ultimaSincronizacao", Date.now());
      rodadas += 1;
    } while (pedidoPendente && online() && rodadas < MAX_RODADAS_SEGUIDAS);
  } finally {
    sincronizando = false;
    avisar();
  }
  return resumoDaFila();
}

async function enviarTextos(): Promise<void> {
  const cliente = supabase();
  const { entradas, observacoes } = await pendentesDeTexto();

  for (const entrada of entradas) {
    if (entrada._sync === "enviando") continue;
    await gravarEntradaLocal({ ...entrada, _sync: "enviando" });
    avisar();

    // Sem `id` no payload: quem resolve o conflito é a chave única
    // (veículo, item, data, autor). Reenviar a mesma marcação atualiza a
    // linha DESTE inspetor, nunca cria uma segunda e nunca toca a do
    // colega — que antes era exatamente o que acontecia, e o servidor
    // recusava com 42501.
    const payload = {
      vehicle_id: entrada.vehicle_id,
      item_number: entrada.item_number,
      entry_date: entrada.entry_date,
      status: entrada.status,
      nc_status: entrada.nc_status,
      problem_description: entrada.problem_description,
      created_by: entrada.created_by,
    };

    const { data, error } = await cliente
      .from("inspection_entries")
      .upsert(payload, { onConflict: "vehicle_id,item_number,entry_date,created_by" })
      .select()
      .single();

    if (error) {
      const tentativas = entrada._tentativas + 1;
      const estado: SyncState = ehErroDeRede(error)
        ? "pendente"
        : ehErroDePermissao(error) || tentativas >= MAX_TENTATIVAS_ANTES_DE_AVISAR
          ? "falha"
          : "pendente";
      await gravarEntradaLocal({
        ...entrada,
        _sync: estado,
        _tentativas: tentativas,
        _erro: mensagemDeErro(error),
      });
      avisar();
      if (ehErroDeRede(error)) return; // caiu a rede: para a fila inteira
      continue;
    }

    const servidor = normalizarEntrada(data as InspectionEntry);
    await gravarEntradaLocal({
      ...entrada,
      ...servidor,
      _sync: "sincronizado",
      _tentativas: 0,
      _erro: undefined,
      _localUpdatedAt: Date.now(),
    });
    avisar();
  }

  for (const obs of observacoes) {
    await gravarObservacaoLocal({ ...obs, _sync: "enviando" });
    // `ignoreDuplicates` gera ON CONFLICT DO NOTHING, e não DO UPDATE.
    // A diferença importa: observação é só-inserção — não existe policy
    // de UPDATE em `observations`, de propósito (o que foi anotado não se
    // reescreve). Com DO UPDATE, um reenvio da MESMA observação — o caso
    // normal quando o sinal cai depois de o servidor já ter gravado —
    // batia no conflito, caía no caminho de UPDATE e o Postgres recusava
    // com 42501. A fila marcava "falha" para sempre, e a anotação ficava
    // presa no aparelho. DO NOTHING transforma o reenvio num no-op.
    const { error } = await cliente.from("observations").upsert(
      {
        id: obs.id, // id do aparelho: reenviar não duplica
        vehicle_id: obs.vehicle_id,
        item_number: obs.item_number,
        entry_date: obs.entry_date,
        text: obs.text,
        author_id: obs.author_id,
        created_at: obs.created_at,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) {
      const tentativas = obs._tentativas + 1;
      await gravarObservacaoLocal({
        ...obs,
        _sync: ehErroDeRede(error) ? "pendente" : tentativas >= MAX_TENTATIVAS_ANTES_DE_AVISAR ? "falha" : "pendente",
        _tentativas: tentativas,
        _erro: mensagemDeErro(error),
      });
      avisar();
      if (ehErroDeRede(error)) return;
      continue;
    }
    await gravarObservacaoLocal({ ...obs, _sync: "sincronizado", _tentativas: 0, _erro: undefined });
    avisar();
  }
}

async function enviarFotos(): Promise<void> {
  const cliente = supabase();
  const { data: sessao } = await cliente.auth.getSession();
  const uid = sessao.session?.user.id;
  if (!uid) return;

  for (const foto of await fotosPendentes()) {
    await gravarFotoLocal({ ...foto, state: "enviando" });
    avisar();

    // A primeira pasta precisa ser o id do usuário: é o que a policy do
    // bucket confere.
    const caminho = `${uid}/${foto.vehicle_id}/${foto.entry_date}-item${foto.item_number}.jpg`;
    const { error: erroUpload } = await cliente.storage
      .from(BUCKET)
      .upload(caminho, foto.blob, { contentType: "image/jpeg", upsert: true });

    if (erroUpload) {
      const tentativas = foto.tentativas + 1;
      await gravarFotoLocal({
        ...foto,
        state: ehErroDeRede(erroUpload) ? "pendente" : tentativas >= MAX_TENTATIVAS_ANTES_DE_AVISAR ? "falha" : "pendente",
        tentativas,
        erro: mensagemDeErro(erroUpload),
      });
      avisar();
      if (ehErroDeRede(erroUpload)) return;
      continue;
    }

    const { error: erroPatch } = await cliente
      .from("inspection_entries")
      .update({ photo_url: caminho })
      .eq("vehicle_id", foto.vehicle_id)
      .eq("item_number", foto.item_number)
      .eq("entry_date", foto.entry_date)
      // Sem este filtro o UPDATE varreria também o registro do colega no
      // mesmo item e dia — a RLS o recusaria em silêncio, e a foto ficaria
      // presa na fila sem explicação.
      .eq("created_by", uid);

    if (erroPatch) {
      const tentativas = foto.tentativas + 1;
      await gravarFotoLocal({
        ...foto,
        state: ehErroDeRede(erroPatch) ? "pendente" : "falha",
        tentativas,
        erro: mensagemDeErro(erroPatch),
      });
      avisar();
      if (ehErroDeRede(erroPatch)) return;
      continue;
    }

    const base = await db();
    const chave = chaveEntrada(foto.vehicle_id, foto.item_number, foto.entry_date, uid);
    const entrada = await base.get("entries", chave);
    if (entrada) {
      await gravarEntradaLocal({
        ...entrada,
        photo_url: caminho,
        _fotoLocalId: undefined,
      });
    }
    await apagarFotoLocal(foto.id); // o blob já cumpriu o papel
    avisar();
  }
}

function mensagemDeErro(erro: unknown): string {
  const e = erro as { message?: string; code?: string };
  if (e?.code === "42501") {
    return "Sem permissão para gravar este registro. Se a data não é a de hoje, peça ao administrador.";
  }
  return e?.message ?? "Erro desconhecido ao sincronizar.";
}

// ------------------------------------------------------ leitura do servidor
export async function baixarCatalogo(): Promise<void> {
  if (!online()) return;
  const cliente = supabase();
  const [veiculos, perfis, fechamentos] = await Promise.all([
    cliente.from("vehicles").select("*").order("brand"),
    cliente.from("profiles").select("*").order("name"),
    cliente.from("month_closures").select("*"),
  ]);
  if (veiculos.error || perfis.error || fechamentos.error) return;
  await guardarCatalogo(veiculos.data ?? [], perfis.data ?? [], fechamentos.data ?? []);
  avisar();
}

export async function baixarRegistros(vehicleId: string, desde: IsoDate): Promise<void> {
  if (!online()) return;
  const cliente = supabase();
  const { data, error } = await cliente
    .from("inspection_entries")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .gte("entry_date", desde);
  if (error || !data) return;
  await mesclarDoServidor(vehicleId, data as InspectionEntry[], desde);
  avisar();
}

/**
 * Traz as observações do servidor para o aparelho.
 *
 * Faltava: a fila subia observação, mas nada nunca baixava de volta. O
 * resultado é que a observação só existia no celular de quem escreveu —
 * o administrador nunca via, e o próprio motorista perdia de vista ao
 * sair da conta. Como toda leitura do app passa pelo IndexedDB, sem esta
 * função a observação simplesmente não tinha como aparecer em tela
 * nenhuma.
 */
export async function baixarObservacoes(vehicleId: string, desde: IsoDate): Promise<void> {
  if (!online()) return;
  const cliente = supabase();
  const { data, error } = await cliente
    .from("observations")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .gte("entry_date", desde);
  if (error || !data) return;
  await mesclarObservacoesDoServidor(vehicleId, data as Observation[], desde);
  avisar();
}

export async function registrosLocais(vehicleId: string): Promise<EntradaLocal[]> {
  return entradasDoVeiculo(vehicleId);
}

// -------------------------------------------------------- ciclo de vida
let instalado = false;

/** Liga os gatilhos que fazem a fila andar sozinha. */
export function instalarSincronizacaoAutomatica(): () => void {
  if (typeof window === "undefined" || instalado) return () => {};
  instalado = true;

  const aoVoltar = () => {
    avisar();
    agendarSincronizacao(500);
  };
  const aoFocar = () => {
    if (document.visibilityState === "visible") agendarSincronizacao(200);
  };

  window.addEventListener("online", aoVoltar);
  window.addEventListener("offline", avisar);
  document.addEventListener("visibilitychange", aoFocar);
  const intervalo = setInterval(() => agendarSincronizacao(0), 60_000);

  agendarSincronizacao(0);

  return () => {
    window.removeEventListener("online", aoVoltar);
    window.removeEventListener("offline", avisar);
    document.removeEventListener("visibilitychange", aoFocar);
    clearInterval(intervalo);
    instalado = false;
  };
}
