<script lang="ts">
	// Criar grupo: tema → sobre → datas e regras → campos → revisão → compartilhar.
	// "Voltar" preserva o estado; o grupo só é gravado na revisão (uma transação única).
	import { id } from '@instantdb/core';
	import { gerarCodigo, TEMAS } from '@amigo/dominio';
	import { db } from '#lib/instant.js';
	import { usarSessao } from '#lib/sessao.svelte.js';
	import { mensagemDeErro } from '#lib/erros.js';
	import {
		apelidoDoEmail,
		ehColisao,
		ETAPAS,
		ETAPA_COMPARTILHAR,
		estadoInicial,
		nomeDoTema,
		paraTransacao,
		trocarTema,
		validarEtapa,
		validarTudo,
		valorNumerico,
		TIPOS_CAMPO,
		type Estado
	} from '#lib/criar/estado.svelte.js';
	import Stepper from '#lib/components/Stepper.svelte';
	import EditorCampos from '#lib/components/EditorCampos.svelte';
	import Compartilhar from '#lib/components/Compartilhar.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';

	const sessao = usarSessao();
	const MAX_TENTATIVAS = 5;

	let estado = $state<Estado>(estadoInicial('livro'));
	let erros = $state<string[]>([]);
	let criando = $state(false);
	let erroCriar = $state<string | null>(null);
	let criado = $state<{ grupoId: string; codigo: string; titulo: string } | null>(null);
	let temaPendente = $state<Estado['temaId'] | null>(null);

	const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
	const dataBr = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : 'Não definida');

	function escolherTema(t: Estado['temaId']) {
		if (t === estado.temaId) return;
		if (estado.camposEditados) temaPendente = t;
		else estado = trocarTema(estado, t);
	}
	function confirmarTroca() {
		if (temaPendente) estado = trocarTema(estado, temaPendente);
		temaPendente = null;
	}

	function avancar() {
		erros = validarEtapa(estado.etapa, estado);
		if (erros.length === 0) estado.etapa += 1;
	}
	function voltar() {
		erros = [];
		erroCriar = null;
		if (estado.etapa > 0) estado.etapa -= 1;
	}

	async function confirmar() {
		const usuario = sessao.usuario;
		if (!usuario || criando) return;
		const falha = validarTudo(estado);
		if (falha) {
			estado.etapa = falha.etapa;
			erros = falha.erros;
			return;
		}
		criando = true;
		erroCriar = null;
		try {
			const apelido = apelidoDoEmail(usuario.email);
			for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
				const codigo = gerarCodigo();
				const ops = paraTransacao(estado, {
					grupoId: id(),
					codigo,
					participanteId: id(),
					campoIds: estado.campos.map(() => id()),
					usuarioId: usuario.id,
					apelido,
					agora: Date.now()
				});
				try {
					await db.transact(
						ops.map((op) => {
							// As operações vêm de `paraTransacao` (dados já validados); o tipo do tx é por entidade.
							const base = db.tx[op.entidade][op.id] as any;
							return (op.entidade === 'participantes' ? base.ruleParams({ codigo }) : base)
								.create(op.dados)
								.link(op.links);
						})
					);
					criado = { grupoId: ops[0]!.id, codigo, titulo: estado.titulo.trim() };
					estado.etapa = ETAPA_COMPARTILHAR;
					return;
				} catch (e) {
					// Colisão do código: gera outro e tenta de novo (spec §3.6).
					if (ehColisao(e) && tentativa < MAX_TENTATIVAS) continue;
					throw e;
				}
			}
		} catch (e) {
			erroCriar = ehColisao(e)
				? 'Não conseguimos gerar um código livre. Tente de novo.'
				: mensagemDeErro(e);
		} finally {
			criando = false;
		}
	}
</script>

