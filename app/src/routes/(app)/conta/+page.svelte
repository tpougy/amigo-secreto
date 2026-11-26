<script lang="ts">
	// Minha conta: e-mail, exportar meus dados (JSON) e apagar minha conta.
	// Apagar cria um `pedidosExclusao`; o worker (handler `exclusao-conta`) faz o resto, como admin,
	// porque o cliente não pode apagar `$users`.
	import { goto } from '$app/navigation';
	import { exclusaoConta } from '@amigo/instant/commands';
	import { sendCommand } from 'instant-commands/client';
	import { db } from '#lib/instant.js';
	import { sairPara, usarSessao } from '#lib/sessao.svelte.js';
	import {
		consultaConta,
		dadosParaPlano,
		montarExportacao,
		nomeArquivoExportacao,
		planoApagarConta,
		resumoPlano,
		type DadosExportacao
	} from '#lib/conta.js';
	import { mensagemDeErro } from '#lib/erros.js';
	import AssistenteIA from '#lib/components/AssistenteIA.svelte';
	import ConfirmarAcao from '#lib/components/ConfirmarAcao.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { toast } from 'svelte-sonner';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import MailIcon from '@lucide/svelte/icons/mail';

	const PALAVRA = 'APAGAR';
	const sessao = usarSessao();
	const consulta = db.useQuery(() => (sessao.usuario ? consultaConta(sessao.usuario.id) : null));
	const dados = $derived((consulta.data?.$users?.[0] ?? null) as DadosExportacao | null);
	const resumo = $derived(dados ? resumoPlano(planoApagarConta(dadosParaPlano(dados))) : null);

	let erroExportar = $state<string | null>(null);
	let confirmarApagar = $state(false);

	function exportar() {
		erroExportar = null;
		if (!dados) return;
		try {
			const agora = new Date();
			const json = JSON.stringify(montarExportacao(dados, agora), null, 2);
			const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
			const a = document.createElement('a');
			a.href = url;
			a.download = nomeArquivoExportacao(agora);
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (e) {
			erroExportar = mensagemDeErro(e);
		}
	}

	async function apagarConta() {
		const uid = sessao.usuario?.id;
		if (!uid) return;
		const pedidoId = await sendCommand(db.core, exclusaoConta, { usuario: uid });
		// Confirma no servidor antes de sair: o signOut descartaria uma transação ainda na fila.
		const r = await db.queryOnce({ pedidosExclusao: { $: { where: { id: pedidoId } } } });
		if (!r.data.pedidosExclusao.length) throw new Error('Não deu para registrar o pedido. Tente de novo.');
		toast.success('Pedido recebido: sua conta será apagada em instantes.');
		await sairPara('/', goto);
	}

	const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
</script>

<svelte:head><title>Minha conta · Amigo Secreto</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-6">
	<h1 class="text-4xl font-black tracking-tighter">Minha conta</h1>

	<section class="flex items-center gap-3 rounded-xl border-2 bg-card p-4 shadow-md">
		<span class="grid size-10 shrink-0 place-items-center rounded-md border-2 bg-ceu text-tinta"><MailIcon /></span>
		<div class="min-w-0">
			<p class="text-xs font-black tracking-wider uppercase">E-mail</p>
			<p class="truncate font-semibold" data-testid="conta-email">{sessao.usuario?.email ?? '—'}</p>
		</div>
	</section>

	<section class="flex flex-col gap-3 rounded-xl border-2 bg-card p-4 shadow-md sm:p-5">
		<h2 class="text-lg font-black">Exportar meus dados</h2>
		<p class="text-sm text-muted-foreground">
			Um arquivo JSON com seu e-mail, seus grupos, suas respostas de perfil e quem você tirou em cada grupo.
			Não inclui dados de outras pessoas.
		</p>
		{#if consulta.isLoading}
			<Skeleton class="h-10 w-48" />
		{:else}
			<Button class="self-start border-2 font-bold afunda" disabled={!dados} onclick={exportar} data-testid="botao-exportar">
				<DownloadIcon /> Baixar meus dados
			</Button>
		{/if}
		{#if erroExportar}<p role="alert" class="text-sm font-bold text-destructive">{erroExportar}</p>{/if}
		{#if consulta.error}<p role="alert" class="text-sm font-bold text-destructive">{consulta.error.message}</p>{/if}
	</section>

	<section class="flex flex-col gap-3 rounded-xl border-2 border-destructive bg-card p-4 shadow-md sm:p-5">
		<h2 class="text-lg font-black">Apagar minha conta</h2>
		<ul class="list-disc pl-5 text-sm" data-testid="resumo-apagar">
			<li>Seu e-mail e suas respostas de perfil são apagados.</li>
			{#if resumo}
				{#if resumo.grupos}
					<li>{plural(resumo.grupos, 'grupo que você organiza é apagado', 'grupos que você organiza são apagados')} para todos.</li>
				{/if}
				{#if resumo.apagadas}
					<li>Você sai de {plural(resumo.apagadas, 'grupo que ainda não sorteou', 'grupos que ainda não sortearam')}.</li>
				{/if}
				{#if resumo.anonimizadas}
					<li>
						Em {plural(resumo.anonimizadas, 'grupo já sorteado', 'grupos já sorteados')}, você vira "Participante removido"
						e o organizador é avisado para refazer o sorteio.
					</li>
				{/if}
				{#if resumo.semRefazer}
					<li>
						{plural(resumo.semRefazer, 'grupo já fez', 'grupos já fizeram')} os 3 sorteios permitidos: lá não dá mais para
						refazer, e quem tirou você fica sem amigo secreto.
					</li>
				{/if}
			{/if}
			<li>Não dá para desfazer.</li>
		</ul>
		<Button
			variant="destructive"
			class="self-start border-2 font-bold afunda"
			disabled={!dados}
			onclick={() => (confirmarApagar = true)}
			data-testid="botao-apagar-conta"
		>
			<Trash2Icon /> Apagar minha conta
		</Button>
	</section>

	<AssistenteIA />
</div>

<ConfirmarAcao
	bind:aberto={confirmarApagar}
	titulo="Apagar sua conta?"
	texto="Sua conta e seus dados serão apagados em instantes. Esta ação não pode ser desfeita."
	exigir={PALAVRA}
	rotuloConfirmar="Apagar minha conta"
	destrutivo
	aoConfirmar={apagarConta}
/>
