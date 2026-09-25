import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProvider } from "@/components/app-provider";
import { Shell } from "@/components/shell";
import { RegistrarServiceWorker } from "@/components/registrar-sw";

export const metadata: Metadata = {
  title: "Inspeção de Frota — Gestão de Entregas",
  description:
    "Check-list de inspeção dos caminhões da Gestão de Entregas: registro diário, não conformidades e histórico.",
  applicationName: "Frota Gestão de Entregas",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Frota BP",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#991b1b",
  width: "device-width",
  initialScale: 1,
  // O motorista marca com o dedo; deixar o zoom livre evita prender quem
  // precisa aumentar o texto.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full">
        <AppProvider>
          <RegistrarServiceWorker />
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
