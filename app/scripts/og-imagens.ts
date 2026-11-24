// Gera as imagens de divulgação: prévias de link (Open Graph, 1200×630) em app/static/og/ e a
// arte de stories (1080×1920) em docs/divulgacao/. Roda à mão quando o visual ou os textos mudarem;
// os PNGs são versionados.
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
  // Cores próprias da landing (layout.css: --color-rosa, --color-lima, --color-ceu), em hex aproximado.
  rosa: "#f7a6cc",
  limaForte: "#c8f169",
  ceu: "#94d2f2",
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

/** Stories (1080×1920): o conteúdo da landing, com as faixas de cima e de baixo livres para a interface do app. */
/**
 * Pontinhos do fundo da landing (`bg-pontos`: 1,2 px a cada 22 px), na escala ~2× da arte.
 * Camada de bolinhas absolutas: o radial-gradient repetido não renderiza no satori.
 */
function pontos(largura: number, altura: number, passo = 44, raio = 2.4): No {
  const bolinhas: No[] = [];
  for (let y = passo / 2; y < altura; y += passo) {
    for (let x = passo / 2; x < largura; x += passo) {
      bolinhas.push(
        div({
          position: "absolute",
          left: x - raio,
          top: y - raio,
          width: raio * 2,
          height: raio * 2,
          borderRadius: raio,
          background: COR.tinta,
        }),
      );
    }
  }
  return div({ position: "absolute", left: 0, top: 0, width: largura, height: altura }, bolinhas);
}

function stories(): No {
  const passo = (n: number, cor: string, titulo: string, texto: string, rot: number) =>
    div(
      {
        alignItems: "center",
        width: 940,
        boxSizing: "border-box",
        gap: 28,
        padding: "22px 30px",
        background: COR.fundo,
        border: BORDA,
        borderRadius: 22,
        boxShadow: sombra(10),
        transform: `rotate(${rot}deg)`,
      },
      [
        div(
          {
            width: 96,
            height: 96,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            background: cor,
            border: BORDA,
            borderRadius: 16,
            fontSize: 60,
            fontWeight: 900,
          },
          String(n),
        ),
        div({ flexDirection: "column", width: 735, gap: 2 }, [
          div({ fontSize: 46, fontWeight: 900 }, titulo),
          div({ fontSize: 30, fontWeight: 400, lineHeight: 1.25 }, texto),
        ]),
      ],
    );
  return div(
    {
      width: 1080,
      height: 1920,
      flexDirection: "column",
      background: COR.fundo,
      position: "relative",
      color: COR.tinta,
      fontFamily: "DM Sans",
      paddingTop: 210,
      paddingBottom: 300,
      paddingLeft: 70,
      paddingRight: 70,
      gap: 48,
    },
    [
      pontos(1080, 1920),
      // Conteúdo: cada bloco tem posição própria para ficar acima da camada de pontos.
      // Cartão principal
      div(
        {
          flexDirection: "column",
          position: "relative",
          width: 940,
          boxSizing: "border-box",
          padding: "60px 50px 50px",
          background: COR.fundo,
          border: "8px solid #0a0a0a",
          borderRadius: 30,
          boxShadow: sombra(18),
          gap: 30,
        },
        [
          div(
            {
              position: "absolute",
              top: -34,
              right: 40,
              padding: "8px 22px",
              background: COR.rosa,
              border: BORDA,
              borderRadius: 12,
              boxShadow: sombra(5),
              fontSize: 34,
              fontWeight: 900,
              transform: "rotate(4deg)",
            },
            "SEM PAPELZINHO!",
          ),
          div({ fontSize: 108, fontWeight: 900, letterSpacing: -4, lineHeight: 0.95 }, "Amigo secreto"),
          div(
            {
              alignSelf: "flex-start",
              padding: "4px 26px 14px",
              background: COR.ambar,
              border: "8px solid #0a0a0a",
              borderRadius: 18,
              boxShadow: sombra(10),
              fontSize: 96,
              fontWeight: 900,
              letterSpacing: -4,
              lineHeight: 1,
              transform: "rotate(-2deg)",
            },
            "do jeito certo.",
          ),
          div(
            { fontSize: 36, fontWeight: 700, lineHeight: 1.3, marginTop: 10 },
            "Crie o grupo, chame a turma e deixe o sorteio com a gente: cada um descobre quem tirou e o que essa pessoa gosta de ganhar.",
          ),
        ],
      ),
      // Passos
      div({ position: "relative", flexDirection: "column", gap: 24 }, [
        passo(1, COR.ambar, "Crie o grupo", "Tema, datas e o que cada um deve contar sobre si.", -1),
        passo(2, COR.ceu, "Chame a turma", "Um código de 6 letras ou um QR Code.", 1),
        passo(3, COR.rosa, "Sorteie", "Cada um vê só quem tirou. Nem o organizador sabe os pares.", -1),
      ]),
      // Chamada final
      div({ position: "relative", flexDirection: "column", alignItems: "center", width: 940, gap: 20, marginTop: 10 }, [
        div({ fontSize: 40, fontWeight: 900 }, "Monte o do seu grupo em"),
        div(
          {
            padding: "18px 44px 24px",
            background: COR.ambar,
            border: "8px solid #0a0a0a",
            borderRadius: 24,
            boxShadow: sombra(14),
            fontSize: 76,
            fontWeight: 900,
            letterSpacing: -2,
          },
          "amigo.tpou.gy",
        ),
        div(
          {
            marginTop: 14,
            padding: "10px 24px",
            background: COR.limaForte,
            border: BORDA,
            borderRadius: 14,
            fontSize: 30,
            fontWeight: 700,
          },
          "Grátis, sem anúncios, dados guardados no Brasil.",
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

async function gerar(caminho: string, arvore: No, largura: number, altura: number) {
  const svg = await satori(arvore as never, { width: largura, height: altura, fonts: fontes });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: largura } }).render().asPng();
  writeFileSync(caminho, png);
  console.log(`${caminho.split("/").slice(-2).join("/")}: ${Math.round(png.length / 1024)} KB`);
}

const destino = fileURLToPath(new URL("../static/og/", import.meta.url));
mkdirSync(destino, { recursive: true });
for (const [nome, arvore] of [
  ["site", site()],
  ["convite", convite()],
] as const) {
  await gerar(`${destino}${nome}.png`, arvore, 1200, 630);
}

const divulgacao = fileURLToPath(new URL("../../docs/divulgacao/", import.meta.url));
mkdirSync(divulgacao, { recursive: true });
await gerar(`${divulgacao}stories.png`, stories(), 1080, 1920);
