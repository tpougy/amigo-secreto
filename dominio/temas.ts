import type { DefCampo } from "./campos";

type CampoModelo = Omit<DefCampo, "id">;

export type Tema = {
  id: "livro" | "livre" | "vinho" | "personalizado";
  nome: string;
  descricao: string;
  campos: CampoModelo[];
};

export const TEMAS: Tema[] = [
  {
    id: "livro",
    nome: "Livro",
    descricao: "Amigo secreto de livros: gostos de leitura e o que já está na estante.",
    campos: [
      { rotulo: "Livros que li recentemente", tipo: "lista", obrigatorio: false, ordem: 1 },
      {
        rotulo: "Gêneros que mais gosto",
        tipo: "multipla",
        opcoes: ["fantasia", "romance", "suspense", "não ficção", "clássicos", "poesia", "infantil", "biografia"],
        obrigatorio: true,
        ordem: 2,
      },
      { rotulo: "Livros que já tenho / não quero ganhar", tipo: "lista", obrigatorio: false, ordem: 3 },
      { rotulo: "Observações para quem me tirar", tipo: "texto-longo", obrigatorio: false, ordem: 4 },
    ],
  },
  {
    id: "livre",
    nome: "Livre",
    descricao: "Para qualquer tipo de presente: gostos e lista de desejos.",
    campos: [
      { rotulo: "Do que eu gosto", tipo: "texto-longo", obrigatorio: true, ordem: 1 },
      { rotulo: "Lista de desejos", tipo: "lista", obrigatorio: false, ordem: 2 },
    ],
  },
  {
    id: "vinho",
    nome: "Vinho",
    descricao: "Amigo secreto de vinhos: estilos, uvas e regiões favoritas.",
    campos: [
      {
        rotulo: "Tipos de vinho que prefiro",
        tipo: "multipla",
        opcoes: ["tinto", "branco", "rosé", "espumante", "sobremesa"],
        obrigatorio: true,
        ordem: 1,
      },
      { rotulo: "Uvas ou regiões favoritas", tipo: "lista", obrigatorio: false, ordem: 2 },
      { rotulo: "Observações", tipo: "texto-longo", obrigatorio: false, ordem: 3 },
    ],
  },
  {
    id: "personalizado",
    nome: "Personalizado",
    descricao: "Comece do zero e monte os seus próprios campos.",
    campos: [],
  },
];

/** Cópia profunda dos campos do tema, para o organizador editar à vontade. */
export function camposIniciais(temaId: Tema["id"]): CampoModelo[] {
  const tema = TEMAS.find((t) => t.id === temaId);
  return (tema?.campos ?? []).map((c) => ({ ...c, ...(c.opcoes ? { opcoes: [...c.opcoes] } : {}) }));
}