<svelte:head><title>Criar grupo · Amigo Secreto</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-5">
	<h1 class="text-3xl font-black tracking-tight">Criar grupo</h1>
	<Stepper etapas={ETAPAS} atual={estado.etapa} />

	<Card.Root class="border-2 bg-card shadow-md">
		<Card.Content class="flex flex-col gap-5 px-4 py-5 sm:px-6">
			{#if estado.etapa === 0}
				<div>
					<h2 class="text-xl font-black">Escolha um tema</h2>
					<p class="text-sm text-muted-foreground">
						O tema já vem com os campos do perfil prontos. Você pode mudar tudo depois.
					</p>
				</div>
				<div class="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tema">
					{#each TEMAS as t (t.id)}
						<button
							type="button"
							role="radio"
							aria-checked={estado.temaId === t.id}
							onclick={() => escolherTema(t.id)}
							class="flex flex-col gap-1 rounded-xl border-2 p-3 text-left shadow-sm transition-transform afunda {estado.temaId ===
							t.id
								? 'bg-primary shadow-md'
								: 'bg-background hover:-translate-y-0.5'}"
						>
							<span class="flex items-center justify-between text-lg font-black">
								{t.nome}
								{#if estado.temaId === t.id}<CheckIcon class="size-5" />{/if}
							</span>
							<span class="text-sm font-medium">{t.descricao}</span>
						</button>
					{/each}
				</div>
			{:else if estado.etapa === 1}
				<h2 class="text-xl font-black">Sobre o grupo</h2>
				<div class="flex flex-col gap-1.5">
					<Label for="titulo" class="font-bold">Título</Label>
					<Input
						id="titulo"
						bind:value={estado.titulo}
						maxlength={80}
						placeholder="Ex.: Amigo Secreto da Família 2026"
						class="border-2"
					/>
					<span class="text-xs text-muted-foreground">{estado.titulo.trim().length}/80 (mínimo 3)</span>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="descricao" class="font-bold">Descrição (opcional)</Label>
					<Textarea
						id="descricao"
						bind:value={estado.descricao}
						rows={4}
						placeholder="Regras, local, recados para a turma..."
						class="border-2"
					/>
					<span class="text-xs text-muted-foreground">{estado.descricao.trim().length}/500</span>
				</div>
			{:else if estado.etapa === 2}
				<div>
					<h2 class="text-xl font-black">Datas e regras</h2>
					<p class="text-sm text-muted-foreground">Tudo opcional. Serve só de referência para o grupo.</p>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<Label for="d-sorteio" class="font-bold">Data prevista do sorteio</Label>
						<Input id="d-sorteio" type="date" bind:value={estado.dataSorteio} class="border-2" />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="d-evento" class="font-bold">Data do evento</Label>
						<Input id="d-evento" type="date" bind:value={estado.dataEvento} class="border-2" />
					</div>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="valor" class="font-bold">Valor sugerido (R$)</Label>
					<Input
						id="valor"
						inputmode="decimal"
						bind:value={estado.valor}
						placeholder="Ex.: 50"
						class="border-2 sm:max-w-48"
					/>
				</div>
			{:else if estado.etapa === 3}
				<div>
					<h2 class="text-xl font-black">Campos do perfil</h2>
					<p class="text-sm text-muted-foreground">
						O que cada participante vai informar para ajudar quem tirar a pessoa.
					</p>
				</div>
				<EditorCampos bind:campos={estado.campos} aoEditar={() => (estado.camposEditados = true)} />
			{:else if estado.etapa === 4}
				<h2 class="text-xl font-black">Revisão</h2>
				<dl class="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
					<dt class="font-black">Tema</dt>
					<dd>{nomeDoTema(estado.temaId)}</dd>
					<dt class="font-black">Título</dt>
					<dd class="font-semibold break-words">{estado.titulo.trim()}</dd>
					<dt class="font-black">Descrição</dt>
					<dd class="break-words whitespace-pre-line">{estado.descricao.trim() || 'Sem descrição'}</dd>
					<dt class="font-black">Sorteio previsto</dt>
					<dd>{dataBr(estado.dataSorteio)}</dd>
					<dt class="font-black">Evento</dt>
					<dd>{dataBr(estado.dataEvento)}</dd>
					<dt class="font-black">Valor sugerido</dt>
					<dd>
						{#if valorNumerico(estado.valor) === null}Não definido{:else}{brl.format(
								valorNumerico(estado.valor)!
							)}{/if}
					</dd>
					<dt class="font-black">Campos</dt>
					<dd>
						{#if estado.campos.length === 0}
							Nenhum campo
						{:else}
							<ol class="flex list-decimal flex-col gap-1 pl-5">
								{#each estado.campos as c (c.chave)}
									<li>
										<span class="font-semibold">{c.rotulo.trim()}</span>
										<span class="text-muted-foreground">
											· {TIPOS_CAMPO.find((t) => t.valor === c.tipo)?.nome}{c.obrigatorio
												? ' · obrigatório'
												: ''}
										</span>
									</li>
								{/each}
							</ol>
						{/if}
					</dd>
				</dl>
				<p class="rounded-md border-2 bg-muted p-3 text-sm font-medium">
					Você entra no grupo como participante e poderá preencher o seu perfil em seguida.
				</p>
			{:else if criado}
				<Compartilhar codigo={criado.codigo} grupoId={criado.grupoId} titulo={criado.titulo} />
			{/if}

			{#if erros.length}
				<ul role="alert" class="flex flex-col gap-1 rounded-md border-2 border-destructive bg-destructive/10 p-3 text-sm font-bold text-destructive">
					{#each erros as e (e)}<li>{e}</li>{/each}
				</ul>
			{/if}
			{#if erroCriar}
				<p role="alert" class="rounded-md border-2 border-destructive bg-destructive/10 p-3 text-sm font-bold text-destructive">
					{erroCriar}
				</p>
			{/if}

			{#if estado.etapa < ETAPA_COMPARTILHAR}
				<div class="flex justify-between gap-2">
					<Button variant="outline" class="font-bold afunda" disabled={estado.etapa === 0 || criando} onclick={voltar}>
						<ArrowLeftIcon /> Voltar
					</Button>
					{#if estado.etapa === 4}
						<Button class="font-bold afunda" disabled={criando} onclick={confirmar}>
							{#if criando}<LoaderIcon class="animate-spin" /> Criando...{:else}<CheckIcon /> Criar grupo{/if}
						</Button>
					{:else}
						<Button class="font-bold afunda" onclick={avancar}>Avançar <ArrowRightIcon /></Button>
					{/if}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<Dialog.Root open={temaPendente !== null} onOpenChange={(a) => !a && (temaPendente = null)}>
	<Dialog.Content class="border-2">
		<Dialog.Header>
			<Dialog.Title class="font-black">Trocar o tema substitui os campos</Dialog.Title>
			<Dialog.Description>
				Você editou os campos do perfil. Ao trocar para {temaPendente ? nomeDoTema(temaPendente) : ''}, essas
				edições serão perdidas.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" class="font-bold afunda" onclick={() => (temaPendente = null)}>Cancelar</Button>
			<Button class="font-bold afunda" onclick={confirmarTroca}>Trocar tema</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
