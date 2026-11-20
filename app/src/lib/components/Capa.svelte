<script lang="ts">
	// Capa do grupo (imagem enviada pelo organizador). Sem URL (sem capa, ou escondida pela regra), não mostra nada.
	import { urlCapa } from '#lib/capa.js';

	let { capa, titulo, class: classe = '' }: { capa: unknown; titulo: string; class?: string } = $props();
	const url = $derived(urlCapa(capa));
</script>

{#if url}
	<img
		src={url}
		alt="Capa do grupo {titulo}"
		loading="lazy"
		decoding="async"
		class="w-full border-2 object-cover {classe}"
		data-testid="capa"
	/>
{/if}
