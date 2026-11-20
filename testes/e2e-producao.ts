// E2E contra o app Instant de PRODUÇÃO, servido pelo `amigo-worker` no Dokku.
// Uso (da raiz, que tem o .env): bun testes/e2e-producao.ts  → exit 0 se tudo passar.
// Tudo o que cria leva o prefixo `e2e-<timestamp>` e é apagado no fim, passe ou falhe.
import { id, init } from "@instantdb/admin";
import schema from "../instant.schema";
import { camposIniciais, formatarCodigo, gerarCodigo, normalizarCodigo } from "@amigo/dominio";

const PRAZO_MS = 60_000;
const PREFIXO = `e2e-${Date.now()}`;

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`variável ${nome} ausente (veja .env.example)`);
  return v;
}

const admin = init({
  appId: exigir("INSTANT_APP_ID"),
  adminToken: exigir("INSTANT_ADMIN_TOKEN"),
  apiURI: exigir("INSTANT_API_URI"),
  schema,
});

type Usuario = { email: string; id: string; db: ReturnType<typeof admin.asUser> };

const t0 = Date.now();
const passo = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function confere(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`falhou: ${msg}`);
}

async function criarUsuario(n: number): Promise<Usuario> {
  const email = `${PREFIXO}-${n}@teste.amigo`;
  await admin.auth.createToken({ email });
  const u = await admin.auth.getUser({ email });
  confere(u, `usuário ${n} criado`);
  return { email, id: u.id, db: admin.asUser({ email }) };
}

/** Entra como a UI faz: normaliza o código digitado, acha o grupo pela prévia e cria o participante. */
async function entrarPorCodigo(u: Usuario, digitado: string, apelido: string): Promise<string> {
  const codigo = normalizarCodigo(digitado);
  confere(codigo, "código digitado é válido");
  const r = await u.db.query({ grupos: { $: { where: { codigo } } } }, { ruleParams: { codigo } });
  confere(r.grupos.length === 1, "prévia pelo código mostra exatamente 1 grupo");
  const grupoId = r.grupos[0]!.id;
  const participanteId = id();
  await u.db.transact(
    u.db.tx.participantes[participanteId]!
      .ruleParams({ codigo })
      .create({
        apelido,
        perfilCompleto: false,
        removido: false,
        entrouEm: Date.now(),
        chave: `${grupoId}:${u.id}`,
      })
      .link({ grupo: grupoId, usuario: u.id }),
  );
  return participanteId;
}

async function lerSorteio(sorteioId: string) {
  const r = await admin.query({ sorteios: { $: { where: { id: sorteioId } } } });
  return r.sorteios[0];
}

async function limpar(): Promise<void> {
  const { $users } = await admin.query({
    $users: { $: { where: { email: { $like: `${PREFIXO}-%` } } }, gruposOrganizados: {} },
  });
  const grupoIds = $users.flatMap((u) => u.gruposOrganizados.map((g) => g.id));
  if (grupoIds.length) await admin.transact(grupoIds.map((g) => admin.tx.grupos[g]!.delete()));
  for (const u of $users) await admin.auth.deleteUser({ id: u.id });
  passo(`limpeza: ${grupoIds.length} grupo(s), ${$users.length} usuário(s) apagados`);
}

/** Confere que não sobrou nada do prefixo nem dos ids criados. */
async function conferirLimpeza(grupoId: string | undefined, sorteioId: string | undefined, participantes: string[]) {
  const r = await admin.query({
    $users: { $: { where: { email: { $like: `${PREFIXO}-%` } } } },
    grupos: { $: { where: { id: grupoId ?? id() } } },
    sorteios: { $: { where: { id: sorteioId ?? id() } } },
    participantes: { $: { where: { id: { $in: participantes.length ? participantes : [id()] } } } },
    pares: { $: { where: { "sorteio.id": sorteioId ?? id() } } },
  });
  const sobras = {
    usuarios: r.$users.length,
    grupos: r.grupos.length,
    sorteios: r.sorteios.length,
    participantes: r.participantes.length,
    pares: r.pares.length,
  };
  passo(`sobras: ${JSON.stringify(sobras)}`);
  confere(Object.values(sobras).every((n) => n === 0), "nada sobrou depois da limpeza");
}

