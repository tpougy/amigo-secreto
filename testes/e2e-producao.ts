// E2E contra o app Instant de PRODUÇÃO, servido pelo `amigo-worker` no Dokku.
// Uso (da raiz, que tem o .env): bun testes/e2e-producao.ts  → exit 0 se tudo passar.
// Tudo o que cria leva o prefixo `e2e-<timestamp>` e é apagado no fim, passe ou falhe.
// Fluxo: 4 pessoas entram e sorteiam; o organizador reabre o grupo, um retardatário entra pelo
// código e a rodada 2 é sorteada com os 5.
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

async function lerStatus(entidade: "sorteios" | "reaberturas", alvoId: string): Promise<string> {
  const onde = { $: { where: { id: alvoId } } };
  const r =
    entidade === "sorteios"
      ? (await admin.query({ sorteios: onde })).sorteios
      : (await admin.query({ reaberturas: onde })).reaberturas;
  return r[0]?.status ?? "";
}

/** Espera o worker de produção tirar o pedido de `pendente`/`processando`; devolve o status final. */
async function esperarWorker(entidade: "sorteios" | "reaberturas", alvoId: string): Promise<string> {
  const inicio = Date.now();
  let status = "";
  while (Date.now() - inicio < PRAZO_MS) {
    const s = await lerStatus(entidade, alvoId);
    if (s !== status) passo(`   ${entidade}: ${s}`);
    status = s;
    if (status !== "pendente" && status !== "processando") break;
    await dormir(500);
  }
  passo(`   em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  return status;
}

/** Cada usuário vê exatamente 1 par, o dele, e os receptores formam uma permutação. */
async function conferirPares(usuarios: Usuario[], participantes: string[], rodada: number): Promise<void> {
  const receptores = new Set<string>();
  for (const [i, u] of usuarios.entries()) {
    const r = await u.db.query({ pares: { doador: {}, receptor: {}, sorteio: {} } });
    confere(r.pares.length === 1, `usuário ${i} vê exatamente 1 par (viu ${r.pares.length})`);
    const p = r.pares[0]!;
    confere(p.doador?.id === participantes[i], `usuário ${i} é o doador do par que vê`);
    confere(p.receptor && p.receptor.id !== participantes[i], `usuário ${i} não tirou a si mesmo`);
    confere(p.sorteio?.rodada === rodada, `usuário ${i} vê o par da rodada ${rodada}`);
    receptores.add(p.receptor.id);
  }
  confere(receptores.size === usuarios.length, "receptores distintos");
}

async function pedirSorteio(org: Usuario, grupoId: string, rodada: number): Promise<string> {
  const sorteioId = id();
  await org.db.transact(
    org.db.tx.sorteios[sorteioId]!
      .create({ status: "pendente", rodada, chave: `${grupoId}:${rodada}`, criadoEm: Date.now() })
      .link({ grupo: grupoId }),
  );
  return sorteioId;
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
async function conferirLimpeza(
  grupoId: string | undefined,
  sorteios: string[],
  reaberturas: string[],
  participantes: string[],
) {
  const ou = (ids: string[]) => ({ $in: ids.length ? ids : [id()] });
  const r = await admin.query({
    $users: { $: { where: { email: { $like: `${PREFIXO}-%` } } } },
    grupos: { $: { where: { id: grupoId ?? id() } } },
    sorteios: { $: { where: { id: ou(sorteios) } } },
    reaberturas: { $: { where: { id: ou(reaberturas) } } },
    participantes: { $: { where: { id: ou(participantes) } } },
    pares: { $: { where: { "sorteio.id": ou(sorteios) } } },
  });
  const sobras = {
    usuarios: r.$users.length,
    grupos: r.grupos.length,
    sorteios: r.sorteios.length,
    reaberturas: r.reaberturas.length,
    participantes: r.participantes.length,
    pares: r.pares.length,
  };
  passo(`sobras: ${JSON.stringify(sobras)}`);
  confere(Object.values(sobras).every((n) => n === 0), "nada sobrou depois da limpeza");
}

async function main(): Promise<void> {
  let grupoId: string | undefined;
  const sorteios: string[] = [];
  const reaberturas: string[] = [];
  const participantes: string[] = [];
  let falha: unknown;
  try {
    passo(`prefixo ${PREFIXO}`);
    // 1. organizador e 3 participantes
    const [org, ...outros] = await Promise.all([0, 1, 2, 3].map(criarUsuario));
    const retardatario = await criarUsuario(4);
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
    sorteios.push(await pedirSorteio(org!, grupoId, 1));
    passo(`3. sorteio ${sorteios[0]} pedido`);

    // 4. espera `concluido` (o amigo-worker de produção é quem processa)
    const s1 = await esperarWorker("sorteios", sorteios[0]!);
    confere(s1 === "concluido", `sorteio concluído em até ${PRAZO_MS / 1000}s (status: ${s1})`);
    passo("4. rodada 1 concluída");

    // 5. cada um vê exatamente 1 par, o dele, e os receptores formam uma permutação
    await conferirPares(usuarios, participantes, 1);
    passo("5. cada participante vê exatamente 1 par");

    // 6. o organizador reabre o grupo (como o botão "Reabrir grupo para novos participantes")
    const reaberturaId = id();
    reaberturas.push(reaberturaId);
    await org!.db.transact(
      org!.db.tx.reaberturas[reaberturaId]!.create({ status: "pendente", criadoEm: Date.now() }).link({ grupo: grupoId }),
    );
    passo(`6. reabertura ${reaberturaId} pedida`);

    // 7. o worker desfaz o sorteio: grupo aberto, rodadaBase = 1 e ninguém vê par
    const r1 = await esperarWorker("reaberturas", reaberturaId);
    confere(r1 === "concluido", `reabertura concluída em até ${PRAZO_MS / 1000}s (status: ${r1})`);
    const { grupos } = await admin.query({ grupos: { $: { where: { id: grupoId } } } });
    confere(grupos[0]?.status === "aberto", "grupo voltou a aberto");
    confere(grupos[0]?.rodadaAtual === 1 && grupos[0]?.rodadaBase === 1, "rodadaAtual 1 e rodadaBase 1");
    for (const [i, u] of usuarios.entries()) {
      const r = await u.db.query({ pares: {} });
      confere(r.pares.length === 0, `usuário ${i} não vê par depois de reabrir (viu ${r.pares.length})`);
    }
    passo("7. grupo reaberto e pares apagados");

    // 8. o retardatário entra pelo código
    usuarios.push(retardatario);
    participantes.push(await entrarPorCodigo(retardatario, digitado, "e2e-4"));
    passo("8. retardatário entrou pelo código");

    // 9. sorteia a rodada 2 com os 5
    sorteios.push(await pedirSorteio(org!, grupoId, 2));
    const s2 = await esperarWorker("sorteios", sorteios[1]!);
    confere(s2 === "concluido", `rodada 2 concluída em até ${PRAZO_MS / 1000}s (status: ${s2})`);
    passo("9. rodada 2 concluída");

    // 10. cada um dos 5 vê exatamente 1 par, o da rodada 2
    await conferirPares(usuarios, participantes, 2);
    passo("10. cada um dos 5 vê exatamente 1 par");
  } catch (e) {
    falha = e;
  }

  // 11. apaga tudo, passe ou falhe
  try {
    await limpar();
    await conferirLimpeza(grupoId, sorteios, reaberturas, participantes);
    passo("11. limpeza conferida");
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
