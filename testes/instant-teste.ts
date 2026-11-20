// Utilitários dos testes de integração. Usam SEMPRE o app de teste (amigo-secreto-teste).
// Credenciais vêm do .env da raiz: o Bun o carrega sozinho quando roda da raiz
// (`bun test testes/...`); o script `test` deste pacote passa `--env-file=../.env`.
import { id, init } from "@instantdb/admin";
import { init as initCliente } from "@instantdb/core";
import schema from "../instant.schema";
import { camposIniciais, gerarCodigo, type Par } from "@amigo/dominio";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`variável ${nome} ausente (veja .env.example)`);
  return v;
}

export function adminTeste() {
  return init({
    appId: exigir("INSTANT_TEST_APP_ID"),
    adminToken: exigir("INSTANT_TEST_ADMIN_TOKEN"),
    apiURI: exigir("INSTANT_API_URI"),
    schema,
  });
}

/** Admin sem schema: para entidades de sistema fora do schema do app (ex.: `$streams`). */
export function adminTesteSemSchema() {
  return init({
    appId: exigir("INSTANT_TEST_APP_ID"),
    adminToken: exigir("INSTANT_TEST_ADMIN_TOKEN"),
    apiURI: exigir("INSTANT_API_URI"),
  });
}

/** Espera `cond` ficar verdadeira (o `transact` do core fora do navegador volta "enqueued"). */
export async function esperarAte(cond: () => Promise<boolean>, prazoMs = 5000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < prazoMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`condição não ficou verdadeira em ${prazoMs} ms`);
}

export type Admin = ReturnType<typeof adminTeste>;
export type AdminComo = ReturnType<Admin["asUser"]>;
export type Usuario = { email: string; id: string; db: AdminComo };

let _admin: Admin | undefined;
function admin(): Admin {
  return (_admin ??= adminTeste());
}

/** Prefixo único por execução, para isolar os dados de cada rodada de testes. */
export function novoPrefixo(nome: string): string {
  return `t${Date.now().toString(36)}-${nome}`;
}

export async function criarUsuario(prefixo: string): Promise<Usuario> {
  const email = `${prefixo}-${crypto.randomUUID()}@teste.amigo`;
  await admin().auth.createToken({ email });
  const u = await admin().auth.getUser({ email });
  if (!u) throw new Error("usuário de teste não foi criado");
  return { email, id: u.id, db: admin().asUser({ email }) };
}

export type OpcoesGrupo = {
  titulo?: string;
  status?: "aberto" | "sorteado" | "encerrado";
  /** Se o organizador também entra como participante. */
  organizadorParticipa?: boolean;
};

/**
 * Cria o grupo COMO o organizador (não como admin), com 2 campos do tema `livro`.
 * O título leva o prefixo do org (e-mail), para a limpeza achar o grupo.
 * Se `status` != aberto, o admin muda o status depois (simula o worker).
 */
export async function criarGrupoTeste(
  org: Usuario,
  opcoes: OpcoesGrupo = {},
): Promise<{ grupoId: string; codigo: string }> {
  const grupoId = id();
  const codigo = gerarCodigo();
  const [c1, c2] = camposIniciais("livro");
  const passos = [
    org.db.tx.grupos[grupoId]!.create({
      titulo: opcoes.titulo ?? `Grupo de ${org.email}`,
      tema: "livro",
      codigo,
      status: "aberto",
      rodadaAtual: 0,
      criadoEm: Date.now(),
    }).link({ organizador: org.id }),
    ...[c1!, c2!].map((c) =>
      org.db.tx.campos[id()]!.create({
        rotulo: c.rotulo,
        tipo: c.tipo,
        obrigatorio: c.obrigatorio,
        ordem: c.ordem,
        ...(c.opcoes ? { opcoes: c.opcoes } : {}),
      }).link({ grupo: grupoId }),
    ),
  ];
  await org.db.transact(passos);
  if (opcoes.organizadorParticipa) await entrar(org, grupoId, codigo);
  if (opcoes.status && opcoes.status !== "aberto") {
    await admin().transact(admin().tx.grupos[grupoId]!.update({ status: opcoes.status }));
  }
  return { grupoId, codigo };
}

/** O usuário entra no grupo com o código informado. Devolve o id do participante. */
export async function entrar(usuario: Usuario, grupoId: string, codigo: string): Promise<string> {
  const participanteId = id();
  await usuario.db.transact(
    usuario.db.tx.participantes[participanteId]!
      .ruleParams({ codigo })
      .create({
        apelido: usuario.email.split("@")[0]!,
        perfilCompleto: false,
        removido: false,
        entrouEm: Date.now(),
        chave: `${grupoId}:${usuario.id}`,
      })
      .link({ grupo: grupoId, usuario: usuario.id }),
  );
  return participanteId;
}

