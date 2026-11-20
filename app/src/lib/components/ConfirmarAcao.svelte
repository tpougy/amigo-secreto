<script lang="ts">
	// Diálogo de confirmação reutilizável. Com `exigir`, o botão só habilita depois de digitar o texto
	// exato (confirmação forte: "REFAZER", o título do grupo...). `aoConfirmar` pode ser assíncrono;
	// se lançar, a mensagem aparece no diálogo e ele continua aberto.
	import type { Snippet } from 'svelte';
	import { mensagemDeErro } from '#lib/erros.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';

	let {
		aberto = $bindable(false),
		titulo,
		texto,
		exigir,
		rotuloConfirmar = 'Confirmar',
		destrutivo = false,
		aoConfirmar,
		children
	}: {
		aberto?: boolean;
		titulo: string;
		texto: string;
		exigir?: string;
		rotuloConfirmar?: string;
		destrutivo?: boolean;
		aoConfirmar: () => unknown | Promise<unknown>;
		children?: Snippet;
	} = $props();

	let digitado = $state('');
	let ocupado = $state(false);
	let erro = $state<string | null>(null);
	const liberado = $derived(!exigir || digitado.trim() === exigir);

	$effect(() => {
		if (aberto) {
			digitado = '';
			erro = null;
		}
	});

	async function confirmar(e: SubmitEvent) {
		e.preventDefault();
		if (!liberado || ocupado) return;
		ocupado = true;
		erro = null;
		try {
			await aoConfirmar();
			aberto = false;
		} catch (err) {
			erro = mensagemDeErro(err);
		} finally {
			ocupado = false;
		}
	}
</script>

<Dialog.Root bind:open={aberto}>
	<Dialog.Content class="border-2">
		<form onsubmit={confirmar} class="flex flex-col gap-4" novalidate>
			<Dialog.Header>
				<Dialog.Title class="pr-6 font-black">{titulo}</Dialog.Title>
				<Dialog.Description class="text-foreground" data-testid="confirmar-texto">{texto}</Dialog.Description>
			</Dialog.Header>
			{@render children?.()}
			{#if exigir}
				<div class="flex flex-col gap-1.5">
					<Label for="confirmar-digitar" class="font-bold">
						Digite <span class="font-mono font-black">{exigir}</span> para confirmar
					</Label>
					<Input id="confirmar-digitar" bind:value={digitado} autocomplete="off" class="border-2" />
				</div>
			{/if}
			{#if erro}<p role="alert" class="text-sm font-bold text-destructive">{erro}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" class="font-bold afunda" onclick={() => (aberto = false)}>
					Cancelar
				</Button>
				<Button
					type="submit"
					variant={destrutivo ? 'destructive' : 'default'}
					class="font-bold afunda"
					disabled={!liberado || ocupado}
				>
					{#if ocupado}<LoaderIcon class="animate-spin" />{/if}
					{rotuloConfirmar}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
