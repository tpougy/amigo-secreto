<script lang="ts">
	// Página do grupo. Organizador: abas Participantes · Meu perfil · Sorteio · Configurações.
	// Participante: informações, participantes, meu perfil e "aguardando sorteio"; depois do sorteio,
	// "Você tirou" no topo (o organizador também participa, então também vê o próprio par).
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { TEMAS } from '@amigo/dominio';
	import { db } from '#lib/instant.js';
	import { usarSessao } from '#lib/sessao.svelte.js';
	import { consultaGrupo, dataBr, emAndamento, paraDefCampos, reabertoEm } from '#lib/grupo/consultas.js';
	import {
		AVISO_DESFEITO,
		bannerRemovidoAposSorteio,
		estadoParaParticipante,
		foraDoSorteio,
		LIMITE_RODADAS,
		rodadasNestaAbertura,
		textoBannerRemovido
	} from '#lib/grupo/regras.js';
	import Participantes from '#lib/components/Participantes.svelte';
	import PainelSorteio from '#lib/components/PainelSorteio.svelte';
	import VoceTirou from '#lib/components/VoceTirou.svelte';
	import ConfiguracoesGrupo from '#lib/components/ConfiguracoesGrupo.svelte';
	import FormularioPerfil from '#lib/components/FormularioPerfil.svelte';
	import Capa from '#lib/components/Capa.svelte';
	import ConfirmarAcao from '#lib/components/ConfirmarAcao.svelte';
	import SeloStatus from '#lib/components/selo-status.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { toast } from 'svelte-sonner';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import HourglassIcon from '@lucide/svelte/icons/hourglass';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import LogOutIcon from '@lucide/svelte/icons/log-out';

	const sessao = usarSessao();
	const grupoId = $derived(page.params.id ?? '');

	const consulta = db.useQuery(() =>
		sessao.usuario && grupoId ? consultaGrupo(grupoId, sessao.usuario.id) : null
	);

	const grupo = $derived(consulta.data?.grupos?.[0] ?? null);
	const eu = $derived(consulta.data?.participantes?.[0] ?? null);
	const souOrganizador = $derived(!!grupo && !!sessao.usuario && grupo.organizador?.id === sessao.usuario.id);
	const campos = $derived(paraDefCampos(grupo?.campos ?? []));
	const participantes = $derived(grupo?.participantes ?? []);
	const sorteios = $derived(grupo?.sorteios ?? []);
	const restricoes = $derived(grupo?.restricoes ?? []);
	const reaberturas = $derived(grupo?.reaberturas ?? []);
	const andamento = $derived(emAndamento(sorteios));
	const encerrado = $derived(grupo?.status === 'encerrado');
	// Já houve sorteio e ele vale (reabrir devolve o grupo a `aberto` e apaga os pares).
	const sorteado = $derived((grupo?.rodadaAtual ?? 0) >= 1 && grupo?.status !== 'aberto');
	const banner = $derived(
		souOrganizador && !!grupo && bannerRemovidoAposSorteio(grupo.status, grupo.rodadaAtual, participantes)
	);
	// Meu par da rodada atual (os pares antigos são apagados pelo worker ao refazer).
	const meuPar = $derived(
		grupo && eu?.doando?.receptor && eu.doando.sorteio?.rodada === grupo.rodadaAtual ? eu.doando : null
	);
	// Sorteado, sou participante ativo e não tenho par: entrei depois ou o sorteio rodou sem mim.
	const semParNoSorteio = $derived(
		!!grupo &&
			foraDoSorteio({
				status: grupo.status,
				rodadaAtual: grupo.rodadaAtual,
				souParticipanteAtivo: !!eu && !eu.removido,
				temPar: !!meuPar,
				andamento
			})
	);
	// Grupo reaberto: o sorteio anterior foi desfeito e o novo ainda não saiu.
	// Retardatário (entrou depois de reabrir) não vê o aviso: para ele, só falta o sorteio.
	const desfeito = $derived(
		!!grupo && estadoParaParticipante(grupo, !!meuPar, eu, reabertoEm(reaberturas)) === 'desfeito'
	);
	const minhasRespostas = $derived(
		(eu?.respostas ?? []).flatMap((r) => (r.campo ? [{ id: r.id, campoId: r.campo.id, valor: r.valor }] : []))
	);
	const tema = $derived(TEMAS.find((t) => t.id === grupo?.tema)?.nome ?? grupo?.tema);
	const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

	let aba = $state('participantes');
	let refazerAberto = $state(false);

	function irParaRefazer() {
		aba = 'sorteio';
		refazerAberto = true;
	}

	// Sair do grupo: só antes do sorteio (a regra também exige o grupo aberto). Apaga a própria
	// participação; respostas e restrições vão em cascata, e dá para voltar com o código.
	const podeSair = $derived(!!grupo && grupo.status === 'aberto' && !andamento);
	let sairAberto = $state(false);
	async function sairDoGrupo() {
		if (!eu) return;
		await db.transact(db.tx.participantes[eu.id]!.delete());
		toast.success('Você saiu do grupo');
		await goto('/grupos', { replaceState: true });
	}
</script>

