<script lang="ts">
	import SeloStatus from '#lib/components/selo-status.svelte';
	import type { GrupoResumo } from '#lib/meus-grupos.js';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	let { grupo, papel }: { grupo: GrupoResumo; papel: 'organizando' | 'participando' } = $props();
</script>

<a
	href={`/grupos/${grupo.id}`}
	class="group flex flex-col gap-3 rounded-xl border-2 bg-card p-4 shadow-md transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-lg afunda"
>
	<div class="flex items-start justify-between gap-2">
		<h3 class="min-w-0 text-lg leading-tight font-black break-words">{grupo.titulo}</h3>
		<SeloStatus status={grupo.status} />
	</div>
	<div class="flex items-center justify-between text-xs font-semibold text-muted-foreground">
		<span>{papel === 'organizando' ? 'Você organiza' : 'Você participa'}</span>
		<ArrowRightIcon class="size-4 transition-transform group-hover:translate-x-1" />
	</div>
</a>
