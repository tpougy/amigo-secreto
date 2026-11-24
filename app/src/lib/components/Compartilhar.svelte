<script lang="ts">
	// Tela final do assistente: código grande, QR do link, copiar, Web Share e "Ir para o grupo".
	import QRCode from 'qrcode';
	import { formatarCodigo } from '@amigo/dominio';
	import { linkConvite } from '#lib/navegacao.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Share2Icon from '@lucide/svelte/icons/share-2';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	let {
		codigo,
		grupoId,
		titulo,
		naPaginaDoGrupo = false
	}: {
		codigo: string;
		grupoId: string;
		titulo: string;
		/** Nas configurações do grupo: sem "Grupo criado!" e sem o botão "Ir para o grupo". */
		naPaginaDoGrupo?: boolean;
	} = $props();

	// QR aponta direto para /g/ (a câmera abre sem prévia); o link copiado/compartilhado é o de convite.
	const linkQR = $derived(`${window.location.origin}/g/${codigo}`);
	const link = $derived(linkConvite(window.location.origin, codigo));
	let svg = $state('');
	let copiado = $state(false);
	let erro = $state<string | null>(null);
	const podeCompartilhar = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	$effect(() => {
		let ativo = true;
		QRCode.toString(linkQR, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: 240 }).then(
			(s) => {
				if (ativo) svg = s;
			},
			() => {
				if (ativo) erro = 'Não foi possível gerar o QR Code. Use o código ou o link.';
			}
		);
		return () => (ativo = false);
	});

	async function copiar() {
		try {
			await navigator.clipboard.writeText(link);
			copiado = true;
			erro = null;
			setTimeout(() => (copiado = false), 2000);
		} catch {
			erro = 'Não foi possível copiar. Selecione o link e copie manualmente.';
		}
	}

	async function compartilhar() {
		try {
			await navigator.share({
				title: titulo,
				text: `Entre no amigo secreto "${titulo}" com o código ${formatarCodigo(codigo)}:`,
				url: link
			});
		} catch (e) {
			if ((e as { name?: string })?.name !== 'AbortError') erro = 'Não foi possível compartilhar.';
		}
	}
</script>

<div class="flex flex-col items-center gap-5 text-center">
	<div>
		<p class="text-sm font-bold text-muted-foreground">
			{naPaginaDoGrupo ? 'Convide a turma com o código:' : 'Grupo criado! Convide a turma com o código:'}
		</p>
		<p
			data-testid="codigo"
			class="mt-2 inline-block rounded-xl border-2 bg-primary px-5 py-2 font-mono text-5xl font-black tracking-widest shadow-md sm:text-6xl"
		>
			{formatarCodigo(codigo)}
		</p>
	</div>

	<div class="rounded-xl border-2 bg-white p-3 shadow-md" aria-label="QR Code do link do grupo" role="img">
		{#if svg}
			<div class="size-56 sm:size-60 [&>svg]:size-full" data-testid="qr">{@html svg}</div>
		{:else}
			<div class="grid size-56 place-items-center text-sm font-semibold text-neutral-500 sm:size-60">
				Gerando QR Code...
			</div>
		{/if}
	</div>

	<p class="max-w-full rounded-md border-2 bg-muted px-3 py-1.5 font-mono text-xs font-semibold break-all select-all">
		{link}
	</p>

	<div class="flex flex-wrap justify-center gap-2">
		<Button variant="outline" class="font-bold afunda" onclick={copiar}>
			{#if copiado}<CheckIcon /> Copiado!{:else}<CopyIcon /> Copiar link{/if}
		</Button>
		{#if podeCompartilhar}
			<Button variant="secondary" class="font-bold afunda" onclick={compartilhar}>
				<Share2Icon /> Compartilhar
			</Button>
		{/if}
		{#if !naPaginaDoGrupo}
			<Button href={`/grupos/${grupoId}`} class="font-bold afunda">
				Ir para o grupo <ArrowRightIcon />
			</Button>
		{/if}
	</div>

	{#if erro}
		<p role="alert" class="text-sm font-bold text-destructive">{erro}</p>
	{/if}
</div>
