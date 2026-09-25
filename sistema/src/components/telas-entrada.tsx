"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, LogIn, Truck } from "lucide-react";
import { supabase, supabaseConfigurado } from "@/lib/supabase/client";
import {
  conferirPin,
  definirPin,
  diasRestantesDaJanela,
  esquecerPin,
  MAX_TENTATIVAS,
  pinValido,
  registrarLoginCompleto,
} from "@/lib/auth/pin";
import { validarEmail } from "@/lib/sanitize";
import { useApp } from "./app-provider";
import { Aviso, Botao, Campo, inputCls } from "./ui";

function Moldura({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-marca-800 ring-4 ring-marca-400">
            <Truck size={30} className="text-marca-400" />
          </div>
          <h1 className="text-lg font-black uppercase tracking-tight text-marca-900">Gestão de Entregas</h1>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Inspeção de frota
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-stone-900">{titulo}</h2>
          <p className="mb-4 mt-1 text-sm text-stone-500">{subtitulo}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function TelaLogin() {
  const { revalidarEntrada } = useApp();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!validarEmail(email)) return setErro("Informe um e-mail válido.");
    if (senha.length < 6) return setErro("A senha precisa ter ao menos 6 caracteres.");

    setEnviando(true);
    try {
      const { error } = await supabase().auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      });
      if (error) {
        setErro(
          /Invalid login/i.test(error.message)
            ? "E-mail ou senha incorretos."
            : "Não foi possível entrar. Verifique sua conexão e tente de novo.",
        );
        return;
      }
      await esquecerPin(); // login novo pede PIN novo
      await registrarLoginCompleto();
      await revalidarEntrada();
    } catch {
      setErro("Não foi possível entrar. Verifique sua conexão e tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  if (!supabaseConfigurado) {
    return (
      <Moldura titulo="Configuração pendente" subtitulo="O app ainda não sabe onde fica o banco.">
        <Aviso tipo="erro">
          Faltam as variáveis <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Em desenvolvimento, copie{" "}
          <code>.env.example</code> para <code>.env.local</code>; em produção, configure no painel
          do Netlify.
        </Aviso>
      </Moldura>
    );
  }

  return (
    <Moldura titulo="Entrar" subtitulo="Use o e-mail cadastrado pela empresa.">
      <form onSubmit={entrar} className="space-y-4" noValidate>
        <Campo label="E-mail">
          <input
            className={inputCls}
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="usuario-785ba88f@example.invalid"
          />
        </Campo>
        <Campo label="Senha">
          <input
            className={inputCls}
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </Campo>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Botao type="submit" disabled={enviando} className="w-full">
          <LogIn size={18} />
          {enviando ? "Entrando…" : "Entrar"}
        </Botao>
        <p className="text-center text-xs text-stone-500">
          Depois de entrar, o app fica destravado por 30 dias com um PIN de 4 números.
        </p>
      </form>
    </Moldura>
  );
}

function CamposPin({
  valor,
  aoMudar,
  aoCompletar,
  rotulo,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  aoCompletar?: (v: string) => void;
  rotulo: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div>
      <input
        ref={ref}
        aria-label={rotulo}
        className="sr-only"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={4}
        value={valor}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 4);
          aoMudar(v);
          if (v.length === 4) aoCompletar?.(v);
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.focus()}
        className="flex w-full justify-center gap-3"
        aria-hidden
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`flex h-14 w-12 items-center justify-center rounded-xl border-2 text-2xl font-bold ${
              valor.length === i
                ? "border-marca-500 bg-marca-50"
                : "border-stone-300 bg-white text-stone-800"
            }`}
          >
            {valor[i] ? "•" : ""}
          </span>
        ))}
      </button>
    </div>
  );
}

export function TelaDefinirPin() {
  const { revalidarEntrada, sair } = useApp();
  const [pin, setPin] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [etapa, setEtapa] = useState<"criar" | "confirmar">("criar");
  const [erro, setErro] = useState("");

  async function concluir(valor: string) {
    if (valor !== pin) {
      setErro("Os dois PINs não bateram. Comece de novo.");
      setPin("");
      setConfirmacao("");
      setEtapa("criar");
      return;
    }
    await definirPin(pin);
    await revalidarEntrada();
  }

  return (
    <Moldura
      titulo={etapa === "criar" ? "Crie um PIN" : "Confirme o PIN"}
      subtitulo={
        etapa === "criar"
          ? "4 números. É com ele que você abre o app nos próximos 30 dias, mesmo sem sinal."
          : "Digite o mesmo PIN de novo."
      }
    >
      <div className="space-y-4">
        {etapa === "criar" ? (
          <CamposPin
            rotulo="Novo PIN de 4 números"
            valor={pin}
            aoMudar={(v) => {
              setPin(v);
              setErro("");
            }}
            aoCompletar={(v) => {
              if (pinValido(v)) setEtapa("confirmar");
            }}
          />
        ) : (
          <CamposPin
            rotulo="Confirmação do PIN"
            valor={confirmacao}
            aoMudar={setConfirmacao}
            aoCompletar={concluir}
          />
        )}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Botao variante="fantasma" className="w-full" onClick={() => void sair()}>
          Sair desta conta
        </Botao>
      </div>
    </Moldura>
  );
}

export function TelaPin() {
  const { revalidarEntrada, sair } = useApp();
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState("");
  const [dias, setDias] = useState<number | null>(null);

  useEffect(() => {
    void diasRestantesDaJanela().then(setDias);
  }, []);

  async function conferir(valor: string) {
    const r = await conferirPin(valor);
    if (r.ok) {
      await revalidarEntrada();
      return;
    }
    setPin("");
    setErro(
      r.bloqueado
        ? "PIN bloqueado depois de várias tentativas. Entre com e-mail e senha."
        : `PIN incorreto. ${r.tentativasRestantes} de ${MAX_TENTATIVAS} tentativas restantes.`,
    );
  }

  return (
    <Moldura
      titulo="Digite seu PIN"
      subtitulo={
        dias !== null && dias > 0
          ? `Sessão válida por mais ${dias} dia(s) neste aparelho.`
          : "Sessão deste aparelho."
      }
    >
      <div className="space-y-4">
        <CamposPin rotulo="PIN de 4 números" valor={pin} aoMudar={(v) => { setPin(v); setErro(""); }} aoCompletar={conferir} />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="flex items-center justify-center gap-1 text-xs text-stone-500">
          <Lock size={12} />
          <span>O PIN destrava este aparelho. Ele não sai daqui.</span>
        </div>
        <Botao variante="fantasma" className="w-full" onClick={() => void sair()}>
          Entrar com e-mail e senha
        </Botao>
      </div>
    </Moldura>
  );
}
