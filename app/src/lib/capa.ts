// Capa do grupo: compressão no navegador (canvas → JPEG) e leitura do link `grupos.capa`.
// As partes puras são testadas em capa.test.ts; `comprimirCapa` precisa de DOM (canvas).
export { caminhoCapa } from "@amigo/dominio";

/** Lado maior da capa, em pixels. */
export const LADO_MAXIMO = 1600;
/** Teto do arquivo enviado: mira 300–500 KB. */
export const TETO_BYTES = 500 * 1024;
/** Qualidades JPEG tentadas em ordem até caber no teto. */
export const QUALIDADES = [0.8, 0.7, 0.6, 0.5] as const;

/** Reduz para o lado maior caber em `max`, mantendo a proporção (nunca amplia). */
export function dimensoesAlvo(largura: number, altura: number, max = LADO_MAXIMO): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (maior <= max) return { largura, altura };
  const f = max / maior;
  return { largura: Math.max(1, Math.round(largura * f)), altura: Math.max(1, Math.round(altura * f)) };
}

/**
 * URL da capa a partir do link `capa` da consulta. Quando a regra esconde o arquivo, o
 * instantdb-rust devolve só o id (string) no lugar do objeto: sem URL.
 */
export function urlCapa(capa: unknown): string | null {
  if (!capa || typeof capa !== "object") return null;
  const url = (capa as { url?: unknown }).url;
  return typeof url === "string" && url ? url : null;
}

export class ErroImagem extends Error {}

async function decodificar(arquivo: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // `from-image` respeita a orientação EXIF (foto de celular "deitada").
    return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(arquivo);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new ErroImagem("Não deu para ler esta imagem. Tente uma foto em JPEG ou PNG.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function paraJpeg(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob> {
  return new Promise((ok, falha) =>
    canvas.toBlob((b) => (b ? ok(b) : falha(new ErroImagem("Não deu para comprimir a imagem."))), "image/jpeg", qualidade),
  );
}

/**
 * Lado maior de 1.600 px e JPEG com qualidade 0,8; se passar de 500 KB, baixa a qualidade
 * (0,7 → 0,5) e, em último caso, o tamanho (75% por vez).
 */
export async function comprimirCapa(arquivo: Blob): Promise<Blob> {
  if (!arquivo.type.startsWith("image/")) throw new ErroImagem("Escolha um arquivo de imagem.");
  const img = await decodificar(arquivo);
  const larguraOrig = "naturalWidth" in img ? img.naturalWidth : img.width;
  const alturaOrig = "naturalHeight" in img ? img.naturalHeight : img.height;
  let max = LADO_MAXIMO;
  try {
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const { largura, altura } = dimensoesAlvo(larguraOrig, alturaOrig, max);
      const canvas = document.createElement("canvas");
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ErroImagem("Seu navegador não conseguiu processar a imagem.");
      ctx.fillStyle = "#fff"; // PNG com transparência vira fundo branco, não preto
      ctx.fillRect(0, 0, largura, altura);
      ctx.drawImage(img, 0, 0, largura, altura);
      for (const q of QUALIDADES) {
        const blob = await paraJpeg(canvas, q);
        if (blob.size <= TETO_BYTES) return blob;
      }
      max = Math.round(max * 0.75);
    }
    throw new ErroImagem("A imagem ficou grande demais mesmo comprimida.");
  } finally {
    if ("close" in img) img.close();
  }
}
