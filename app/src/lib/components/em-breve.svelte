<script lang="ts">
	// Marcador para rotas que chegam nas próximas tasks (11–14). Substitua a página inteira.
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import HammerIcon from '@lucide/svelte/icons/hammer';

	let { titulo, detalhe }: { titulo: string; detalhe?: string } = $props();
</script>

<svelte:head><title>{titulo} · Amigo Secreto</title></svelte:head>

<Empty.Root class="border-2 bg-card shadow-md">
	<Empty.Header>
		<Empty.Media variant="icon" class="border-2 bg-primary"><HammerIcon /></Empty.Media>
		<Empty.Title class="text-2xl font-black">{titulo}</Empty.Title>
		<Empty.Description>Esta parte ainda está sendo construída. {detalhe ?? ''}</Empty.Description>
	</Empty.Header>
	<Empty.Content>
		<Button href="/grupos" class="font-bold afunda">Voltar para Meus grupos</Button>
	</Empty.Content>
</Empty.Root>
