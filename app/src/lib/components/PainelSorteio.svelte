<script lang="ts">
	// Aba Sorteio do organizador: contagem, data prevista, botão Sortear, status ao vivo do pedido
	// (pendente → processando → concluído/erro) com a fase do worker por Instant Stream, "Tentar de
	// novo", refazer, reabrir o grupo para novos participantes e restrições.
	// Nunca mostra pares: o organizador só enxerga o próprio (regra `pares.view`).
	import { id } from '@instantdb/core';
	import { db } from '#lib/instant.js';
	import { mensagemDeErro } from '#lib/erros.js';
	import {
		dataBr,
		erroReabertura,
		estadoPainel,
		reabrindo as haReaberturaPendente,
		reabertoEm,
		type ReaberturaBruta,
		type SorteioBruto
	} from '#lib/grupo/consultas.js';
	import {
		bannerRemovidoAposSorteio,
		confirmacaoReabrir,
		confirmacaoRefazer,
		contarAtivos,
		contarViram,
		LIMITE_RODADAS,
		motivoNaoSortear,
		PALAVRA_REABRIR,
		PALAVRA_REFAZER,
		rodadasNestaAbertura
	} from '#lib/grupo/regras.js';
	import ConfirmarAcao from '#lib/components/ConfirmarAcao.svelte';
	import Restricoes, { type RestricaoLista } from '#lib/components/Restricoes.svelte';
	import type { ParticipanteLista } from '#lib/components/Participantes.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import ShuffleIcon from '@lucide/svelte/icons/shuffle';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import LockIcon from '@lucide/svelte/icons/lock';
	import DoorOpenIcon from '@lucide/svelte/icons/door-open';

	let {
		grupo,
		sorteios,
		reaberturas = [],
		participantes,
		restricoes,
		refazerAberto = $bindable(false)
	}: {
		grupo: {
			id: string;
			status: string;
			rodadaAtual: number;
			rodadaBase?: number | null;
			dataSorteioPrevista?: string | number | null;
		};
		sorteios: SorteioBruto[];
		reaberturas?: ReaberturaBruta[];
		participantes: ParticipanteLista[];
		restricoes: RestricaoLista[];
		/** A página abre o refazer (ex.: logo depois de remover alguém após o sorteio). */
		refazerAberto?: boolean;
	} = $props();

	const estado = $derived(estadoPainel(grupo.rodadaAtual, sorteios, grupo.rodadaBase, reabertoEm(reaberturas)));
	/** "Rodada N de 3": conta só as rodadas desde a última abertura. */
	const nesta = $derived(rodadasNestaAbertura(grupo));
	const ativos = $derived(contarAtivos(participantes));
	const viram = $derived(contarViram(participantes, grupo.rodadaAtual));
	const encerrado = $derived(grupo.status === 'encerrado');
	const removidoApos = $derived(bannerRemovidoAposSorteio(grupo.status, grupo.rodadaAtual, participantes));
	// Reabertura esperando o worker: a regra recusa sorteios novos até ela terminar.
	const reabrindo = $derived(haReaberturaPendente(reaberturas));
	const conf = $derived.by(() => {
		if (reabrindo) return { permitido: false as const, motivo: 'Reabrindo…' };
		return confirmacaoRefazer({
			rodadaAtual: grupo.rodadaAtual,
			rodadaBase: grupo.rodadaBase,
			ativos,
			viram,
			removidoAposSorteio: removidoApos
		});
	});
	const motivoSortear = $derived(reabrindo ? 'Reabrindo…' : motivoNaoSortear(ativos));
	const temRodada = $derived(nesta < LIMITE_RODADAS);
	const reaberto = $derived(grupo.status === 'aberto' && grupo.rodadaAtual > 0);
	// Reabrir: grupo sorteado e nenhum sorteio em andamento (sem limite de rodadas).
	const podeReabrir = $derived(grupo.status === 'sorteado' && estado.tipo !== 'andamento');
	const confReabrir = $derived(confirmacaoReabrir({ viram }));
	const sorteadoEm = $derived(
		estado.tipo === 'concluido' ? estado.sorteio?.concluidoEm : estado.tipo === 'erro' ? estado.concluido?.concluidoEm : null
	);
	const erroReabrir = $derived(erroReabertura(grupo.status, reaberturas, sorteadoEm));
	let reabrirAberto = $state(false);
	const restricoesEditaveis = $derived(!encerrado && estado.tipo !== 'andamento' && temRodada);
	const ativosLista = $derived(participantes.filter((p) => !p.removido).map((p) => ({ id: p.id, apelido: p.apelido })));

	let pedindo = $state(false);
	let erroPedido = $state<string | null>(null);
	let avisoRefazer = $state<string | null>(null);
	let confirmarAberto = $state(false);

	// Pedido externo de refazer: abre a confirmação, ou explica por que não dá.
	$effect(() => {
		if (!refazerAberto) return;
		refazerAberto = false;
		abrirRefazer();
	});

	function abrirRefazer() {
		avisoRefazer = null;
		if (estado.tipo === 'andamento') return void (avisoRefazer = 'Já há um sorteio em andamento.');
		if (!conf.permitido) return void (avisoRefazer = conf.motivo);
		confirmarAberto = true;
	}

	function mensagemPedido(e: unknown): string {
		const tipo = (e as { body?: { type?: string } })?.body?.type;
		if (tipo === 'rate-limited') return 'Muitos pedidos de sorteio em pouco tempo. Tente de novo mais tarde.';
		if (tipo === 'record-not-unique') return 'Já existe um pedido de sorteio para esta rodada.';
		return mensagemDeErro(e);
	}

	/** Cria o pedido da próxima rodada (`rodadaAtual + 1`). O worker faz o resto. */
	async function pedirSorteio() {
		const rodada = grupo.rodadaAtual + 1;
		await db.transact(
			db.tx.sorteios[id()]!
				.create({ status: 'pendente', rodada, chave: `${grupo.id}:${rodada}`, criadoEm: Date.now() })
				.link({ grupo: grupo.id })
		);
	}

	async function sortear() {
		if (pedindo) return;
		pedindo = true;
		erroPedido = null;
		try {
			await pedirSorteio();
		} catch (e) {
			erroPedido = mensagemPedido(e);
		} finally {
			pedindo = false;
		}
	}

	/** Pede a reabertura; o worker apaga os pares e devolve o grupo para `aberto`. */
	async function reabrir() {
		try {
			await db.transact(
				db.tx.reaberturas[id()]!.create({ status: 'pendente', criadoEm: Date.now() }).link({ grupo: grupo.id })
			);
		} catch (e) {
			const tipo = (e as { body?: { type?: string } })?.body?.type;
			if (tipo === 'rate-limited') throw new Error('Muitos pedidos de reabertura em pouco tempo. Tente de novo mais tarde.');
			throw new Error(mensagemDeErro(e));
		}
	}

	async function refazer() {
		try {
			await pedirSorteio();
		} catch (e) {
			throw new Error(mensagemPedido(e));
		}
	}

	// Fase do worker pelo stream `sorteio-<id>` (embaralhando → sorteando → pronto | erro). É só um
	// detalhe a mais: sem stream (ou se ele falhar), a fase sai do `status` do sorteio.
	const idEmAndamento = $derived(estado.tipo === 'andamento' ? estado.sorteio.id : null);
	let faseStream = $state<string | null>(null);
	$effect(() => {
		const sorteioId = idEmAndamento;
		faseStream = null;
		if (!sorteioId) return;
		let ativo = true;
		let leitor: ReadableStreamDefaultReader<string> | null = null;
		(async () => {
			// O stream só existe quando o worker começa: se a leitura falhar, tenta mais algumas vezes.
			for (let tentativa = 0; ativo && tentativa < 5; tentativa++) {
				try {
					leitor = db.streams.createReadStream({ clientId: `sorteio-${sorteioId}` }).getReader();
					let texto = '';
					for (;;) {
						const { value, done } = await leitor.read();
						if (done || !ativo) return;
						texto += value;
						const linhas = texto.split('\n').filter(Boolean);
						if (linhas.length) faseStream = linhas[linhas.length - 1]!;
					}
				} catch {
					await new Promise((r) => setTimeout(r, 400));
				}
			}
		})();
		return () => {
			ativo = false;
			leitor?.cancel().catch(() => {});
		};
	});
	const nomeFase: Record<string, string> = {
		embaralhando: 'Embaralhando os nomes...',
		sorteando: 'Sorteando os pares...',
		pronto: 'Pronto!',
		erro: 'Algo deu errado.'
	};
	const fasePorStatus: Record<string, string> = { pendente: 'Na fila do servidor...', processando: 'Sorteando...' };

	const passos = ['pendente', 'processando', 'concluido'] as const;
	const nomePasso: Record<string, string> = { pendente: 'Na fila', processando: 'Sorteando', concluido: 'Pronto' };
