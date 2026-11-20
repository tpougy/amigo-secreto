<script lang="ts">
	// /g/<codigo>: decide (função pura) entre prévia, ir para o grupo, sorteado, encerrado ou não encontrado.
	// A consulta usa `ruleParams: { codigo }` (sem o código certo o grupo é invisível para não-membros).
	import { goto } from '$app/navigation';
	import { id } from '@instantdb/core';
	import { formatarCodigo, normalizarCodigo, TEMAS } from '@amigo/dominio';
	import { db } from '#lib/instant.js';
	import { usarSessao } from '#lib/sessao.svelte.js';
	import { destinoAoAbrirCodigo, erroDeEntrada } from '#lib/navegacao.js';
	import { apelidoDoEmail } from '#lib/criar/estado.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import SeloStatus from '#lib/components/selo-status.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';

	let { codigoBruto }: { codigoBruto: string } = $props();

	const sessao = usarSessao();
	// svelte-ignore state_referenced_locally (a página recria o componente a cada código via {#key})
	const codigo = normalizarCodigo(codigoBruto);

	// Código fora do alfabeto: nem consulta o Instant.
	const consulta = db.useQuery(
		() =>
			codigo && sessao.usuario
				? {
						grupos: {
							$: { where: { codigo } },
							campos: {},
							// Só o vínculo do próprio usuário é visível para quem ainda não entrou.
							participantes: { $: { where: { 'usuario.id': sessao.usuario.id } } }
						}
					}
				: null,
		{ ruleParams: { codigo: codigo ?? '' } }
	);

	const grupo = $derived(consulta.data?.grupos?.[0] ?? null);
	const souMembro = $derived((grupo?.participantes ?? []).some((p) => !p.removido));
	const destino = $derived(
		consulta.isLoading
			? null
			: destinoAoAbrirCodigo({
					logado: !!sessao.usuario,
					grupo: grupo ? { id: grupo.id, status: grupo.status } : null,
					souMembro
				})
	);

	$effect(() => {
		if (destino?.tipo === 'ir-para-grupo' && !entrando) void goto(`/grupos/${destino.id}`, { replaceState: true });
	});

	let apelido = $state('');
	let apelidoEditado = false;
	$effect(() => {
		if (!apelidoEditado && sessao.usuario) apelido = apelidoDoEmail(sessao.usuario.email);
	});
	let entrando = $state(false);
	let erro = $state<string | null>(null);

	const dataBr = (d: string | number | null | undefined) =>
		d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
	const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
	const tema = $derived(TEMAS.find((t) => t.id === grupo?.tema)?.nome ?? grupo?.tema);

	async function entrar(e: SubmitEvent) {
		e.preventDefault();
		const usuario = sessao.usuario;
		if (!usuario || !grupo || !codigo || entrando) return;
		const nome = apelido.trim();
		if (nome.length < 1 || nome.length > 40) {
			erro = 'Informe um apelido de 1 a 40 caracteres.';
			return;
		}
		entrando = true;
		erro = null;
		try {
			await db.transact(
				db.tx.participantes[id()]!
					.ruleParams({ codigo })
					.create({
						apelido: nome,
						chave: `${grupo.id}:${usuario.id}`,
						perfilCompleto: false,
						removido: false,
						entrouEm: Date.now()
					})
					.link({ grupo: grupo.id, usuario: usuario.id })
			);
			// `entrando` segura o redirecionamento automático (a consulta já enxerga o novo vínculo).
			await goto(`/grupos/${grupo.id}/perfil`);
		} catch (err) {
			const r = erroDeEntrada(err);
			erro = r.mensagem;
			if (r.irParaGrupo) await goto(`/grupos/${grupo.id}`);
		} finally {
			entrando = false;
		}
	}
</script>

<svelte:head><title>Entrar no grupo · Amigo Secreto</title></svelte:head>

