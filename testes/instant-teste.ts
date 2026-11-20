// Utilitários dos testes de integração. Usam SEMPRE o app de teste (amigo-secreto-teste).
// Credenciais vêm do .env da raiz: o Bun o carrega sozinho quando roda da raiz
// (`bun test testes/...`); o script `test` deste pacote passa `--env-file=../.env`.
import { id, init } from "@instantdb/admin";
import schema from "../instant.schema";
import { camposIniciais, gerarCodigo } from "@amigo/dominio";

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
