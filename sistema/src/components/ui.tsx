"use client";

import { AlertTriangle, Check, CheckCircle2, CloudOff, Loader2, Minus, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";
import type { EntryStatus, SyncState } from "@/lib/domain/types";

export function Botao({
  variante = "primario",
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "secundario" | "perigo" | "fantasma";
}) {
  const base =
    "toque inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  const variantes = {
    primario: "bg-marca-400 text-stone-900 hover:bg-marca-500 focus-visible:ring-marca-500",
    secundario:
      "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 focus-visible:ring-stone-400",
    perigo: "bg-naoconforme-700 text-white hover:bg-naoconforme-500 focus-visible:ring-naoconforme-500",
    fantasma: "text-stone-600 hover:bg-stone-100 focus-visible:ring-stone-400",
  };
  return (
    <button className={`${base} ${variantes[variante]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Cartao({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Campo({
  label,
  dica,
  erro,
  children,
}: {
  label: string;
  dica?: string;
  erro?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-stone-500">
        {label}
      </span>
      {children}
      {dica && !erro && <span className="mt-1 block text-xs text-stone-500">{dica}</span>}
      {erro && (
        <span role="alert" className="mt-1 block text-xs font-semibold text-naoconforme-700">
          {erro}
        </span>
      )}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-stone-900 outline-none transition focus:border-marca-500 focus:ring-2 focus:ring-marca-400/40";

export function Etiqueta({
  cor = "cinza",
  children,
}: {
  cor?: "cinza" | "verde" | "vermelho" | "ambar" | "marca";
  children: React.ReactNode;
}) {
  const cores = {
    cinza: "bg-stone-100 text-stone-700 border-stone-200",
    verde: "bg-conforme-50 text-conforme-700 border-conforme-500/30",
    vermelho: "bg-naoconforme-50 text-naoconforme-700 border-naoconforme-500/30",
    ambar: "bg-atencao-50 text-atencao-700 border-atencao-500/40",
    marca: "bg-marca-50 text-marca-900 border-marca-400/50",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cores[cor]}`}
    >
      {children}
    </span>
  );
}

export function Aviso({
  tipo = "info",
  children,
}: {
  tipo?: "info" | "alerta" | "erro" | "sucesso";
  children: React.ReactNode;
}) {
  const cls = {
    info: "border-stone-200 bg-stone-50 text-stone-700",
    alerta: "border-atencao-500/40 bg-atencao-50 text-atencao-700",
    erro: "border-naoconforme-500/30 bg-naoconforme-50 text-naoconforme-700",
    sucesso: "border-conforme-500/30 bg-conforme-50 text-conforme-700",
  };
  return (
    <div role="status" className={`rounded-xl border px-3.5 py-2.5 text-sm ${cls[tipo]}`}>
      {children}
    </div>
  );
}

export function Vazio({
  icone: Icone,
  titulo,
  texto,
  acao,
}: {
  icone: React.ComponentType<{ size?: number; className?: string }>;
  titulo: string;
  texto: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
      <Icone size={32} className="text-stone-400" />
      <p className="font-semibold text-stone-700">{titulo}</p>
      <p className="max-w-sm text-sm text-stone-500">{texto}</p>
      {acao}
    </div>
  );
}

