<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
</script>

<svelte:head><title>{page.status} · Amigo Secreto</title></svelte:head>

<div class="flex min-h-svh items-center justify-center bg-pontos px-4">
	<div class="max-w-md rounded-2xl border-4 bg-background p-8 text-center sombra-dura">
		<p class="inline-block -rotate-2 rounded-md border-2 bg-rosa px-3 py-1 text-5xl font-black shadow-sm">
			{page.status}
		</p>
		<h1 class="mt-6 text-2xl font-black">
			{page.status === 404 ? 'Página não encontrada' : 'Algo deu errado'}
		</h1>
		<p class="mt-2 font-medium text-muted-foreground">{page.error?.message}</p>
		<Button href="/" class="mt-6 font-bold afunda">Ir para o início</Button>
	</div>
</div>
