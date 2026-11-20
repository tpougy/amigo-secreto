<script lang="ts">
	import type { Snippet } from 'svelte';
	import RodapePublico from '#lib/components/rodape-publico.svelte';
	import GiftIcon from '@lucide/svelte/icons/gift';

	let { titulo, children }: { titulo: string; children: Snippet } = $props();
</script>

<svelte:head><title>{titulo} · Amigo Secreto</title></svelte:head>

<div class="flex min-h-svh flex-col bg-pontos">
	<header class="mx-auto w-full max-w-3xl px-4 py-5">
		<a href="/" class="inline-flex items-center gap-2 rounded-md border-2 bg-primary px-3 py-1.5 font-black shadow-sm">
			<GiftIcon class="size-5" /> Amigo Secreto
		</a>
	</header>
	<main class="mx-auto w-full max-w-3xl flex-1 px-4 pb-12">
		<article class="rounded-2xl border-4 bg-background p-6 sombra-dura md:p-10 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-black [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:ps-6 [&_li]:mt-1 [&_a]:font-semibold [&_a]:underline">
			<h1 class="text-4xl font-black tracking-tighter">{titulo}</h1>
			{@render children()}
		</article>
	</main>
	<RodapePublico />
</div>