<svelte:head><title>{grupo?.titulo ?? 'Grupo'} · Amigo Secreto</title></svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-5">
	{#if consulta.isLoading}
		<div class="flex flex-col gap-4" aria-busy="true">
			<Skeleton class="h-10 w-72" />
			<Skeleton class="h-40 w-full" />
			<Skeleton class="h-64 w-full" />
		</div>
	{:else if consulta.error}
		<p role="alert" class="font-bold text-destructive">{consulta.error.message}</p>
	{:else if !grupo}
		<Card.Root class="border-2 bg-card shadow-md">
			<Card.Content class="flex flex-col gap-3 px-4 py-5">
				<h1 class="text-2xl font-black">Grupo não encontrado</h1>
				<p class="text-muted-foreground">O grupo não existe mais ou você não faz parte dele.</p>
				<Button href="/grupos" class="self-start border-2 font-bold afunda">Meus grupos</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<Capa capa={grupo.capa} titulo={grupo.titulo} class="aspect-[3/1] rounded-2xl shadow-md" />
		<header class="flex flex-col gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<SeloStatus status={grupo.status} />
				<span class="rounded-sm border-2 bg-ceu px-1.5 text-xs font-bold text-tinta">{tema}</span>
				{#if souOrganizador}
					<span class="rounded-sm border-2 bg-background px-1.5 text-xs font-bold">Você organiza</span>
				{/if}
			</div>
			<h1 class="text-3xl font-black tracking-tight break-words sm:text-4xl" data-testid="grupo-titulo">{grupo.titulo}</h1>
			{#if grupo.organizadorApelido}
				<p class="text-sm font-semibold text-muted-foreground" data-testid="grupo-organizador">
					Organizado por {grupo.organizadorApelido}
				</p>
			{/if}
		</header>

		{#if banner}
			<div class="flex flex-col gap-3 rounded-xl border-2 bg-amber-200 p-4 text-tinta shadow-md sm:flex-row sm:items-center" role="alert" data-testid="banner-removido">
				<TriangleAlertIcon class="size-6 shrink-0" />
				<p class="flex-1 font-bold">{textoBannerRemovido(grupo.rodadaAtual, grupo.rodadaBase)}</p>
				{#if rodadasNestaAbertura(grupo) < LIMITE_RODADAS}
					<Button class="shrink-0 border-2 font-bold afunda" onclick={irParaRefazer}>Refazer sorteio</Button>
				{/if}
			</div>
		{/if}

		{#if encerrado}
			<div class="flex items-center gap-3 rounded-xl border-2 bg-neutral-200 p-3 font-bold text-neutral-800">
				<ArchiveIcon class="shrink-0" /> Este grupo foi encerrado.
			</div>
		{/if}

		<!-- Topo: meu par, ou o aviso de espera -->
		{#if eu && sorteado && andamento}
			<div class="flex items-center gap-3 rounded-2xl border-2 bg-ceu p-4 text-tinta shadow-md" data-testid="refazendo">
				<LoaderIcon class="size-6 shrink-0 animate-spin" />
				<p class="font-bold">O sorteio está sendo refeito. Seu par vai mudar: volte em instantes.</p>
			</div>
		{:else if eu && meuPar?.receptor}
			<!-- Uma rodada nova recomeça embrulhada. -->
			{#key grupo.rodadaAtual}
				<VoceTirou
					meuParticipanteId={eu.id}
					viuParNaRodada={eu.viuParNaRodada}
					rodadaAtual={grupo.rodadaAtual}
					receptor={{ apelido: meuPar.receptor.apelido, respostas: meuPar.receptor.respostas ?? [] }}
					{campos}
				/>
			{/key}
		{:else if semParNoSorteio}
			<div class="flex items-center gap-3 rounded-2xl border-2 bg-amber-200 p-4 text-tinta shadow-md" role="status" data-testid="fora-do-sorteio">
				<TriangleAlertIcon class="size-6 shrink-0" />
				<p class="font-bold">Você não está neste sorteio. Peça ao organizador para refazer.</p>
			</div>
		{:else if eu && desfeito && !andamento && !souOrganizador}
			<div class="flex items-center gap-3 rounded-2xl border-2 bg-amber-200 p-4 text-tinta shadow-md" role="status" data-testid="sorteio-desfeito">
				<TriangleAlertIcon class="size-6 shrink-0" />
				<p class="font-bold">{AVISO_DESFEITO}</p>
			</div>
		{:else if eu && !sorteado && !souOrganizador}
			<div class="flex items-center gap-3 rounded-2xl border-2 bg-primary p-4 shadow-md" data-testid="aguardando">
				<HourglassIcon class="size-7 shrink-0" />
				<p class="text-lg font-black">
					{#if andamento}
						Sorteando agora...
					{:else}
						Aguardando sorteio{#if grupo.dataSorteioPrevista} — previsto para {dataBr(grupo.dataSorteioPrevista)}{/if}
					{/if}
				</p>
			</div>
		{/if}

		{#if souOrganizador}
			<Tabs.Root bind:value={aba} class="gap-4">
				<Tabs.List class="h-auto flex-wrap border-2 bg-card shadow-sm">
					<Tabs.Trigger value="participantes" class="font-bold">Participantes</Tabs.Trigger>
					<Tabs.Trigger value="perfil" class="font-bold">Meu perfil</Tabs.Trigger>
					<Tabs.Trigger value="sorteio" class="font-bold">Sorteio</Tabs.Trigger>
					<Tabs.Trigger value="configuracoes" class="font-bold">Configurações</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="participantes">
					<Participantes
						{participantes}
						meuParticipanteId={eu?.id ?? null}
						souOrganizador
						rodadaAtual={grupo.rodadaAtual}
						rodadaBase={grupo.rodadaBase}
						status={grupo.status}
						campoIds={campos.map((c) => c.id)}
						bloqueado={andamento || encerrado}
						aoRemoverAposSorteio={irParaRefazer}
					/>
				</Tabs.Content>
				<Tabs.Content value="perfil">
					{@render meuPerfil()}
				</Tabs.Content>
				<Tabs.Content value="sorteio">
					<PainelSorteio {grupo} {sorteios} {reaberturas} {participantes} {restricoes} bind:refazerAberto />
				</Tabs.Content>
				<Tabs.Content value="configuracoes">
					<ConfiguracoesGrupo {grupo} campos={grupo.campos ?? []} />
				</Tabs.Content>
			</Tabs.Root>
		{:else}
			{@render informacoes()}
			<section class="flex flex-col gap-3">
				<h2 class="text-xl font-black">Participantes</h2>
				<Participantes
					{participantes}
					meuParticipanteId={eu?.id ?? null}
					souOrganizador={false}
					rodadaAtual={grupo.rodadaAtual}
					rodadaBase={grupo.rodadaBase}
					status={grupo.status}
					campoIds={[]}
				/>
			</section>
			<section class="flex flex-col gap-3">
				<h2 class="text-xl font-black">Meu perfil</h2>
				{@render meuPerfil()}
			</section>
		{/if}
	{/if}
</div>

{#snippet informacoes()}
	{#if grupo && (grupo.descricao || grupo.dataSorteioPrevista || grupo.dataEvento || grupo.valorSugerido != null)}
		<Card.Root class="border-2 bg-card shadow-md">
			<Card.Content class="flex flex-col gap-3 px-4 py-5 sm:px-6">
				{#if grupo.descricao}<p class="whitespace-pre-line">{grupo.descricao}</p>{/if}
				<dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
					{#if grupo.dataSorteioPrevista}
						<div><dt class="font-bold">Sorteio previsto</dt><dd>{dataBr(grupo.dataSorteioPrevista)}</dd></div>
					{/if}
					{#if grupo.dataEvento}
						<div><dt class="font-bold">Evento</dt><dd>{dataBr(grupo.dataEvento)}</dd></div>
					{/if}
					{#if grupo.valorSugerido != null}
						<div><dt class="font-bold">Valor sugerido</dt><dd>{brl.format(grupo.valorSugerido)}</dd></div>
					{/if}
				</dl>
			</Card.Content>
		</Card.Root>
	{/if}
{/snippet}

{#snippet meuPerfil()}
	{#if !eu}
		<p class="rounded-xl border-2 border-dashed bg-muted p-4 text-sm font-semibold">Você não participa do sorteio deste grupo.</p>
	{:else}
		<Card.Root class="border-2 bg-card shadow-md">
			<Card.Content class="flex flex-col gap-4 px-4 py-5 sm:px-6">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-sm text-muted-foreground">Quem tirar você vai ver estas respostas depois do sorteio.</p>
					{#if eu.perfilCompleto}
						<span class="rounded-sm border-2 bg-lima px-1.5 text-[0.65rem] font-bold text-tinta uppercase">perfil completo</span>
					{:else}
						<span class="rounded-sm border-2 bg-amber-200 px-1.5 text-[0.65rem] font-bold text-tinta uppercase">perfil incompleto</span>
					{/if}
				</div>
				{#key `${eu.id}:${minhasRespostas.map((r) => r.id).sort().join(',')}`}
					<FormularioPerfil
						participanteId={eu.id}
						{campos}
						respostas={minhasRespostas}
						aoSalvar={() => toast.success('Perfil salvo')}
					/>
				{/key}
				{#if !souOrganizador}
					<div class="flex flex-col gap-2 border-t-2 border-dashed pt-4" data-testid="sair-grupo">
						{#if podeSair}
							<Button variant="outline" class="self-start border-2 font-bold afunda" onclick={() => (sairAberto = true)}>
								<LogOutIcon /> Sair do grupo
							</Button>
						{:else if sorteado}
							<p class="text-sm font-semibold text-muted-foreground">Para sair depois do sorteio, peça ao organizador</p>
						{/if}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
		<ConfirmarAcao
			bind:aberto={sairAberto}
			titulo="Sair do grupo?"
			texto="Sua participação e as respostas do seu perfil neste grupo serão apagadas. Para voltar, basta usar o código de novo."
			rotuloConfirmar="Sair do grupo"
			destrutivo
			aoConfirmar={sairDoGrupo}
		/>
	{/if}
{/snippet}