export function Modal({
  aberto,
  aoFechar,
  titulo,
  largura = "max-w-lg",
  children,
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  largura?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`w-full ${largura} max-h-[92vh] overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl`}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-white px-5 py-3.5">
          <h2 className="text-base font-bold text-stone-900">{titulo}</h2>
          <button onClick={aoFechar} aria-label="Fechar" className="toque rounded-lg p-1 text-stone-500 hover:bg-stone-100">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Botões grandes de Conforme / Não Conforme. O motorista nunca digita
 *  "C" ou "NC" — mas é isso que fica gravado no banco. */
export function SeletorStatus({
  valor,
  aoMudar,
  desabilitado,
  compacto = false,
}: {
  valor: EntryStatus | null;
  aoMudar: (v: EntryStatus) => void;
  desabilitado?: boolean;
  compacto?: boolean;
}) {
  const opcoes: { v: EntryStatus; rotulo: string; ativo: string; icone: React.ReactNode }[] = [
    {
      v: "C",
      rotulo: "Conforme",
      ativo: "bg-conforme-500 text-white border-conforme-500 shadow-sm",
      icone: <Check size={compacto ? 16 : 20} />,
    },
    {
      v: "NC",
      rotulo: "Não Conforme",
      ativo: "bg-naoconforme-500 text-white border-naoconforme-500 shadow-sm",
      icone: <X size={compacto ? 16 : 20} />,
    },
  ];
  return (
    <div className={`grid grid-cols-2 gap-2 ${compacto ? "" : "sm:gap-3"}`}>
      {opcoes.map((o) => {
        const ativo = valor === o.v;
        return (
          <button
            key={o.v}
            type="button"
            disabled={desabilitado}
            aria-pressed={ativo}
            onClick={() => aoMudar(o.v)}
            className={`toque flex items-center justify-center gap-2 rounded-xl border-2 font-bold transition disabled:opacity-50 ${
              compacto ? "px-2 py-2 text-xs" : "px-3 py-4 text-sm"
            } ${ativo ? o.ativo : "border-stone-200 bg-white text-stone-600 hover:border-stone-300"}`}
          >
            {o.icone}
            <span>{o.rotulo}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Marcador C / NC / — usado na grade do administrador e no relatório. */
export function Marcador({
  status,
  herdado = false,
}: {
  status: EntryStatus | null;
  herdado?: boolean;
}) {
  if (!status)
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-stone-100 text-stone-400">
        <Minus size={14} />
      </span>
    );
  if (status === "C")
    return (
      <span
        title="Conforme"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-conforme-500 font-bold text-white"
      >
        C
      </span>
    );
  return (
    <span
      title={herdado ? "Não conformidade herdada de um dia anterior" : "Não Conforme"}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg font-bold text-white ${
        herdado ? "bg-naoconforme-500/60 ring-1 ring-dashed ring-naoconforme-700" : "bg-naoconforme-500"
      }`}
    >
      NC
    </span>
  );
}

/** O estado de sincronização por item — o motorista precisa saber se a
 *  marcação já saiu do aparelho. */
export function IndicadorSync({ estado, className = "" }: { estado: SyncState; className?: string }) {
  const mapa: Record<SyncState, { icone: React.ReactNode; texto: string; cor: string }> = {
    sincronizado: {
      icone: <CheckCircle2 size={14} />,
      texto: "Salvo no servidor",
      cor: "text-conforme-700",
    },
    pendente: {
      icone: <CloudOff size={14} />,
      texto: "Salvo no aparelho, aguardando envio",
      cor: "text-stone-500",
    },
    enviando: {
      icone: <Loader2 size={14} className="animate-spin" />,
      texto: "Enviando…",
      cor: "text-marca-700",
    },
    falha: {
      icone: <AlertTriangle size={14} />,
      texto: "Falha ao enviar — tentando de novo",
      cor: "text-naoconforme-700",
    },
  };
  const m = mapa[estado];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.cor} ${className}`}>
      {m.icone}
      <span>{m.texto}</span>
    </span>
  );
}

export function BarraSync({
  online,
  pendentes,
  fotos,
  falhas,
  sincronizando,
  aoSincronizar,
}: {
  online: boolean;
  pendentes: number;
  fotos: number;
  falhas: number;
  sincronizando: boolean;
  aoSincronizar: () => void;
}) {
  if (online && pendentes === 0 && fotos === 0 && falhas === 0) return null;
  const tom = !online
    ? "bg-stone-800 text-stone-100"
    : falhas > 0
      ? "bg-naoconforme-50 text-naoconforme-700 border-b border-naoconforme-500/30"
      : "bg-atencao-50 text-atencao-700 border-b border-atencao-500/40";

  return (
    <div className={`no-print flex items-center justify-between gap-3 px-4 py-2 text-xs font-semibold ${tom}`}>
      <span className="flex items-center gap-2">
        {online ? <RefreshCw size={14} className={sincronizando ? "animate-spin" : ""} /> : <CloudOff size={14} />}
        {!online
          ? "Sem conexão — as marcações ficam salvas no aparelho"
          : falhas > 0
            ? `${falhas} registro(s) com falha de envio`
            : `${pendentes} marcação(ões)${fotos ? ` e ${fotos} foto(s)` : ""} na fila`}
      </span>
      {online && (
        <button onClick={aoSincronizar} className="toque rounded-lg px-2 py-1 underline">
          Enviar agora
        </button>
      )}
    </div>
  );
}
