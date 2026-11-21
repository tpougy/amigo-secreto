// "1.000 grupos": cria grupos no app de TESTE como admin, com o mesmo `gerarCodigo` e a mesma
// retentativa (até 5x em `record-not-unique`) da tela de criar, e confere que nenhuma colisão
// ficou sem tratamento. Também força uma colisão para provar que a retentativa funciona.
// Uso: bun scripts/colisao-codigos.ts [quantidade]   (o Bun carrega o .env da raiz)
import { id } from "@instantdb/admin";
import { gerarCodigo } from "@amigo/dominio";
import { adminTeste, tipoErro } from "@amigo/instant/teste";

const N = Number(process.argv[2] ?? 1000);
const MAX_TENTATIVAS = 5;
const TITULO = `colisao-${Date.now().toString(36)}`;
const admin = adminTeste();

let colisoes = 0;
let semTratamento = 0;

async function criar(gerar: () => string): Promise<string> {
  const grupoId = id();
  for (let t = 1; t <= MAX_TENTATIVAS; t++) {
    try {
      const codigo = gerar();
      await admin.transact(
        admin.tx.grupos[grupoId]!.create({
          titulo: TITULO,
          tema: "livre",
          codigo,
          status: "aberto",
          rodadaAtual: 0,
          criadoEm: Date.now(),
        }),
      );
      return grupoId;
    } catch (e) {
      if (tipoErro(e) === "record-not-unique") {
        colisoes++;
        if (t < MAX_TENTATIVAS) continue;
        semTratamento++;
      }
      throw e;
    }
  }
  throw new Error("inalcançável");
}

try {
  // 1. Colisão forçada: o gerador devolve o mesmo código duas vezes antes de um novo.
  const fixo = gerarCodigo();
  await criar(() => fixo);
  const sequencia = [fixo, fixo, gerarCodigo()];
  const antes = colisoes;
  await criar(() => sequencia.shift() ?? gerarCodigo());
  if (colisoes - antes !== 2) throw new Error(`esperava 2 colisões forçadas, vi ${colisoes - antes}`);
  console.log("colisão forçada: 2 colisões, resolvidas na 3ª tentativa");

  // 2. N grupos, 20 por vez.
  let feitos = 0;
  const fila = Array.from({ length: N }, (_, i) => i);
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      while (fila.length) {
        fila.pop();
        await criar(gerarCodigo);
        feitos++;
      }
    }),
  );

  const { grupos } = await admin.query({ grupos: { $: { where: { titulo: TITULO } } } });
  const unicos = new Set(grupos.map((g) => g.codigo));
  console.log(`criados: ${feitos} (+2 do teste forçado); no banco: ${grupos.length}; códigos únicos: ${unicos.size}`);
  console.log(`colisões espontâneas tratadas: ${colisoes - 2}; sem tratamento: ${semTratamento}`);
  if (unicos.size !== grupos.length || grupos.length !== feitos + 2 || semTratamento) {
    throw new Error("falhou: código duplicado ou colisão sem tratamento");
  }
} finally {
  const { grupos } = await admin.query({ grupos: { $: { where: { titulo: TITULO } } } });
  for (let i = 0; i < grupos.length; i += 100) {
    await admin.transact(grupos.slice(i, i + 100).map((g) => admin.tx.grupos[g.id]!.delete()));
  }
  console.log(`limpeza: ${grupos.length} grupos removidos`);
}
