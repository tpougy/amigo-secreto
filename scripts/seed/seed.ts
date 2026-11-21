// Seed idempotente: cria grupos, participantes e respostas de teste a partir de um JSON.
// Uso: bun scripts/seed/seed.ts <arquivo.json> [--app teste|prod]   (padrão: teste)
// Credenciais: .env da raiz (o Bun o carrega). Só ids e contagens vão para o log.
import { id, init, lookup } from "@instantdb/admin";
import { camposIniciais, perfilCompleto, validarResposta, type DefCampo } from "@amigo/dominio";
import schema from "@amigo/instant";
import { lerSeed, type Seed } from "./esquema";

export type Admin = ReturnType<typeof adminDe>;
export type Resumo = { grupos: number; participantes: number; respostas: number };

export function adminDe(app: "teste" | "prod") {
  const [idVar, tokenVar] =
    app === "prod" ? ["INSTANT_APP_ID", "INSTANT_ADMIN_TOKEN"] : ["INSTANT_TEST_APP_ID", "INSTANT_TEST_ADMIN_TOKEN"];
  const appId = process.env[idVar];
  const adminToken = process.env[tokenVar];
  const apiURI = process.env.INSTANT_API_URI;
  if (!appId || !adminToken || !apiURI) throw new Error(`variáveis ${idVar}, ${tokenVar} e INSTANT_API_URI são obrigatórias`);
  return init({ appId, adminToken, apiURI, schema });
}

async function usuarioId(db: Admin, email: string): Promise<string> {
  await db.auth.createToken({ email }); // cria o usuário se não existe
  const u = await db.auth.getUser({ email });
  if (!u) throw new Error("usuário não foi criado");
  return u.id;
}

/** Aplica o seed (já validado). Rodar de novo não duplica nada. */
export async function semear(db: Admin, seed: Seed): Promise<Resumo> {
  const resumo: Resumo = { grupos: 0, participantes: 0, respostas: 0 };
  for (const g of seed.grupos) {
    const orgId = await usuarioId(db, g.organizador);
    const { grupos } = await db.query({
      grupos: { $: { where: { codigo: g.codigo } }, campos: {}, participantes: {} },
    });
    const existente = grupos[0];
    const grupoId = existente?.id ?? id();
    const apelidoOrg =
      g.participantes.find((p) => p.email === g.organizador)?.apelido ?? g.organizador.split("@")[0]!.slice(0, 40);

    let campos = (existente?.campos ?? []).map((c) => ({ ...c, id: c.id }));
    if (!existente) {
      const modelos = camposIniciais(g.tema as never);
      campos = modelos.map((c, ordem) => ({ id: id(), ordem, ...c })) as never;
      await db.transact([
        db.tx.grupos[grupoId]!
          .create({
            titulo: g.titulo,
            tema: g.tema,
            codigo: g.codigo,
            status: "aberto",
            rodadaAtual: 0,
            criadoEm: Date.now(),
            organizadorApelido: apelidoOrg,
          })
          .link({ organizador: orgId }),
        ...modelos.map((c, ordem) =>
          db.tx.campos[campos[ordem]!.id]!
            .create({
              rotulo: c.rotulo,
              tipo: c.tipo,
              obrigatorio: c.obrigatorio,
              ordem,
              ...(c.ajuda ? { ajuda: c.ajuda } : {}),
              ...(c.opcoes ? { opcoes: c.opcoes } : {}),
            })
            .link({ grupo: grupoId }),
        ),
      ]);
    }
    resumo.grupos++;

    const defs: DefCampo[] = campos
      .map((c) => ({
        id: c.id,
        rotulo: c.rotulo,
        tipo: c.tipo as DefCampo["tipo"],
        obrigatorio: c.obrigatorio,
        ordem: c.ordem,
        ...(c.opcoes ? { opcoes: c.opcoes as string[] } : {}),
      }))
      .sort((a, b) => a.ordem - b.ordem);

    // O organizador também é participante (como no app), mesmo fora da lista.
    const pessoas = g.participantes.some((p) => p.email === g.organizador)
      ? g.participantes
      : [{ email: g.organizador, apelido: apelidoOrg, respostas: undefined }, ...g.participantes];
    const porChave = new Map((existente?.participantes ?? []).map((p) => [p.chave, p.id]));

    for (const p of pessoas) {
      const uid = await usuarioId(db, p.email);
      const chave = `${grupoId}:${uid}`;
      const pid = porChave.get(chave) ?? id();
      const brutas: Record<string, ValorResposta> = {};
      for (const [rotulo, valor] of Object.entries(p.respostas ?? {})) {
        const def = defs.find((d) => d.rotulo === rotulo);
        if (!def) throw new Error(`campo "${rotulo}" não existe no grupo ${g.codigo}`);
        const r = validarResposta(def, valor);
        if (!r.ok) throw new Error(`${rotulo}: ${r.erro}`);
        brutas[def.id] = r.valor;
      }
      const completo = perfilCompleto(defs, brutas);
      await db.transact([
        porChave.has(chave)
          ? db.tx.participantes[lookup("chave", chave)]!.update({ apelido: p.apelido, perfilCompleto: completo, removido: false })
          : db.tx.participantes[pid]!
              .create({ apelido: p.apelido, perfilCompleto: completo, removido: false, entrouEm: Date.now(), chave })
              .link({ grupo: grupoId, usuario: uid }),
        ...Object.entries(brutas).map(([campoId, valor]) =>
          db.tx.respostas[lookup("chave", `${pid}:${campoId}`)]!
            .update({ valor })
            .link({ participante: pid, campo: campoId }),
        ),
      ]);
      resumo.participantes++;
      resumo.respostas += Object.keys(brutas).length;
    }
  }
  return resumo;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--app");
  const app = i >= 0 ? args[i + 1] : "teste";
  const arquivo = args.find((a, k) => !a.startsWith("--") && (i < 0 || k !== i + 1));
  if (!arquivo || (app !== "teste" && app !== "prod")) {
    console.error("Uso: bun scripts/seed/seed.ts <arquivo.json> [--app teste|prod]");
    process.exit(2);
  }
  try {
    const seed = lerSeed(await Bun.file(arquivo).json());
    const r = await semear(adminDe(app), seed);
    console.log(`ok (${app}): ${r.grupos} grupo(s), ${r.participantes} participante(s), ${r.respostas} resposta(s)`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
