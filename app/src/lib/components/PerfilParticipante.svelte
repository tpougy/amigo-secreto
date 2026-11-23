<script lang="ts">
	// Diálogo com o perfil de outro participante (só quando o organizador liga `perfisVisiveis`).
	// As regras do Instant recortam: com a opção desligada, as respostas vêm vazias.
	// A consulta segue o último participante aberto (não só `aberto`), para não piscar ao fechar.
	import type { DefCampo } from '@amigo/dominio';
	import { db } from '#lib/instant.js';
	import { respostasVisiveis } from '#lib/grupo/consultas.js';
	import RespostasPerfil from '#lib/components/RespostasPerfil.svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';

	let {
		aberto = $bindable(false),
		participante,
		campos
	}: {
		aberto?: boolean;
		participante: { id: string; apelido: string } | null;
		campos: DefCampo[];
	} = $props();

	const consulta = db.useQuery(() =>
		participante
			? { participantes: { $: { where: { id: participante.id } }, respostas: { campo: {} } } }
			: null
	);
	const respostas = $derived(
		respostasVisiveis(campos, consulta.data?.participantes?.[0]?.respostas ?? [])
	);
</script>

<Dialog.Root bind:open={aberto}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto border-2" data-testid="perfil-participante">
		<Dialog.Header>
			<Dialog.Title class="pr-6 text-2xl font-black">{participante?.apelido ?? ''}</Dialog.Title>
			<Dialog.Description>Perfil no grupo</Dialog.Description>
		</Dialog.Header>
		{#if consulta.isLoading}
			<LoaderIcon class="size-6 animate-spin" />
		{:else if respostas.length === 0}
			<p class="rounded-xl border-2 border-dashed px-3 py-2 text-sm font-semibold">Ainda não preencheu o perfil.</p>
		{:else}
			<RespostasPerfil {respostas} />
		{/if}
	</Dialog.Content>
</Dialog.Root>
