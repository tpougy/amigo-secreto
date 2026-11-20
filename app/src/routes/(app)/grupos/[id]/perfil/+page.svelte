<script lang="ts">
	// Meu perfil no grupo: campos do grupo + minhas respostas (só eu as vejo antes do sorteio).
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { DefCampo, TipoCampo } from '@amigo/dominio';
	import { db } from '#lib/instant.js';
	import { usarSessao } from '#lib/sessao.svelte.js';
	import FormularioPerfil from '#lib/components/FormularioPerfil.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';

	const sessao = usarSessao();
	const grupoId = $derived(page.params.id ?? '');

	const consulta = db.useQuery(() =>
		sessao.usuario && grupoId
			? {
					grupos: {
						$: { where: { id: grupoId } },
						campos: {},
						participantes: {
							$: { where: { 'usuario.id': sessao.usuario.id, removido: false } },
							respostas: { campo: {} }
						}
					}
				}
			: null
	);

	const grupo = $derived(consulta.data?.grupos?.[0] ?? null);
	const participante = $derived(grupo?.participantes?.[0] ?? null);
	const campos = $derived<DefCampo[]>(
		(grupo?.campos ?? []).map((c) => ({
			id: c.id,
			rotulo: c.rotulo,
			ajuda: c.ajuda ?? undefined,
			tipo: c.tipo as TipoCampo,
			opcoes: Array.isArray(c.opcoes) ? (c.opcoes as string[]) : undefined,
			obrigatorio: c.obrigatorio,
			ordem: c.ordem
		}))
	);
	const respostas = $derived(
		(participante?.respostas ?? []).flatMap((r) =>
			r.campo ? [{ id: r.id, campoId: r.campo.id, valor: r.valor }] : []
		)
	);
</script>

<svelte:head><title>Meu perfil · Amigo Secreto</title></svelte:head>

<div class="mx-auto flex max-w-xl flex-col gap-5">
	{#if consulta.isLoading}
		<div class="flex flex-col gap-4" aria-busy="true">
			<Skeleton class="h-10 w-64" />
			<Skeleton class="h-64 w-full" />
		</div>
	{:else if consulta.error}
		<p role="alert" class="font-bold text-destructive">{consulta.error.message}</p>
	{:else if !grupo || !participante}
		<Card.Root class="border-2 bg-card shadow-md">
			<Card.Content class="flex flex-col gap-3 px-4 py-5">
				<h1 class="text-2xl font-black">Perfil não encontrado</h1>
				<p class="text-muted-foreground">Você não participa deste grupo.</p>
				<Button href="/grupos" class="self-start border-2 font-bold afunda">Meus grupos</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<div>
			<h1 class="text-3xl font-black tracking-tight">Meu perfil</h1>
			<p class="text-muted-foreground">
				{grupo.titulo}. Quem tirar você vai ver estas respostas depois do sorteio.
			</p>
		</div>
		<Card.Root class="border-2 bg-card shadow-md">
			<Card.Content class="px-4 py-5 sm:px-6">
				<!-- As respostas podem chegar depois do participante; a chave refaz o formulário quando mudam. -->
				{#key `${participante.id}:${respostas.map((r) => r.id).sort().join(",")}`}
					<FormularioPerfil
						participanteId={participante.id}
						{campos}
						{respostas}
						aoSalvar={() => goto(`/grupos/${grupo.id}`)}
					/>
				{/key}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
