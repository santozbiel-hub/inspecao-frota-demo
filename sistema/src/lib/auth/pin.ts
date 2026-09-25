"use client";

import { gravarMeta, lerMeta } from "@/lib/offline/db";

/**
 * A trava de PIN do aparelho.
 *
 * O que ela é: um cadeado local. A sessão do Supabase fica guardada no
 * aparelho por ~30 dias e o PIN destrava o app sem exigir a senha inteira
 * — que é o que permite o motorista abrir o app no pátio, sem sinal.
 *
 * O que ela NÃO é: um segundo fator. Ela não é conferida no servidor
 * (não teria como, offline). Quem autoriza cada gravação continua sendo
 * o JWT do Supabase Auth mais o RLS do Postgres. Se o aparelho for
 * roubado, o caminho certo é desativar o usuário no painel — o PIN só
 * atrasa quem pegou o celular destravado.
 *
 * Mesmo sendo local, o PIN nunca é gravado em texto: vai PBKDF2 com sal
 * aleatório, para que um despejo do IndexedDB não entregue os 4 dígitos.
 */

const JANELA_DIAS = 30;
export const JANELA_MS = JANELA_DIAS * 24 * 60 * 60 * 1000;

const CHAVE_HASH = "pinHash";
const CHAVE_SAL = "pinSal";
const CHAVE_LOGIN = "ultimoLoginCompleto";
const CHAVE_TENTATIVAS = "pinTentativas";
const CHAVE_DESTRAVADO = "bp-frota-destravado";

export const MAX_TENTATIVAS = 5;
const ITERACOES = 150_000;

function paraHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function derivar(pin: string, salHex: string): Promise<string> {
  const enc = new TextEncoder();
  const sal = Uint8Array.from(salHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const chave = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: sal as BufferSource, iterations: ITERACOES, hash: "SHA-256" },
    chave,
    256,
  );
  return paraHex(bits);
}

export function pinValido(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export async function definirPin(pin: string): Promise<void> {
  if (!pinValido(pin)) throw new Error("O PIN precisa ter 4 números.");
  const sal = paraHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  await gravarMeta(CHAVE_SAL, sal);
  await gravarMeta(CHAVE_HASH, await derivar(pin, sal));
  await gravarMeta(CHAVE_TENTATIVAS, 0);
}

export async function temPin(): Promise<boolean> {
  return Boolean(await lerMeta<string>(CHAVE_HASH));
}

export interface ResultadoPin {
  ok: boolean;
  tentativasRestantes: number;
  bloqueado: boolean;
}

export async function conferirPin(pin: string): Promise<ResultadoPin> {
  const sal = await lerMeta<string>(CHAVE_SAL);
  const esperado = await lerMeta<string>(CHAVE_HASH);
  const tentativas = (await lerMeta<number>(CHAVE_TENTATIVAS)) ?? 0;

  if (!sal || !esperado) return { ok: false, tentativasRestantes: 0, bloqueado: true };
  if (tentativas >= MAX_TENTATIVAS) return { ok: false, tentativasRestantes: 0, bloqueado: true };

  const obtido = await derivar(pin, sal);
  // comparação de tempo constante — barato e evita um canal lateral bobo
  let diff = obtido.length ^ esperado.length;
  for (let i = 0; i < Math.max(obtido.length, esperado.length); i++) {
    diff |= obtido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  const ok = diff === 0;

  const novasTentativas = ok ? 0 : tentativas + 1;
  await gravarMeta(CHAVE_TENTATIVAS, novasTentativas);
  if (ok) destravar();

  return {
    ok,
    tentativasRestantes: Math.max(0, MAX_TENTATIVAS - novasTentativas),
    bloqueado: novasTentativas >= MAX_TENTATIVAS,
  };
}

export async function registrarLoginCompleto(): Promise<void> {
  await gravarMeta(CHAVE_LOGIN, Date.now());
  await gravarMeta(CHAVE_TENTATIVAS, 0);
  destravar();
}

/** Fora da janela de 30 dias, o PIN não basta: pede e-mail e senha. */
export async function precisaLoginCompleto(): Promise<boolean> {
  const ultimo = await lerMeta<number>(CHAVE_LOGIN);
  if (!ultimo) return true;
  return Date.now() - ultimo > JANELA_MS;
}

export async function diasRestantesDaJanela(): Promise<number> {
  const ultimo = await lerMeta<number>(CHAVE_LOGIN);
  if (!ultimo) return 0;
  return Math.max(0, Math.ceil((JANELA_MS - (Date.now() - ultimo)) / (24 * 60 * 60 * 1000)));
}

// O "destravado" vale só enquanto o app está aberto: fechou, pede o PIN
// de novo. sessionStorage é exatamente essa vida útil.
export function destravado(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(CHAVE_DESTRAVADO) === "1";
}

export function destravar(): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CHAVE_DESTRAVADO, "1");
}

export function travar(): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(CHAVE_DESTRAVADO);
}

export async function esquecerPin(): Promise<void> {
  await gravarMeta(CHAVE_HASH, undefined);
  await gravarMeta(CHAVE_SAL, undefined);
  await gravarMeta(CHAVE_TENTATIVAS, 0);
  travar();
}
