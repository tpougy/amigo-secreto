// Gera as imagens de prévia de link (Open Graph, 1200×630) em app/static/og/.
// Roda uma vez, à mão, quando o visual ou os textos mudarem; os PNGs são versionados.
// Uso (de app/): bun scripts/og-imagens.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const fonte = (peso: number) =>
  readFileSync(fileURLToPath(import.meta.resolve(`@fontsource/dm-sans/files/dm-sans-latin-${peso}-normal.woff`)));

// Cores do tema (app/src/routes/layout.css): fundo creme, tinta quase preta, âmbar e azul.
const COR = {
  fundo: "#f7f0df",
  tinta: "#0a0a0a",
  ambar: "#fbbf24",
  azul: "#bfdbfe",
  laranja: "#fed7aa",
  lima: "#d9f99d",
  branco: "#ffffff",
};
const BORDA = `6px solid ${COR.tinta}`;
const sombra = (n: number) => `${n}px ${n}px 0 ${COR.tinta}`;

type No = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const div = (style: Record<string, unknown>, children?: unknown): No => ({
  type: "div",
  props: { style: { display: "flex", ...style }, children },
});

/** Caixa de presente desenhada com blocos (tampa, caixa e fita). */
function presente(tamanho: number, cor: string, fita: string): No {
  const largura = tamanho;
  const alturaCaixa = tamanho * 0.72;
  const alturaTampa = tamanho * 0.24;
  const fitaLarg = tamanho * 0.16;
  return div({ flexDirection: "column", alignItems: "center", position: "relative", width: largura + 24 }, [
    // laço
    div({ gap: 6, marginBottom: -6 }, [
      div({ width: tamanho * 0.26, height: tamanho * 0.2, border: BORDA, borderRadius: "50% 50% 8px 50%", background: fita }),
      div({ width: tamanho * 0.26, height: tamanho * 0.2, border: BORDA, borderRadius: "50% 50% 50% 8px", background: fita }),
    ]),
    // tampa
    div(
      {
        width: largura + 24,
        height: alturaTampa,
        border: BORDA,
        borderRadius: 10,
        background: cor,
        justifyContent: "center",
        boxShadow: sombra(10),
      },
      [div({ width: fitaLarg, height: "100%", background: fita, borderLeft: BORDA, borderRight: BORDA })],
    ),
    // caixa
    div(
      {
        width: largura,
        height: alturaCaixa,
        marginTop: -6,
        border: BORDA,
        borderRadius: "0 0 10px 10px",
        background: cor,
        justifyContent: "center",
        boxShadow: sombra(10),
      },
      [div({ width: fitaLarg, height: "100%", background: fita, borderLeft: BORDA, borderRight: BORDA })],
    ),
  ]);
}

const etiqueta = (texto: string, cor: string, rot = 0) =>
  div(
    {
      padding: "10px 24px",
      border: BORDA,
      borderRadius: 14,
      background: cor,
      fontSize: 34,
      fontWeight: 700,
      boxShadow: sombra(6),
      transform: `rotate(${rot}deg)`,
    },
    texto,
  );

function site(): No {
  return div(
    {
      width: 1200,
      height: 630,
      background: COR.fundo,
      color: COR.tinta,
      fontFamily: "DM Sans",
      padding: 56,
      alignItems: "center",
      gap: 56,
      position: "relative",
    },
    [
      div({ flexDirection: "column", width: 730, gap: 28 }, [
        div(
          {
            alignSelf: "flex-start",
            padding: "8px 30px 14px",
            background: COR.ambar,
            border: BORDA,
            borderRadius: 20,
            boxShadow: sombra(14),
            fontSize: 88,
            fontWeight: 900,
            letterSpacing: -3,
            lineHeight: 1.05,
            transform: "rotate(-2deg)",
          },
          "Amigo Secreto",
        ),
        div(
          { fontSize: 42, fontWeight: 700, lineHeight: 1.25, width: 680, marginTop: 12 },
          "Sorteio, perfis de gostos e dicas de presente para o seu grupo.",
        ),
        div({ gap: 18, marginTop: 8 }, [
          etiqueta("sorteio", COR.azul, -2),
          etiqueta("perfis", COR.laranja, 1),
          etiqueta("dicas", COR.lima, -1),
        ]),
      ]),
      div({ width: 300, justifyContent: "center", marginBottom: 30, transform: "rotate(6deg)" }, [presente(230, COR.azul, COR.ambar)]),
    ],
  );
}

function convite(): No {
  return div(
    {
      width: 1200,
      height: 630,
      background: COR.azul,
      color: COR.tinta,
      fontFamily: "DM Sans",
      padding: 56,
      alignItems: "center",
      gap: 48,
      position: "relative",
    },
    [
      div({ width: 270, justifyContent: "center", transform: "rotate(-7deg)" }, [presente(210, COR.ambar, COR.laranja)]),
      div({ flexDirection: "column", width: 760, gap: 26 }, [
        div(
          {
            alignSelf: "flex-start",
            padding: "6px 22px",
            background: COR.lima,
            border: BORDA,
            borderRadius: 12,
            boxShadow: sombra(6),
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 2,
            transform: "rotate(-3deg)",
          },
          "CONVITE",
        ),
        div(
          {
            padding: "18px 30px 24px",
            background: COR.branco,
            border: BORDA,
            borderRadius: 22,
            boxShadow: sombra(14),
            fontSize: 62,
            fontWeight: 900,
            letterSpacing: -2,
            lineHeight: 1.06,
          },
          "Você foi convidado para um amigo secreto!",
        ),
        div(
          { fontSize: 32, fontWeight: 700, lineHeight: 1.25, width: 760, marginTop: 6 },
          "Toque para entrar no grupo e montar seu perfil.",
        ),
      ]),
    ],
  );
}

const fontes = [400, 700, 900].map((peso) => ({
  name: "DM Sans",
  data: fonte(peso),
  weight: peso as 400 | 700 | 900,
  style: "normal" as const,
}));

const destino = fileURLToPath(new URL("../static/og/", import.meta.url));
mkdirSync(destino, { recursive: true });
for (const [nome, arvore] of [
  ["site", site()],
  ["convite", convite()],
] as const) {
  const svg = await satori(arvore as never, { width: 1200, height: 630, fonts: fontes });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  writeFileSync(`${destino}${nome}.png`, png);
  console.log(`${nome}.png: ${Math.round(png.length / 1024)} KB`);
}