<div class="mx-auto flex max-w-xl flex-col gap-5">
	{#if !codigo}
		{@render aviso('Código inválido', 'Confira o código e tente de novo.')}
	{:else if consulta.error}
		{@render aviso('Não foi possível abrir o grupo', consulta.error.message)}
	{:else if !destino || destino.tipo === 'ir-para-grupo' || destino.tipo === 'login'}
		<div class="flex flex-col gap-4" aria-busy="true">
			<Skeleton class="h-10 w-64" />
			<Skeleton class="h-48 w-full" />
		</div>
	{:else if destino.tipo === 'nao-encontrado'}
		{@render aviso('Grupo não encontrado', 'Confira o código e tente de novo.')}
	{:else if destino.tipo === 'ja-sorteado'}
		{@render aviso('Este grupo já fez o sorteio', 'Não é possível entrar depois do sorteio.')}
	{:else if destino.tipo === 'encerrado'}
		{@render aviso('Este grupo foi encerrado', 'Não é possível entrar em um grupo encerrado.')}
	{:else if grupo}
		<div class="flex flex-col gap-1">
			<span class="font-mono text-sm font-bold tracking-widest text-muted-foreground">
				{formatarCodigo(codigo)}
			</span>
			<h1 class="text-3xl font-black tracking-tight break-words" data-testid="previa-titulo">{grupo.titulo}</h1>
		</div>

		<Card.Root class="border-2 bg-card shadow-md">
			<Card.Content class="flex flex-col gap-4 px-4 py-5 sm:px-6">
				<div class="flex flex-wrap items-center gap-2">
					<SeloStatus status={grupo.status} />
					<span class="rounded-sm border-2 bg-ceu px-1.5 text-xs font-bold text-tinta">{tema}</span>
				</div>
				{#if grupo.descricao}<p class="whitespace-pre-line">{grupo.descricao}</p>{/if}
				<dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
					{#if grupo.dataSorteioPrevista}
						<div><dt class="font-bold">Sorteio previsto</dt><dd>{dataBr(grupo.dataSorteioPrevista)}</dd></div>
					{/if}
					{#if grupo.dataEvento}
						<div><dt class="font-bold">Evento</dt><dd>{dataBr(grupo.dataEvento)}</dd></div>
					{/if}
					{#if grupo.valorSugerido != null}
						<div><dt class="font-bold">Valor sugerido</dt><dd>{brl.format(grupo.valorSugerido)}</dd></div>
					{/if}
				</dl>
			</Card.Content>
		</Card.Root>

		<form onsubmit={entrar} class="flex flex-col gap-3 rounded-xl border-2 bg-card p-4 shadow-md" novalidate>
			<div class="flex flex-col gap-1.5">
				<Label for="apelido" class="font-bold">Como você quer aparecer no grupo?</Label>
				<Input
					id="apelido"
					bind:value={apelido}
					oninput={() => (apelidoEditado = true)}
					maxlength={40}
					class="border-2"
				/>
			</div>
			{#if erro}<p role="alert" class="text-sm font-bold text-destructive">{erro}</p>{/if}
			<Button type="submit" class="border-2 font-bold afunda" disabled={entrando}>
				{#if entrando}<LoaderIcon class="animate-spin" />{/if}
				Entrar no grupo
			</Button>
		</form>
	{/if}
</div>

{#snippet aviso(titulo: string, detalhe: string)}
	<Card.Root class="border-2 bg-card shadow-md">
		<Card.Content class="flex flex-col gap-3 px-4 py-5 sm:px-6">
			<h1 class="text-2xl font-black">{titulo}</h1>
			<p class="text-muted-foreground">{detalhe}</p>
			<div class="flex flex-wrap gap-2">
				<Button href="/entrar-grupo" class="border-2 font-bold afunda">Digitar outro código</Button>
				<Button href="/grupos" variant="outline" class="border-2 font-bold afunda">Meus grupos</Button>
			</div>
		</Card.Content>
	</Card.Root>
{/snippet}