</script>

<div class="flex flex-col gap-5">
	<dl class="grid grid-cols-3 gap-2 text-center">
		<div class="rounded-xl border-2 bg-ceu p-2 text-tinta shadow-sm">
			<dt class="text-[0.65rem] font-black tracking-wider uppercase">Ativos</dt>
			<dd class="text-2xl font-black" data-testid="contagem-ativos">{ativos}</dd>
		</div>
		<div class="rounded-xl border-2 bg-lima p-2 text-tinta shadow-sm">
			<dt class="text-[0.65rem] font-black tracking-wider uppercase">Previsto</dt>
			<dd class="text-base leading-8 font-black">{dataBr(grupo.dataSorteioPrevista) ?? '—'}</dd>
		</div>
		<div class="rounded-xl border-2 bg-rosa p-2 text-tinta shadow-sm">
			<dt class="text-[0.65rem] font-black tracking-wider uppercase">Rodada</dt>
			<dd class="text-2xl font-black" data-testid="rodada">{nesta}<span class="text-base">/{LIMITE_RODADAS}</span></dd>
		</div>
	</dl>

	<section class="flex flex-col gap-3 rounded-xl border-2 bg-card p-4 shadow-md" aria-live="polite" data-testid="painel-sorteio">
		{#if estado.tipo === 'andamento'}
			{@const atual = estado.sorteio.status}
			<h3 class="text-lg font-black">
				{nesta === 0 ? 'Sorteando...' : `Refazendo o sorteio (rodada ${nesta + 1})...`}
			</h3>
			<ol class="flex items-center gap-2" data-testid="status-sorteio" data-status={atual}>
				{#each passos as p, i (p)}
					{@const feito = passos.indexOf(atual as (typeof passos)[number]) > i}
					{@const agora = atual === p}
					<li
						class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 px-2 py-2 text-xs font-black uppercase sm:text-sm {feito
							? 'bg-lima text-tinta'
							: agora
								? 'animate-pulse bg-primary'
								: 'bg-muted text-muted-foreground'}"
					>
						{#if feito}<CheckIcon class="size-4" />{:else if agora}<LoaderIcon class="size-4 animate-spin" />{/if}
						{nomePasso[p]}
					</li>
				{/each}
			</ol>
			<p class="font-bold" data-testid="fase-sorteio" data-fonte={faseStream ? 'stream' : 'status'}>
				{(faseStream && nomeFase[faseStream]) ?? fasePorStatus[atual] ?? ''}
			</p>
			<p class="text-sm text-muted-foreground">Pode fechar a página: o sorteio continua no servidor.</p>
		{:else}
			{#if estado.tipo === 'concluido' || (estado.tipo === 'erro' && estado.concluido)}
				{@const s = estado.tipo === 'concluido' ? estado.sorteio : estado.concluido}
				<div class="flex items-start gap-3">
					<span class="grid size-10 shrink-0 place-items-center rounded-full border-2 bg-lima text-tinta">
						<CheckIcon />
					</span>
					<div>
						<h3 class="text-lg font-black" data-testid="sorteio-feito">
							Sorteio feito{#if s?.concluidoEm}{' '}em {dataBr(s.concluidoEm)}{/if} (rodada {nesta} de {LIMITE_RODADAS})
						</h3>
						<p class="text-sm text-muted-foreground">
							Os pares são secretos: nem você, como organizador, vê quem tirou quem.
							<span data-testid="viram">{viram} de {ativos} já abriram o próprio par.</span>
						</p>
					</div>
				</div>
			{/if}

			{#if estado.tipo === 'erro'}
				<div class="flex items-start gap-3 rounded-lg border-2 border-destructive bg-destructive/10 p-3" role="alert">
					<TriangleAlertIcon class="mt-0.5 shrink-0 text-destructive" />
					<div class="flex flex-col gap-2">
						<p class="font-bold" data-testid="erro-sorteio">
							O sorteio da rodada {nesta + 1} falhou: {estado.sorteio.erro ?? 'erro desconhecido'}
						</p>
						{#if encerrado}
							<p class="text-sm">O grupo está encerrado.</p>
						{:else if temRodada && nesta >= 1}
							<!-- Refazer que falhou: tentar de novo é refazer, com a mesma confirmação. -->
							<Button
								class="self-start border-2 font-bold afunda"
								disabled={!conf.permitido}
								onclick={abrirRefazer}
								data-testid="tentar-de-novo"
							>
								<RotateCcwIcon /> Tentar de novo
							</Button>
							{#if !conf.permitido}<p class="text-sm font-bold" data-testid="motivo-tentar">{conf.motivo}</p>{/if}
						{:else if temRodada}
							<Button
								class="self-start border-2 font-bold afunda"
								disabled={!!motivoSortear || pedindo}
								onclick={sortear}
								data-testid="tentar-de-novo"
							>
								{#if pedindo}<LoaderIcon class="animate-spin" />{:else}<RotateCcwIcon />{/if}
								Tentar de novo
							</Button>
							{#if motivoSortear}<p class="text-sm font-bold" data-testid="motivo-tentar">{motivoSortear}</p>{/if}
						{:else}
							<p class="text-sm font-bold">Limite de rodadas atingido</p>
						{/if}
					</div>
				</div>
			{:else if estado.tipo === 'nunca'}
				<div>
					{#if reaberto}
						<h3 class="text-lg font-black" data-testid="grupo-reaberto">Grupo reaberto para novos participantes</h3>
						<p class="text-sm text-muted-foreground">
							O sorteio anterior foi desfeito e o código voltou a funcionar. Quando todo mundo tiver entrado, sorteie de
							novo.
						</p>
					{:else}
						<h3 class="text-lg font-black">Tudo pronto para sortear?</h3>
						<p class="text-sm text-muted-foreground">
							O sorteio é feito no servidor e cada pessoa vê só quem tirou. Cada abertura do grupo tem até {LIMITE_RODADAS} sorteios (o primeiro e até {LIMITE_RODADAS - 1} refeitos).
						</p>
					{/if}
				</div>
				{#if encerrado}
					<p class="text-sm font-bold">O grupo está encerrado.</p>
				{:else}
					<Button
						size="lg"
						class="self-start border-2 text-base font-black afunda"
						disabled={!!motivoSortear || pedindo}
						onclick={sortear}
						data-testid="botao-sortear"
					>
						{#if pedindo}<LoaderIcon class="animate-spin" />{:else}<ShuffleIcon />{/if}
						Sortear
					</Button>
					{#if motivoSortear}<p class="text-sm font-bold" data-testid="motivo-sortear">{motivoSortear}</p>{/if}
				{/if}
			{/if}

			{#if estado.tipo === 'concluido' && !encerrado}
				<div class="flex flex-col gap-2 border-t-2 border-dashed pt-3">
					{#if conf.permitido}
						<Button variant="outline" class="self-start border-2 font-bold afunda" onclick={abrirRefazer} data-testid="botao-refazer">
							<RotateCcwIcon /> Refazer sorteio
						</Button>
					{:else}
						<Button variant="outline" class="self-start border-2 font-bold" disabled data-testid="botao-refazer">
							<LockIcon /> Refazer sorteio
						</Button>
						<p class="text-sm font-bold" data-testid="motivo-refazer">{conf.motivo}</p>
					{/if}
				</div>
			{/if}
			{#if podeReabrir}
				<div class="flex flex-col gap-2 border-t-2 border-dashed pt-3">
					<Button
						variant="outline"
						class="self-start border-2 font-bold afunda"
						disabled={reabrindo}
						onclick={() => (reabrirAberto = true)}
						data-testid="botao-reabrir"
					>
						{#if reabrindo}<LoaderIcon class="animate-spin" /> Reabrindo…{:else}<DoorOpenIcon /> Reabrir grupo para novos participantes{/if}
					</Button>
					{#if erroReabrir}
						<p role="alert" class="text-sm font-bold text-destructive" data-testid="erro-reabrir">
							Não deu para reabrir: {erroReabrir}
						</p>
					{/if}
				</div>
			{/if}
			{#if avisoRefazer}<p role="alert" class="text-sm font-bold text-destructive">{avisoRefazer}</p>{/if}
			{#if erroPedido}<p role="alert" class="text-sm font-bold text-destructive">{erroPedido}</p>{/if}
		{/if}
	</section>

	<Restricoes grupoId={grupo.id} participantes={ativosLista} {restricoes} editavel={restricoesEditaveis} />
</div>

{#if conf.permitido}
	<ConfirmarAcao
		bind:aberto={confirmarAberto}
		titulo={removidoApos ? 'Refazer o sorteio sem quem saiu' : 'Refazer o sorteio'}
		texto={conf.texto}
		exigir={conf.nivel === 'forte' ? PALAVRA_REFAZER : undefined}
		rotuloConfirmar="Refazer sorteio"
		destrutivo={conf.nivel === 'forte'}
		aoConfirmar={refazer}
	>
		<p class="text-xs text-muted-foreground">
			Esta será a rodada {nesta + 1} de {LIMITE_RODADAS}.
		</p>
	</ConfirmarAcao>
{/if}

{#if podeReabrir}
	<ConfirmarAcao
		bind:aberto={reabrirAberto}
		titulo="Reabrir grupo para novos participantes"
		texto={confReabrir.texto}
		exigir={confReabrir.nivel === 'forte' ? PALAVRA_REABRIR : undefined}
		rotuloConfirmar="Reabrir grupo"
		destrutivo={confReabrir.nivel === 'forte'}
		aoConfirmar={reabrir}
	>
		<p class="text-xs text-muted-foreground">
			O código do grupo volta a funcionar para quem faltou entrar. Depois, é só sortear de novo.
		</p>
	</ConfirmarAcao>
{/if}
