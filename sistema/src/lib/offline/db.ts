"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  InspectionEntry,
  MonthClosure,
  Observation,
  Profile,
  SyncState,
  Vehicle,
} from "@/lib/domain/types";

/**
 * O banco do aparelho.
 *
 * Nenhuma marcação vai direto para o servidor: ela é gravada aqui
 * primeiro e só depois entra na fila. É o que garante que o motorista
 * pode terminar a inspeção inteira na doca, sem sinal, e nada se perde
 * se ele fechar o app antes de a conexão voltar.
 */

export interface EntradaLocal extends InspectionEntry {
  /** Estado de sincronização mostrado por item na tela. */
  _sync: SyncState;
  /** Relógio do aparelho no momento da marcação — desempata a fila. */
  _localUpdatedAt: number;
  _tentativas: number;
  _erro?: string;
  /** Foto ainda não enviada: id na store `photos`. */
  _fotoLocalId?: string;
}

export interface ObservacaoLocal extends Observation {
  _sync: SyncState;
  _localUpdatedAt: number;
  _tentativas: number;
  _erro?: string;
}

export interface FotoLocal {
  id: string;
  vehicle_id: string;
  item_number: number;
  entry_date: string;
  blob: Blob;
  bytes: number;
  state: SyncState;
  tentativas: number;
  erro?: string;
  criadoEm: number;
}

interface EsquemaBP extends DBSchema {
  entries: {
    key: string; // `${vehicle_id}|${item_number}|${entry_date}`
    value: EntradaLocal;
    indexes: { por_sync: string; por_veiculo_data: [string, string] };
  };
  observations: {
    key: string;
    value: ObservacaoLocal;
    indexes: { por_sync: string; por_alvo: [string, number, string] };
  };
  photos: {
    key: string;
    value: FotoLocal;
    indexes: { por_state: string };
  };
  vehicles: { key: string; value: Vehicle };
  profiles: { key: string; value: Profile };
  closures: { key: string; value: MonthClosure };
  meta: { key: string; value: unknown };
}

/**
 * A data que volta do servidor precisa ser sempre `YYYY-MM-DD`.
 *
 * Ela é parte da chave do registro no aparelho. Se um dia chegar como
 * timestamp completo — outro driver, outra versão do PostgREST, um proxy
 * no meio — a chave muda e o mesmo item vira duas linhas no IndexedDB.
 * Custa uma linha normalizar aqui e evita um bug que só aparece como
 * "registro fantasma" muito longe da causa.
 */
export function normalizarEntrada<T extends { entry_date: string }>(linha: T): T {
  return { ...linha, entry_date: String(linha.entry_date).slice(0, 10) };
}

/**
 * Chave do registro no aparelho.
 *
 * Inclui o autor desde a migration 015: cada inspetor tem o próprio
 * registro do item no dia, e ninguém sobrescreve ninguém. Sem o autor
 * aqui, o servidor guardaria as duas linhas mas o celular guardaria só
 * uma — a última a ser baixada apagaria a outra da tela, reproduzindo
 * dentro do aparelho exatamente o bug que a migration foi consertar.
 */
export const chaveEntrada = (
  vehicleId: string,
  itemNumber: number,
  entryDate: string,
  createdBy: string,
) => `${vehicleId}|${itemNumber}|${entryDate}|${createdBy}`;

let promessa: Promise<IDBPDatabase<EsquemaBP>> | null = null;

export function db(): Promise<IDBPDatabase<EsquemaBP>> {
  if (!promessa) {
    promessa = openDB<EsquemaBP>("bp-frota", 1, {
      upgrade(base) {
        const entries = base.createObjectStore("entries");
        entries.createIndex("por_sync", "_sync");
        entries.createIndex("por_veiculo_data", ["vehicle_id", "entry_date"]);

        const obs = base.createObjectStore("observations", { keyPath: "id" });
        obs.createIndex("por_sync", "_sync");
        obs.createIndex("por_alvo", ["vehicle_id", "item_number", "entry_date"]);

        const fotos = base.createObjectStore("photos", { keyPath: "id" });
        fotos.createIndex("por_state", "state");

        base.createObjectStore("vehicles", { keyPath: "id" });
        base.createObjectStore("profiles", { keyPath: "id" });
        base.createObjectStore("closures", { keyPath: "id" });
        base.createObjectStore("meta");
      },
    });
  }
  return promessa;
}

