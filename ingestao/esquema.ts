// Formato do JSON de seed, validado ANTES de qualquer escrita.
import { z } from "zod";
import { camposIniciais, normalizarCodigo, TEMAS, validarResposta, type DefCampo } from "@amigo/dominio";

const email = z.email("E-mail inválido");

const Participante = z.object({
  email,
  apelido: z.string().trim().min(1, "Apelido vazio").max(40, "Apelido com mais de 40 caracteres"),
  respostas: z.record(z.string(), z.unknown()).optional(),
});

const Grupo = z
  .object({
    codigo: z.string().refine((c) => normalizarCodigo(c) === c, "Código inválido (6 caracteres do alfabeto, em maiúsculas)"),
    titulo: z.string().trim().min(3, "Título curto demais").max(80, "Título com mais de 80 caracteres"),
    tema: z.enum(TEMAS.map((t) => t.id) as [string, ...string[]], "Tema inexistente"),
    organizador: email,
    participantes: z.array(Participante),
  })
  .superRefine((g, ctx) => {
    const campos = camposIniciais(g.tema as never).map((c, ordem) => ({ id: c.rotulo, ...c, ordem }) as DefCampo);
    g.participantes.forEach((p, i) => {
      for (const [rotulo, valor] of Object.entries(p.respostas ?? {})) {
        const campo = campos.find((c) => c.rotulo === rotulo);
        const caminho = ["participantes", i, "respostas", rotulo];
        if (!campo) {
          ctx.addIssue({ code: "custom", path: caminho, message: `Campo inexistente no tema "${g.tema}"` });
          continue;
        }
        const r = validarResposta(campo, valor);
        if (!r.ok) ctx.addIssue({ code: "custom", path: caminho, message: r.erro });
      }
    });
  });

export const Seed = z.object({ grupos: z.array(Grupo).min(1, "Nenhum grupo") });
export type Seed = z.infer<typeof Seed>;

/** Valida e devolve o seed; em erro lança com mensagens `caminho: mensagem`. */
export function lerSeed(bruto: unknown): Seed {
  const r = Seed.safeParse(bruto);
  if (r.success) return r.data;
  const linhas = r.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`);
  throw new Error(`Seed inválido:\n${linhas.join("\n")}`);
}
