"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, todayLocal } from "@/lib/domain/dates";
import type { IsoDate } from "@/lib/domain/types";
import {
  observacoesDe,
  observacoesDoVeiculo,
  type EntradaLocal,
  type ObservacaoLocal,
} from "./db";
import { aoMudar, baixarObservacoes, baixarRegistros, registrosLocais } from "./sync";

/**
 * Lê algo do banco do aparelho e mantém em dia quando a fila mexe.
 *
 * É o único ponto do app que assina a store externa de sincronização.
 * A regra `react-hooks/set-state-in-effect` reclama de qualquer efeito
 * que termine em setState — mas assinar um sistema externo (o IndexedDB
 * e a fila) é justamente para isso que o efeito serve, e não é cascata de
 * renderização. A exceção fica aqui, num lugar só, e não espalhada por
 * cada tela.
 */
function useLeituraLocal<T>(
  carregar: () => Promise<T>,
  inicial: T,
): { valor: T; recarregar: () => Promise<void> } {
  const [valor, setValor] = useState<T>(inicial);

  const recarregar = useCallback(async () => {
    setValor(await carregar());
  }, [carregar]);

  useEffect(() => {
    let vivo = true;
    const rodar = async () => {
      const novo = await carregar();
      if (vivo) setValor(novo);
    };
    void rodar();
    const desligar = aoMudar(() => void rodar());
    return () => {
      vivo = false;
      desligar();
    };
  }, [carregar]);

  return { valor, recarregar };
}

/**
 * Os registros de um veículo, sempre lidos do aparelho.
 *
 * A tela nunca lê direto do servidor: o servidor abastece o IndexedDB e a
 * tela lê de lá. É o que faz a interface se comportar igual com e sem
 * sinal — e o que garante que uma marcação recém-feita aparece na hora,
 * antes mesmo de subir.
 */
export function useRegistros(vehicleId: string | null, diasParaTras = 60) {
  // `dados: null` significa "ainda não li o aparelho para ESTE veículo".
  // Guardar a chave junto permite zerar a lista na própria renderização
  // quando o veículo muda, sem um efeito só para isso — trocar de
  // caminhão nunca mostra os registros do caminhão anterior.
  const [estado, setEstado] = useState<{
    chave: string | null;
    dados: EntradaLocal[] | null;
  }>({ chave: vehicleId, dados: null });

  if (estado.chave !== vehicleId) setEstado({ chave: vehicleId, dados: null });

  const recarregar = useCallback(async () => {
    const dados = await (vehicleId ? registrosLocais(vehicleId) : Promise.resolve([]));
    setEstado({ chave: vehicleId, dados });
  }, [vehicleId]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      await recarregar();
      if (!vivo || !vehicleId) return;
      await baixarRegistros(vehicleId, addDays(todayLocal(), -diasParaTras));
      if (vivo) await recarregar();
    })();
    const desligar = aoMudar(() => void recarregar());
    return () => {
      vivo = false;
      desligar();
    };
  }, [vehicleId, diasParaTras, recarregar]);

  return {
    entradas: estado.dados ?? [],
    carregando: estado.dados === null,
    recarregar,
  };
}

export function useObservacoes(
  vehicleId: string | null,
  itemNumber: number,
  entryDate: IsoDate,
) {
  const carregar = useCallback(
    () => (vehicleId ? observacoesDe(vehicleId, itemNumber, entryDate) : Promise.resolve([])),
    [vehicleId, itemNumber, entryDate],
  );
  const { valor, recarregar } = useLeituraLocal<ObservacaoLocal[]>(carregar, []);
  return { observacoes: valor, recarregar };
}

/** Índice rápido `item|data` → entrada, para a grade não varrer o array. */
export function useIndice(entradas: EntradaLocal[]) {
  return useMemo(() => {
    const mapa = new Map<string, EntradaLocal>();
    for (const e of entradas) mapa.set(`${e.item_number}|${e.entry_date}`, e);
    return mapa;
  }, [entradas]);
}

/** Registros de todos os veículos — usado pelo painel e pela lista de
 *  pendências, que olham a frota inteira. */
export function useRegistrosDaFrota(vehicleIds: string[], diasParaTras = 60) {
  const chave = vehicleIds.join(",");

  const carregar = useCallback(async () => {
    const ids = chave ? chave.split(",") : [];
    const lotes = await Promise.all(ids.map((id) => registrosLocais(id)));
    return lotes.flat();
  }, [chave]);
  const { valor, recarregar } = useLeituraLocal<EntradaLocal[] | null>(carregar, null);

  // Puxa do servidor em segundo plano; o resultado chega pela store.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const desde = addDays(todayLocal(), -diasParaTras);
      for (const id of chave ? chave.split(",") : []) {
        if (!vivo) return;
        await baixarRegistros(id, desde);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [chave, diasParaTras]);

  return { entradas: valor ?? [], carregando: valor === null, recarregar };
}

/** Todas as observações de um veículo — a folha impressa lista o mês inteiro. */
export function useObservacoesDoVeiculo(vehicleId: string | null, diasParaTras = 120) {
  const carregar = useCallback(
    () => (vehicleId ? observacoesDoVeiculo(vehicleId) : Promise.resolve([])),
    [vehicleId],
  );

  // Puxa do servidor em segundo plano; o resultado chega pela store.
  // Sem isto a tela só mostra o que foi escrito neste aparelho.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      if (!vehicleId || !vivo) return;
      await baixarObservacoes(vehicleId, addDays(todayLocal(), -diasParaTras));
    })();
    return () => {
      vivo = false;
    };
  }, [vehicleId, diasParaTras]);

  return useLeituraLocal<ObservacaoLocal[]>(carregar, []).valor;
}

/** Observações de toda a frota — usado pela aba de pendências, que junta
 *  não conformidades e observações de todos os caminhões numa lista só. */
export function useObservacoesDaFrota(vehicleIds: string[], diasParaTras = 60) {
  const chave = vehicleIds.join(",");

  const carregar = useCallback(async () => {
    const ids = chave ? chave.split(",") : [];
    const lotes = await Promise.all(ids.map((id) => observacoesDoVeiculo(id)));
    return lotes.flat();
  }, [chave]);
  const { valor, recarregar } = useLeituraLocal<ObservacaoLocal[] | null>(carregar, null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const desde = addDays(todayLocal(), -diasParaTras);
      for (const id of chave ? chave.split(",") : []) {
        if (!vivo) return;
        await baixarObservacoes(id, desde);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [chave, diasParaTras]);

  return { observacoes: valor ?? [], carregando: valor === null, recarregar };
}