// ----------------------------------------------------------------- meta
export async function lerMeta<T>(chave: string): Promise<T | undefined> {
  return (await db()).get("meta", chave) as Promise<T | undefined>;
}

export async function gravarMeta(chave: string, valor: unknown): Promise<void> {
  await (await db()).put("meta", valor, chave);
}

// -------------------------------------------------------------- leitura
export async function entradasDoVeiculo(
  vehicleId: string,
): Promise<EntradaLocal[]> {
  const base = await db();
  const todas = await base.getAll("entries");
  return todas.filter((e) => e.vehicle_id === vehicleId);
}

export async function entradasDoDia(
  vehicleId: string,
  entryDate: string,
): Promise<EntradaLocal[]> {
  const base = await db();
  return base.getAllFromIndex("entries", "por_veiculo_data", [vehicleId, entryDate]);
}

export async function observacoesDe(
  vehicleId: string,
  itemNumber: number,
  entryDate: string,
): Promise<ObservacaoLocal[]> {
  const base = await db();
  const lista = await base.getAllFromIndex("observations", "por_alvo", [
    vehicleId,
    itemNumber,
    entryDate,
  ]);
  return lista.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function observacoesDoVeiculo(
  vehicleId: string,
): Promise<ObservacaoLocal[]> {
  const base = await db();
  return (await base.getAll("observations")).filter((o) => o.vehicle_id === vehicleId);
}

export async function pendentesDeTexto(): Promise<{
  entradas: EntradaLocal[];
  observacoes: ObservacaoLocal[];
}> {
  const base = await db();
  const entradas = (await base.getAll("entries")).filter(
    (e) => e._sync !== "sincronizado",
  );
  const observacoes = (await base.getAll("observations")).filter(
    (o) => o._sync !== "sincronizado",
  );
  return {
    entradas: entradas.sort((a, b) => a._localUpdatedAt - b._localUpdatedAt),
    observacoes: observacoes.sort((a, b) => a._localUpdatedAt - b._localUpdatedAt),
  };
}

export async function fotosPendentes(): Promise<FotoLocal[]> {
  const base = await db();
  return (await base.getAll("photos"))
    .filter((f) => f.state !== "sincronizado")
    .sort((a, b) => a.criadoEm - b.criadoEm);
}

// -------------------------------------------------------------- escrita
export async function gravarEntradaLocal(entrada: EntradaLocal): Promise<void> {
  const base = await db();
  await base.put(
    "entries",
    entrada,
    chaveEntrada(
      entrada.vehicle_id,
      entrada.item_number,
      entrada.entry_date,
      entrada.created_by,
    ),
  );
}

export async function gravarObservacaoLocal(obs: ObservacaoLocal): Promise<void> {
  await (await db()).put("observations", obs);
}

export async function gravarFotoLocal(foto: FotoLocal): Promise<void> {
  await (await db()).put("photos", foto);
}

export async function apagarFotoLocal(id: string): Promise<void> {
  await (await db()).delete("photos", id);
}

/**
 * Mescla o que veio do servidor com o que está no aparelho.
 *
 * A regra é deliberadamente conservadora: uma linha que ainda não subiu
 * NUNCA é sobrescrita pela versão do servidor. O contrário — descartar a
 * marcação local porque o servidor respondeu primeiro — é exatamente o
 * bug que fazia o protótipo perder trabalho.
 */
export async function mesclarDoServidor(
  vehicleId: string,
  doServidor: InspectionEntry[],
  desde: string,
): Promise<void> {
  const base = await db();
  const tx = base.transaction("entries", "readwrite");
  const store = tx.objectStore("entries");

  for (const bruta of doServidor) {
    const remota = normalizarEntrada(bruta);
    const chave = chaveEntrada(
      remota.vehicle_id,
      remota.item_number,
      remota.entry_date,
      remota.created_by,
    );
    const local = await store.get(chave);
    if (local && local._sync !== "sincronizado") continue; // fila local manda
    await store.put(
      { ...remota, _sync: "sincronizado", _localUpdatedAt: Date.parse(remota.updated_at), _tentativas: 0 },
      chave,
    );
  }

  // Linhas que o servidor não tem mais (administrador apagou) e que já
  // estavam sincronizadas aqui saem também.
  //
  // A varredura respeita `desde`: o servidor só nos mandou o que está
  // dentro da janela pedida, então uma linha mais antiga que isso está
  // ausente da resposta por não ter sido pedida — não por ter sido
  // apagada. Sem esta guarda, abrir a Grade (120 dias) apagava do
  // aparelho tudo o que as Pendências (180 dias) tinham acabado de
  // baixar, e o registro sumia da tela até a próxima sincronização.
  const idsRemotos = new Set(
    doServidor
      .map(normalizarEntrada)
      .map((r) => chaveEntrada(r.vehicle_id, r.item_number, r.entry_date, r.created_by)),
  );
  for (const chave of await store.getAllKeys()) {
    const local = await store.get(chave);
    if (!local || local.vehicle_id !== vehicleId) continue;
    if (local.entry_date < desde) continue;
    if (local._sync === "sincronizado" && !idsRemotos.has(chave)) {
      await store.delete(chave);
    }
  }
  await tx.done;
}

/**
 * Mesma ideia para as observações — que até agora só subiam.
 *
 * Uma observação escrita no celular do motorista era gravada aqui e
 * enviada ao servidor, mas nunca voltava: nenhuma leitura no app lia a
 * tabela `observations`. Na prática ela existia só no aparelho de quem
 * digitou. No aparelho do administrador — e no do próprio motorista
 * depois de sair da conta, que limpa o IndexedDB — não existia em lugar
 * nenhum, nem na grade, nem na folha impressa.
 *
 * Observação não tem `updated_at`: ela nasce e não muda (a policy só
 * permite inserir e apagar). Por isso o merge é mais simples que o das
 * entradas — o que está no servidor vale, o que está na fila local fica.
 */
export async function mesclarObservacoesDoServidor(
  vehicleId: string,
  doServidor: Observation[],
  desde: string,
): Promise<void> {
  const base = await db();
  const tx = base.transaction("observations", "readwrite");
  const store = tx.objectStore("observations");

  for (const bruta of doServidor) {
    const remota = normalizarEntrada(bruta);
    const local = await store.get(remota.id);
    if (local && local._sync !== "sincronizado") continue; // ainda subindo: não mexe
    await store.put({
      ...remota,
      _sync: "sincronizado",
      _localUpdatedAt: Date.parse(remota.created_at),
      _tentativas: 0,
    });
  }

  const idsRemotos = new Set(doServidor.map((o) => o.id));
  for (const local of await store.getAll()) {
    if (local.vehicle_id !== vehicleId) continue;
    if (local.entry_date < desde) continue;
    if (local._sync === "sincronizado" && !idsRemotos.has(local.id)) {
      await store.delete(local.id);
    }
  }
  await tx.done;
}

export async function guardarCatalogo(
  veiculos: Vehicle[],
  perfis: Profile[],
  fechamentos: MonthClosure[],
): Promise<void> {
  const base = await db();
  const tx = base.transaction(["vehicles", "profiles", "closures"], "readwrite");
  await tx.objectStore("vehicles").clear();
  await tx.objectStore("profiles").clear();
  await tx.objectStore("closures").clear();
  for (const v of veiculos) await tx.objectStore("vehicles").put(v);
  for (const p of perfis) await tx.objectStore("profiles").put(p);
  for (const c of fechamentos) await tx.objectStore("closures").put(c);
  await tx.done;
}

export async function catalogoLocal() {
  const base = await db();
  const [veiculos, perfis, fechamentos] = await Promise.all([
    base.getAll("vehicles"),
    base.getAll("profiles"),
    base.getAll("closures"),
  ]);
  // O IndexedDB devolve na ordem da chave primária, ou seja, por UUID.
  // Sem reordenar, a lista de caminhões do motorista aparece em ordem
  // aleatória e muda de posição sem motivo — e o veículo escolhido por
  // padrão vira sorteio.
  const porTexto = (a: string, b: string) => a.localeCompare(b, "pt-BR");
  veiculos.sort(
    (a, b) => porTexto(a.brand, b.brand) || porTexto(a.plate, b.plate),
  );
  perfis.sort((a, b) => porTexto(a.name, b.name));
  return { veiculos, perfis, fechamentos };
}

/** Limpa tudo do aparelho — usado no logout completo. */
export async function limparAparelho(): Promise<void> {
  const base = await db();
  const tx = base.transaction(
    ["entries", "observations", "photos", "vehicles", "profiles", "closures", "meta"],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("entries").clear(),
    tx.objectStore("observations").clear(),
    tx.objectStore("photos").clear(),
    tx.objectStore("vehicles").clear(),
    tx.objectStore("profiles").clear(),
    tx.objectStore("closures").clear(),
    tx.objectStore("meta").clear(),
  ]);
  await tx.done;
}
