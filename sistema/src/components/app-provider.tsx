"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigurado } from "@/lib/supabase/client";
import { catalogoLocal, limparAparelho } from "@/lib/offline/db";
import {
  aoMudar,
  baixarCatalogo,
  instalarSincronizacaoAutomatica,
  resumoDaFila,
  sincronizar,
  type ResumoFila,
} from "@/lib/offline/sync";
import { destravado, precisaLoginCompleto, temPin, travar } from "@/lib/auth/pin";
import type { MonthClosure, Profile, Vehicle } from "@/lib/domain/types";

type EstadoEntrada = "carregando" | "login" | "pin" | "definir-pin" | "pronto";

interface Contexto {
  estado: EstadoEntrada;
  sessao: Session | null;
  perfil: Profile | null;
  ehAdmin: boolean;
  veiculos: Vehicle[];
  perfis: Profile[];
  fechamentos: MonthClosure[];
  fila: ResumoFila;
  recarregarCatalogo: () => Promise<void>;
  sincronizarAgora: () => Promise<void>;
  sair: () => Promise<void>;
  revalidarEntrada: () => Promise<void>;
}

const Ctx = createContext<Contexto | null>(null);

const FILA_VAZIA: ResumoFila = {
  entradasPendentes: 0,
  observacoesPendentes: 0,
  fotosPendentes: 0,
  falhas: 0,
  ultimaSincronizacao: null,
  sincronizando: false,
  online: true,
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<EstadoEntrada>("carregando");
  const [sessao, setSessao] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Profile | null>(null);
  const [veiculos, setVeiculos] = useState<Vehicle[]>([]);
  const [perfis, setPerfis] = useState<Profile[]>([]);
  const [fechamentos, setFechamentos] = useState<MonthClosure[]>([]);
  const [fila, setFila] = useState<ResumoFila>(FILA_VAZIA);

  const lerCatalogo = useCallback(async () => {
    const { veiculos: v, perfis: p, fechamentos: f } = await catalogoLocal();
    setVeiculos(v);
    setPerfis(p);
    setFechamentos(f);
    return { veiculos: v, perfis: p };
  }, []);

  /** Decide se o app abre direto, pede PIN ou pede login completo.
   *  Calcula tudo antes de tocar em estado — assim a tela nunca pisca
   *  entre dois destinos enquanto as verificações rodam. */
  const revalidarEntrada = useCallback(async () => {
    const decidir = async (): Promise<{ estado: EstadoEntrada; sessao: Session | null }> => {
      if (!supabaseConfigurado) return { estado: "login", sessao: null };

      const { data } = await supabase().auth.getSession();
      const s = data.session ?? null;
      if (!s) return { estado: "login", sessao: null };

      // Passou dos 30 dias: o PIN não vale mais.
      if (await precisaLoginCompleto()) return { estado: "login", sessao: s };
      if (!(await temPin())) return { estado: "definir-pin", sessao: s };
      if (!destravado()) return { estado: "pin", sessao: s };
      return { estado: "pronto", sessao: s };
    };

    const decisao = await decidir();
    setSessao(decisao.sessao);
    setEstado(decisao.estado);
  }, []);

  // Perfil: tenta o servidor, cai para o cache do aparelho se estiver sem sinal.
  const carregarPerfil = useCallback(
    async (userId: string) => {
      const { perfis: cache } = await lerCatalogo();
      const doCache = cache.find((p) => p.id === userId) ?? null;
      if (doCache) setPerfil(doCache);
      try {
        const { data } = await supabase()
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();
        if (data) setPerfil(data as Profile);
      } catch {
        /* offline: fica com o do cache */
      }
    },
    [lerCatalogo],
  );

  // Assinatura do Supabase Auth: um sistema externo. O primeiro cálculo do
  // destino roda aqui também, porque só o navegador sabe se existe sessão
  // guardada no aparelho.
  useEffect(() => {
    let vivo = true;
    const iniciar = async () => {
      await revalidarEntrada();
      if (!vivo) return;
    };
    void iniciar();

    if (!supabaseConfigurado) return () => {
      vivo = false;
    };

    const { data: sub } = supabase().auth.onAuthStateChange((_evento, s) => {
      if (!vivo) return;
      setSessao(s);
      if (!s) {
        setPerfil(null);
        setEstado("login");
      }
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, [revalidarEntrada]);

  useEffect(() => {
    if (estado !== "pronto" || !sessao) return;
    void (async () => {
      await carregarPerfil(sessao.user.id);
      await baixarCatalogo();
      await lerCatalogo();
    })();
  }, [estado, sessao, carregarPerfil, lerCatalogo]);

  useEffect(() => {
    const atualizar = () => void resumoDaFila().then(setFila);
    const desinstalarOuvinte = aoMudar(atualizar);
    const desinstalarSync = instalarSincronizacaoAutomatica();
    atualizar();
    return () => {
      desinstalarOuvinte();
      desinstalarSync();
    };
  }, []);

  const sair = useCallback(async () => {
    travar();
    try {
      await supabase().auth.signOut();
    } catch {
      /* sem rede: a sessão local já foi embora */
    }
    await limparAparelho();
    setPerfil(null);
    setSessao(null);
    setEstado("login");
  }, []);

  const valor = useMemo<Contexto>(
    () => ({
      estado,
      sessao,
      perfil,
      ehAdmin: perfil?.role === "admin",
      veiculos,
      perfis,
      fechamentos,
      fila,
      recarregarCatalogo: async () => {
        await baixarCatalogo();
        await lerCatalogo();
      },
      sincronizarAgora: async () => {
        setFila(await sincronizar());
      },
      sair,
      revalidarEntrada,
    }),
    [estado, sessao, perfil, veiculos, perfis, fechamentos, fila, lerCatalogo, sair, revalidarEntrada],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useApp(): Contexto {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp precisa estar dentro de <AppProvider>");
  return c;
}