/**
 * Faz, como admin, o que o worker fará (Task 7) ao concluir um sorteio:
 * apaga os pares anteriores do grupo (`pares.doador`/`receptor` são one-to-one, então cada
 * participante só pode estar em um par por vez), grava os novos, marca o sorteio `concluido`
 * e o grupo `sorteado` com `rodadaAtual` = rodada do sorteio.
 * `pares` usa ids de participantes.
 */
export async function simularWorker(a: Admin, sorteioId: string, pares: Par[]): Promise<void> {
  const { sorteios } = await a.query({
    sorteios: { $: { where: { id: sorteioId } }, grupo: {} },
  });
  const sorteio = sorteios[0];
  const grupoId = sorteio?.grupo?.id;
  if (!sorteio || !grupoId) throw new Error("sorteio sem grupo");
  const { pares: antigos } = await a.query({
    pares: { $: { where: { "sorteio.grupo.id": grupoId } } },
  });
  if (antigos.length) await a.transact(antigos.map((p) => a.tx.pares[p.id]!.delete()));
  await a.transact([
    ...pares.map((p) =>
      a.tx.pares[id()]!
        .create({ chave: `${sorteioId}:${p.doador}` })
        .link({ sorteio: sorteioId, doador: p.doador, receptor: p.receptor }),
    ),
    a.tx.grupos[grupoId]!.update({ status: "sorteado", rodadaAtual: sorteio.rodada }),
    a.tx.sorteios[sorteioId]!.update({ status: "concluido", concluidoEm: Date.now() }),
  ]);
}

/** Apaga (via admin) os grupos dos organizadores do prefixo e os usuários do prefixo. */
export async function limparTudo(prefixo: string): Promise<void> {
  const a = admin();
  const { $users } = await a.query({
    $users: { $: { where: { email: { $like: `${prefixo}-%` } } }, gruposOrganizados: {} },
  });
  const grupoIds = $users.flatMap((u) => u.gruposOrganizados.map((g) => g.id));
  if (grupoIds.length) {
    await a.transact(grupoIds.map((g) => a.tx.grupos[g]!.delete()));
  }
  for (const u of $users) {
    await a.auth.deleteUser({ id: u.id });
  }
}

/** Executa e devolve o erro lançado (ou falha se não lançar). */
export async function erroDe(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("esperava erro, mas a operação deu certo");
}

/** Tipo do erro do Instant (`permission-denied`, `record-not-unique`, `rate-limited`, ...). */
export function tipoErro(e: unknown): string | undefined {
  const b = (e as { body?: { type?: string } })?.body;
  return b?.type;
}

export type Cliente = ReturnType<typeof initCliente<typeof schema>>;

/**
 * Roda `fn` com o SDK cliente (`@instantdb/core`), logado como o usuário: o mesmo caminho do
 * navegador (regras, upload de arquivo, streams). O core só liga fora do navegador se achar um
 * `window`; o storage é em memória e a rede é sempre "online". Tudo é desfeito ao final.
 */
export async function comoCliente<T>(u: Usuario, fn: (db: Cliente) => Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const tinhaWindow = "window" in g;
  if (!tinhaWindow) g.window = globalThis;
  class Memoria {
    m = new Map<string, unknown>();
    constructor(_appId: string, _dbName: string) {}
    async getItem(k: string) {
      return this.m.get(k) ?? null;
    }
    async setItem(k: string, v: unknown) {
      this.m.set(k, v);
    }
    async getAllKeys() {
      return [...this.m.keys()];
    }
    async multiSet(kv: [string, unknown][]) {
      for (const [k, v] of kv) this.m.set(k, v);
    }
    async removeItem(k: string) {
      this.m.delete(k);
    }
  }
  const SempreOnline = { getIsOnline: async () => true, listen: () => () => {} };
  const db = initCliente(
    {
      appId: exigir("INSTANT_TEST_APP_ID"),
      apiURI: exigir("INSTANT_API_URI"),
      websocketURI: "wss://instant.tpou.gy/runtime/session",
      schema,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Memoria as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SempreOnline as any,
  );
  try {
    const token = await admin().auth.createToken({ email: u.email });
    await db.auth.signInWithToken(token);
    return await fn(db);
  } finally {
    db.shutdown();
    if (!tinhaWindow) delete g.window;
  }
}
