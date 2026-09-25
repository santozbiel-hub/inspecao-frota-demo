"use client";

import { useEffect } from "react";
import { agendarSincronizacao } from "@/lib/offline/sync";

/** Registra o service worker que faz o app abrir sem sinal. */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") return; // em dev atrapalha o hot reload

    const registrar = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((e) => console.warn("Service worker não registrado:", e));
    };

    if (document.readyState === "complete") registrar();
    else window.addEventListener("load", registrar);

    const aoReceber = (e: MessageEvent) => {
      if (e.data === "sincronizar") agendarSincronizacao(0);
    };
    navigator.serviceWorker.addEventListener("message", aoReceber);

    return () => {
      window.removeEventListener("load", registrar);
      navigator.serviceWorker.removeEventListener("message", aoReceber);
    };
  }, []);

  return null;
}