async function main(): Promise<void> {
  let grupoId: string | undefined;
  let sorteioId: string | undefined;
  const participantes: string[] = [];
  let falha: unknown;
  try {
    passo(`prefixo ${PREFIXO}`);
    // 1. organizador e 3 participantes
    const [org, ...outros] = await Promise.all([0, 1, 2, 3].map(criarUsuario));
    const usuarios = [org!, ...outros];
    passo(`1. ${usuarios.length} usuários criados (organizador + 3)`);

    // o organizador cria o grupo
    grupoId = id();
    const codigo = gerarCodigo();
    const [c1, c2] = camposIniciais("livro");
    await org!.db.transact([
      org!.db.tx.grupos[grupoId]!.create({
        titulo: `${PREFIXO} grupo`,
        tema: "livro",
        codigo,
        status: "aberto",
        rodadaAtual: 0,
        criadoEm: Date.now(),
      }).link({ organizador: org!.id }),
      ...[c1!, c2!].map((c) =>
        org!.db.tx.campos[id()]!.create({
          rotulo: c.rotulo,
          tipo: c.tipo,
          obrigatorio: c.obrigatorio,
          ordem: c.ordem,
          ...(c.opcoes ? { opcoes: c.opcoes } : {}),
        }).link({ grupo: grupoId }),
      ),
    ]);

    // 2. todos entram pelo código (digitado com ruído, como na UI)
    const digitado = formatarCodigo(codigo).toLowerCase();
    for (const [i, u] of usuarios.entries()) {
      participantes.push(await entrarPorCodigo(u, ` ${digitado} `, `e2e-${i}`));
    }
    passo(`2. ${participantes.length} participantes entraram pelo código`);

    // 3. o organizador pede o sorteio
    sorteioId = id();
    await org!.db.transact(
      org!.db.tx.sorteios[sorteioId]!
        .create({ status: "pendente", rodada: 1, chave: `${grupoId}:1`, criadoEm: Date.now() })
        .link({ grupo: grupoId }),
    );
    passo(`3. sorteio ${sorteioId} pedido`);

    // 4. espera `concluido` (o amigo-worker de produção é quem processa)
    const inicio = Date.now();
    let status = "";
    while (Date.now() - inicio < PRAZO_MS) {
      const s = await lerSorteio(sorteioId);
      if (s?.status !== status) passo(`   status: ${s?.status}`);
      status = s?.status ?? "";
      if (status !== "pendente" && status !== "processando") break;
      await dormir(500);
    }
    confere(status === "concluido", `sorteio concluído em até ${PRAZO_MS / 1000}s (status: ${status})`);
    passo(`4. concluido em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);

    // 5. cada um vê exatamente 1 par, o dele, e os receptores formam uma permutação
    const receptores = new Set<string>();
    for (const [i, u] of usuarios.entries()) {
      const r = await u.db.query({ pares: { doador: {}, receptor: {} } });
      confere(r.pares.length === 1, `usuário ${i} vê exatamente 1 par (viu ${r.pares.length})`);
      const p = r.pares[0]!;
      confere(p.doador?.id === participantes[i], `usuário ${i} é o doador do par que vê`);
      confere(p.receptor && p.receptor.id !== participantes[i], `usuário ${i} não tirou a si mesmo`);
      receptores.add(p.receptor.id);
    }
    confere(receptores.size === usuarios.length, "receptores distintos");
    passo("5. cada participante vê exatamente 1 par");
  } catch (e) {
    falha = e;
  }

  // 6. apaga tudo, passe ou falhe
  try {
    await limpar();
    await conferirLimpeza(grupoId, sorteioId, participantes);
    passo("6. limpeza conferida");
  } catch (e) {
    falha ??= e;
  }

  if (falha) {
    console.error(`E2E FALHOU: ${falha instanceof Error ? falha.message : String(falha)}`);
    process.exit(1);
  }
  passo("E2E OK");
  process.exit(0);
}

await main();
