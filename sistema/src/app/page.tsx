"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app-provider";

/** Cada um cai na sua tela: o motorista na inspeção do dia, o
 *  administrador no painel. */
export default function Raiz() {
  const { estado, ehAdmin } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (estado !== "pronto") return;
    router.replace(ehAdmin ? "/painel" : "/hoje");
  }, [estado, ehAdmin, router]);

  return <p className="py-10 text-center text-sm text-stone-500">Abrindo…</p>;
}
