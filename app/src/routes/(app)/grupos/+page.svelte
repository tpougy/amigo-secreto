<script lang="ts">
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import AssistenteIA from '#lib/components/AssistenteIA.svelte';
	import CartaoGrupo from '#lib/components/cartao-grupo.svelte';
	import { usarSessao } from '#lib/sessao.svelte.js';
	import type { GrupoResumo } from '#lib/meus-grupos.js';
	import CrownIcon from '@lucide/svelte/icons/crown';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import type { Component } from 'svelte';

	const sessao = usarSessao();
</script>

<svelte:head><title>Meus grupos · Amigo Secreto</title></svelte:head>

{#snippet secao(
	titulo: string,
	cor: string,
	Icone: Component,
	grupos: GrupoResumo[],
	papel: 'organizando' | 'participando'
)}
	<section class="flex flex-col gap-4">
		<h2 class="flex items-center gap-2 text-xl font-black tracking-tight">
			<span class="inline-flex size-9 items-center justify-center rounded-md border-2 shadow-xs {cor}">
				<Icone class="size-5" />
			</span>
			{titulo}
			{#if !sessao.carregandoGrupos}
				<span class="rounded-full border-2 bg-background px-2 text-sm">{grupos.length}</span>
			{/if}
		</h2>
		{#if sessao.carregandoGrupos}
			<div class="grid gap-4 sm:grid-cols-2">
				<Skeleton class="h-24" />
				<Skeleton class="h-24" />
			</div>
		{:else if grupos.length === 0}
			<Empty.Root class="border-2 bg-card">
				<Empty.Header>
					<Empty.Media variant="icon" class="border-2 {cor}"><Icone /></Empty.Media>
					{#if papel === 'organizando'}
						<Empty.Title class="font-black">Você ainda não organiza nenhum grupo</Empty.Title>
						<Empty.Description>Crie um grupo, chame a turma pelo código e sorteie quando todos entrarem.</Empty.Description>
					{:else}
						<Empty.Title class="font-black">Você ainda não participa de nenhum grupo</Empty.Title>
						<Empty.Description>Recebeu um código ou QR Code? Use-o para entrar no grupo.</Empty.Description>
					{/if}
				</Empty.Header>
				<Empty.Content>
					{#if papel === 'organizando'}
						<Button href="/criar" class="afunda font-bold"><PlusIcon /> Criar um grupo</Button>
					{:else}
						<Button href="/entrar-grupo" variant="secondary" class="afunda font-bold"><TicketIcon /> Entrar em um grupo</Button>
					{/if}
				</Empty.Content>
			</Empty.Root>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2">
				{#each grupos as g (g.id)}
					<CartaoGrupo grupo={g} {papel} />
				{/each}
			</div>
		{/if}
	</section>
{/snippet}

<div class="flex flex-col gap-10">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<h1 class="text-4xl font-black tracking-tighter md:text-5xl">
			Meus <span class="rounded-md border-2 bg-primary px-2 shadow-sm">grupos</span>
		</h1>
		<div class="flex gap-2">
			<Button href="/criar" class="afunda font-bold"><PlusIcon /> Criar</Button>
			<Button href="/entrar-grupo" variant="secondary" class="afunda font-bold"><TicketIcon /> Entrar</Button>
		</div>
	</header>

	{#if sessao.erroGrupos}
		<p class="rounded-md border-2 bg-destructive p-3 font-semibold text-white shadow-sm">
			Não deu para carregar seus grupos: {sessao.erroGrupos}
		</p>
	{/if}

	{@render secao('Organizando', 'bg-primary', CrownIcon, sessao.grupos.organizando, 'organizando')}
	{@render secao('Participando', 'bg-ceu', UsersIcon, sessao.grupos.participando, 'participando')}

	<AssistenteIA />
</div>
