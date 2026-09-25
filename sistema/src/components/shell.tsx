"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  CalendarRange,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Truck,
  Users,
} from "lucide-react";
import { useApp } from "./app-provider";
import { BarraSync } from "./ui";
import { TelaDefinirPin, TelaLogin, TelaPin } from "./telas-entrada";

const ITENS_NAV = [
  { href: "/hoje", rotulo: "Hoje", icone: ClipboardCheck, papel: "todos" },
  { href: "/painel", rotulo: "Painel", icone: LayoutDashboard, papel: "todos" },
  { href: "/grade", rotulo: "Grade", icone: CalendarRange, papel: "todos" },
  { href: "/nao-conformidades", rotulo: "Pendências", icone: AlertTriangle, papel: "todos" },
  { href: "/veiculos", rotulo: "Veículos", icone: Truck, papel: "admin" },
  { href: "/usuarios", rotulo: "Usuários", icone: Users, papel: "admin" },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const { estado, perfil, ehAdmin, fila, sincronizarAgora, sair } = useApp();
  const caminho = usePathname();

  if (estado === "carregando") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100">
        <div className="flex flex-col items-center gap-3 text-stone-500">
          <div className="h-12 w-12 animate-pulse rounded-2xl bg-marca-800" />
          <p className="text-sm">Abrindo…</p>
        </div>
      </div>
    );
  }
  if (estado === "login") return <TelaLogin />;
  if (estado === "definir-pin") return <TelaDefinirPin />;
  if (estado === "pin") return <TelaPin />;

  const visiveis = ITENS_NAV.filter((i) => i.papel === "todos" || ehAdmin);
  const ativo = (href: string) => caminho === href || caminho.startsWith(`${href}/`);

  return (
    <div className="raiz-app min-h-screen bg-stone-100">
      <header className="topo sticky top-0 z-40 border-b-4 border-marca-400 bg-marca-800">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-marca-400">
            <Truck size={18} className="text-marca-900" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-marca-400">
              Inspeção de frota
            </p>
            <p className="truncate text-sm font-black uppercase tracking-tight text-white">
              Gestão de Entregas
            </p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="truncate text-xs font-semibold text-white">{perfil?.name ?? "—"}</p>
            <p className="text-[10px] uppercase tracking-wide text-marca-400">
              {ehAdmin ? "Administrador" : "Responsável pela inspeção"}
            </p>
          </div>
          <button
            onClick={() => void sair()}
            aria-label="Sair"
            className="toque rounded-lg p-2 text-marca-400 hover:bg-marca-900"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <BarraSync
        online={fila.online}
        pendentes={fila.entradasPendentes + fila.observacoesPendentes}
        fotos={fila.fotosPendentes}
        falhas={fila.falhas}
        sincronizando={fila.sincronizando}
        aoSincronizar={() => void sincronizarAgora()}
      />

      <div className="area-app mx-auto flex max-w-6xl gap-6 px-4 py-5">
        <nav className="barra-lateral hidden w-52 shrink-0 md:block">
          <ul className="sticky top-24 space-y-1">
            {visiveis.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  className={`toque flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    ativo(i.href)
                      ? "bg-marca-50 text-stone-900 ring-1 ring-marca-400"
                      : "text-stone-600 hover:bg-white"
                  }`}
                >
                  <i.icone size={18} />
                  {i.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="area-conteudo min-w-0 flex-1 pb-24 md:pb-6">{children}</main>
      </div>

      {/* Navegação de polegar no celular. */}
      <nav className="rodape-nav fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur md:hidden">
        <ul
          className="mx-auto grid max-w-6xl"
          style={{ gridTemplateColumns: `repeat(${visiveis.length}, minmax(0, 1fr))` }}
        >
          {visiveis.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                className={`toque flex flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-bold ${
                  ativo(i.href) ? "text-marca-800" : "text-stone-500"
                }`}
              >
                <i.icone size={20} />
                <span className="truncate">{i.rotulo}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
