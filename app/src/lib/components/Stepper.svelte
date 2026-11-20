<script lang="ts">
	// Indicador de etapas do assistente: barra de progresso + nome da etapa atual.
	import * as Card from '#lib/components/ui/card/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';

	let { etapas, atual }: { etapas: readonly string[]; atual: number } = $props();
</script>

<Card.Root class="gap-3 border-2 bg-card py-4 shadow-md">
	<Card.Content class="flex flex-col gap-3 px-4">
		<div class="flex items-baseline justify-between gap-2">
			<span class="text-xs font-black tracking-wider uppercase text-muted-foreground">
				Etapa {atual + 1} de {etapas.length}
			</span>
			<span class="text-lg font-black" aria-current="step">{etapas[atual]}</span>
		</div>
		<Progress value={atual + 1} max={etapas.length} class="h-4 border-2" aria-label="Progresso" />
		<ol class="hidden gap-1 text-xs font-bold sm:flex">
			{#each etapas as nome, i (nome)}
				<li
					class="flex-1 truncate rounded border-2 px-1.5 py-0.5 text-center {i === atual
						? 'bg-primary'
						: i < atual
							? 'bg-lima'
							: 'bg-muted text-muted-foreground'}"
				>
					{nome}
				</li>
			{/each}
		</ol>
	</Card.Content>
</Card.Root>
