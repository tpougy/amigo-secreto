<script lang="ts">
	// Entrar em um grupo: código digitado (qualquer formato) ou QR. A consulta só roda em /g/<codigo>.
	import { goto } from '$app/navigation';
	import { normalizarCodigo } from '@amigo/dominio';
	import { codigoDeQR } from '#lib/navegacao.js';
	import LeitorQR from '#lib/components/LeitorQR.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	let entrada = $state('');
	let erro = $state<string | null>(null);
	let lendo = $state(false);

	function ir(codigo: string) {
		void goto(`/g/${codigo}`);
	}

	function enviar(e: SubmitEvent) {
		e.preventDefault();
		const codigo = normalizarCodigo(entrada);
		if (!codigo) {
			erro = 'Código inválido';
			return;
		}
		erro = null;
		ir(codigo);
	}

	function aoLer(texto: string) {
		lendo = false;
		const codigo = codigoDeQR(texto);
		if (!codigo) {
			erro = 'Código inválido';
			return;
		}
		erro = null;
		ir(codigo);
	}
</script>

<svelte:head><title>Entrar em um grupo · Amigo Secreto</title></svelte:head>

<div class="mx-auto flex max-w-lg flex-col gap-5">
	<h1 class="text-3xl font-black tracking-tight">Entrar em um grupo</h1>

	<Card.Root class="border-2 bg-card shadow-md">
		<Card.Content class="flex flex-col gap-4 px-4 py-5 sm:px-6">
			<form onsubmit={enviar} class="flex flex-col gap-3" novalidate>
				<div class="flex flex-col gap-1.5">
					<Label for="codigo" class="font-bold">Código do grupo</Label>
					<Input
						id="codigo"
						bind:value={entrada}
						oninput={() => (erro = null)}
						placeholder="KQ7-M4P"
						autocomplete="off"
						autocapitalize="characters"
						spellcheck={false}
						class="border-2 font-mono text-lg tracking-widest"
						aria-invalid={erro ? true : undefined}
						aria-describedby={erro ? 'erro-codigo' : undefined}
					/>
					{#if erro}<p id="erro-codigo" role="alert" class="text-sm font-bold text-destructive">{erro}</p>{/if}
				</div>
				<Button type="submit" class="border-2 font-bold afunda">
					Continuar <ArrowRightIcon />
				</Button>
			</form>

			<div class="flex items-center gap-3 text-xs font-bold tracking-wider text-muted-foreground uppercase">
				<span class="h-0.5 flex-1 bg-border"></span>ou<span class="h-0.5 flex-1 bg-border"></span>
			</div>

			{#if lendo}
				<LeitorQR {aoLer} aoFechar={() => (lendo = false)} />
			{:else}
				<Button variant="outline" class="border-2 font-bold afunda" onclick={() => (lendo = true)}>
					<QrCodeIcon /> Escanear QR
				</Button>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
