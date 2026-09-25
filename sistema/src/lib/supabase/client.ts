"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente do navegador. A sessão fica no localStorage e é renovada
 * sozinha — isso é o que permite o motorista abrir o app sem sinal e
 * ainda estar logado.
 *
 * Nada de chave aqui dentro: as duas variáveis vêm do ambiente (.env.local
 * em desenvolvimento, painel do Netlify em produção). A anon key é
 * pública por definição — quem protege os dados é o RLS do Postgres.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let instancia: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!url || !anon) {
    throw new Error(
      "Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Em desenvolvimento, copie .env.example para .env.local; em produção, " +
        "configure no painel do Netlify.",
    );
  }
  if (!instancia) {
    instancia = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "bp-frota-auth",
      },
      global: { headers: { "x-application-name": "inspecao-frota" } },
    });
  }
  return instancia;
}

export const supabaseConfigurado = Boolean(url && anon);
