import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Inspeção de Frota — Gestão de Entregas",
    short_name: "Frota",
    description:
      "Check-list de inspeção dos caminhões da Gestão de Entregas. Funciona sem sinal.",
    // Abre direto na tela do dia: o motorista instala e o primeiro toque
    // já é a inspeção de hoje.
    start_url: "/hoje",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f4",
    theme_color: "#991b1b",
    lang: "pt-BR",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Inspeção de hoje", short_name: "Hoje", url: "/hoje" },
      { name: "Não conformidades", short_name: "Pendências", url: "/nao-conformidades" },
    ],
  };
}
