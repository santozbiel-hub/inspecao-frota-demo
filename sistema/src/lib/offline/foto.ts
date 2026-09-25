"use client";

import { supabase } from "@/lib/supabase/client";
import { BUCKET } from "./sync";

/**
 * Compressão de foto no próprio aparelho.
 *
 * A foto sai da câmera do celular com 3–8 MB. Subir isso pela rede do
 * pátio é o que trava a sincronização. Aqui ela vira JPEG de 150–250 KB
 * antes de entrar na fila — o suficiente para enxergar um pneu careca,
 * pequeno o bastante para subir num sinal ruim.
 */

export const ALVO_MIN_BYTES = 150 * 1024;
export const ALVO_MAX_BYTES = 250 * 1024;
export const TETO_BYTES = 1024 * 1024; // igual ao limite do bucket
export const LADO_MAXIMO = 1280;

export const TIPOS_ACEITOS = ["image/jpeg", "image/svg+xml", "image/webp", "image/heic", "image/heif"];

export class FotoInvalida extends Error {}

export async function comprimirFoto(arquivo: File | Blob): Promise<Blob> {
  const tipo = (arquivo as File).type || "";
  if (tipo && !TIPOS_ACEITOS.includes(tipo)) {
    throw new FotoInvalida(
      "Formato de imagem não aceito. Use uma foto da câmera ou da galeria.",
    );
  }
  if (arquivo.size > 25 * 1024 * 1024) {
    throw new FotoInvalida("Imagem grande demais (acima de 25 MB).");
  }

  const bitmap = await carregarBitmap(arquivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new FotoInvalida("Não foi possível processar a imagem neste aparelho.");
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  if ("close" in bitmap) (bitmap as ImageBitmap).close();

  // Desce a qualidade até entrar na faixa. Para quando já está pequena o
  // bastante — não adianta degradar mais uma foto que já cabe.
  let qualidade = 0.82;
  let saida = await paraBlob(canvas, qualidade);
  while (saida.size > ALVO_MAX_BYTES && qualidade > 0.35) {
    qualidade -= 0.1;
    saida = await paraBlob(canvas, qualidade);
  }

  if (saida.size > TETO_BYTES) {
    throw new FotoInvalida(
      "Não foi possível comprimir a foto o suficiente. Tente uma foto com menos detalhe.",
    );
  }
  return saida;
}

async function carregarBitmap(arquivo: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(arquivo);
    } catch {
      /* Safari antigo cai no caminho de baixo */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new FotoInvalida("Não foi possível ler a imagem."));
    };
    img.src = url;
  });
}

function paraBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new FotoInvalida("Falha ao gerar a imagem."))),
      "image/jpeg",
      qualidade,
    );
  });
}

export function formatarBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** O bucket é privado: a foto é exibida por uma URL assinada de curta duração. */
export async function obterUrlFoto(caminho: string): Promise<string> {
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUrl(caminho, 300);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Não foi possível gerar o link da foto.");
  }
  return data.signedUrl;
}
