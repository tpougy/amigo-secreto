<script lang="ts">
	// Layout das páginas internas: exige login e mostra o menu lateral (drawer no celular).
	// Novas rotas internas (/criar, /entrar-grupo, /grupos/[id], /conta...) entram em `(app)/`.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import AppSidebar from '#lib/components/app-sidebar.svelte';
	import { criarSessao, saindoDeProposito } from '#lib/sessao.svelte.js';
	import { guardarIntencao, intencaoDaRota } from '#lib/intencao.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const sessao = criarSessao();

	$effect(() => {
		if (sessao.carregandoAuth || sessao.usuario || saindoDeProposito()) return;
		const intencao = intencaoDaRota(page.url.pathname);
		if (intencao) guardarIntencao(intencao);
		goto('/entrar', { replaceState: true });
	});
</script>

{#if sessao.usuario}
	<Sidebar.Provider>
		<AppSidebar />
		<Sidebar.Inset class="bg-background">
			<header
				class="sticky top-0 z-10 flex h-14 items-center gap-2 border-b-2 bg-primary px-4 md:hidden"
			>
				<Sidebar.Trigger class="border-2 bg-background shadow-xs" />
				<a href="/grupos" class="font-black tracking-tight">Amigo Secreto</a>
			</header>
			<main class="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-10">
				{@render children()}
			</main>
		</Sidebar.Inset>
	</Sidebar.Provider>
{:else}
	<div class="mx-auto flex max-w-5xl flex-col gap-4 p-8" aria-busy="true">
		<Skeleton class="h-10 w-64" />
		<Skeleton class="h-32 w-full" />
		<Skeleton class="h-32 w-full" />
	</div>
{/if}
