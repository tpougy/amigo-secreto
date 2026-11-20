<script lang="ts">
	// Aba Configurações do organizador: capa, dados do grupo, campos do perfil, código/QR, encerrar e apagar.
	import { goto } from '$app/navigation';
	import { id, lookup } from '@instantdb/core';
	import { caminhoCapa, comprimirCapa, ErroImagem, urlCapa } from '#lib/capa.js';
	import Capa from '#lib/components/Capa.svelte';
	import { db } from '#lib/instant.js';
	import { mensagemDeErro } from '#lib/erros.js';
	import { paraInputData, type CampoBruto } from '#lib/grupo/consultas.js';
	import {
		dataIso,
		estadoInicial,
		temOpcoes,
		validarEtapa,
		valorNumerico,
		type CampoEditavel
	} from '#lib/criar/estado.svelte.js';
	import EditorCampos from '#lib/components/EditorCampos.svelte';
	import Compartilhar from '#lib/components/Compartilhar.svelte';
	import ConfirmarAcao from '#lib/components/ConfirmarAcao.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { toast } from 'svelte-sonner';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ImageUpIcon from '@lucide/svelte/icons/image-up';

	type Grupo = {
		id: string;
		titulo: string;
		descricao?: string | null;
		codigo: string;
		status: string;
		dataSorteioPrevista?: string | number | null;
		dataEvento?: string | number | null;
		valorSugerido?: number | null;
		capa?: unknown;
	};

	let { grupo, campos }: { grupo: Grupo; campos: CampoBruto[] } = $props();

	// ---------- Capa ----------
	const temCapa = $derived(!!urlCapa(grupo.capa));
	let enviandoCapa = $state(false);
	let erroCapa = $state<string | null>(null);
	let entradaCapa = $state<HTMLInputElement | null>(null);

	async function aoEscolherCapa(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const arquivo = input.files?.[0];
		input.value = '';
		if (!arquivo) return;
		enviandoCapa = true;
		erroCapa = null;
		try {
			// Comprime no navegador: lado maior 1.600 px, JPEG 0,8 (mira 300–500 KB).
			const jpeg = await comprimirCapa(arquivo);
			const r = await db.storage.uploadFile(caminhoCapa(grupo.id), new File([jpeg], 'capa.jpg', { type: 'image/jpeg' }), {
				contentType: 'image/jpeg'
			});
			await db.transact(db.tx.grupos[grupo.id]!.link({ capa: r.data.id }));
			toast.success(`Capa salva (${Math.round(jpeg.size / 1024)} KB)`);
		} catch (err) {
			erroCapa = err instanceof ErroImagem ? err.message : mensagemDeErro(err);
		} finally {
			enviandoCapa = false;
		}
	}

	async function removerCapa() {
		await db.transact(db.tx.$files[lookup('path', caminhoCapa(grupo.id))]!.delete());
		toast.success('Capa removida');
	}

	// ---------- Dados do grupo ----------
	// svelte-ignore state_referenced_locally (o formulário começa com os valores salvos; "Desfazer" relê)
	let dados = $state(lerDados());
	function lerDados() {
		return {
			titulo: grupo.titulo,
			descricao: grupo.descricao ?? '',
			dataSorteio: paraInputData(grupo.dataSorteioPrevista),
			dataEvento: paraInputData(grupo.dataEvento),
			valor: grupo.valorSugerido != null ? String(grupo.valorSugerido).replace('.', ',') : ''
		};
	}
	let errosDados = $state<string[]>([]);
	let salvandoDados = $state(false);

	async function salvarDados(e: SubmitEvent) {
		e.preventDefault();
		const estado = { ...estadoInicial(), ...dados };
		errosDados = [...validarEtapa(1, estado), ...validarEtapa(2, estado)];
		if (errosDados.length) return;
		salvandoDados = true;
		try {
			const valor = valorNumerico(dados.valor);
			await db.transact(
				db.tx.grupos[grupo.id]!.update({
					titulo: dados.titulo.trim(),
					descricao: dados.descricao.trim() || null,
					dataSorteioPrevista: dados.dataSorteio ? dataIso(dados.dataSorteio) : null,
					dataEvento: dados.dataEvento ? dataIso(dados.dataEvento) : null,
					valorSugerido: valor === null || Number.isNaN(valor) ? null : valor
				})
			);
			toast.success('Dados do grupo salvos');
		} catch (err) {
			errosDados = [mensagemDeErro(err)];
		} finally {
			salvandoDados = false;
		}
	}

	// ---------- Campos do perfil ----------
	function lerCampos(): CampoEditavel[] {
		return [...campos]
			.sort((a, b) => a.ordem - b.ordem)
			.map((c) => ({
				chave: c.id, // campos existentes usam o id real como chave local
				rotulo: c.rotulo,
				ajuda: c.ajuda ?? '',
				tipo: c.tipo as CampoEditavel['tipo'],
				opcoes: Array.isArray(c.opcoes) ? [...(c.opcoes as string[])] : [],
				obrigatorio: c.obrigatorio
			}));
	}
	// svelte-ignore state_referenced_locally
	let editaveis = $state<CampoEditavel[]>(lerCampos());
	let camposEditados = $state(false);
	let errosCampos = $state<string[]>([]);
	let salvandoCampos = $state(false);
	let confirmarRemocao = $state(false);

	const idsExistentes = $derived(new Set(campos.map((c) => c.id)));
	const removidos = $derived([...idsExistentes].filter((i) => !editaveis.some((c) => c.chave === i)));

	// Se os campos mudarem no servidor e não há edição local, recarrega.
	$effect(() => {
		void campos;
		if (!camposEditados) editaveis = lerCampos();
	});

	function pedirSalvarCampos() {
		const estado = { ...estadoInicial(), campos: editaveis };
		errosCampos = validarEtapa(3, estado);
		if (errosCampos.length) return;
		if (removidos.length) confirmarRemocao = true;
		else void salvarCampos().catch((e) => (errosCampos = [mensagemDeErro(e)]));
	}

	async function salvarCampos() {
		salvandoCampos = true;
		try {
			const ops = [
				// Apagar um campo apaga as respostas dele em cascata.
				...removidos.map((cid) => db.tx.campos[cid]!.delete()),
				...editaveis.map((c, i) => {
					const ajuda = c.ajuda.trim();
					const dadosCampo = {
						rotulo: c.rotulo.trim(),
						ajuda: ajuda || null,
						tipo: c.tipo,
						opcoes: temOpcoes(c.tipo) ? c.opcoes.map((o) => o.trim()).filter(Boolean) : null,
						obrigatorio: c.obrigatorio,
						ordem: i
					};
					return idsExistentes.has(c.chave)
						? db.tx.campos[c.chave]!.update(dadosCampo)
						: db.tx.campos[id()]!.create(dadosCampo).link({ grupo: grupo.id });
				})
			];
			await db.transact(ops);
			camposEditados = false;
			errosCampos = [];
			toast.success('Campos do perfil salvos');
		} finally {
			salvandoCampos = false;
		}
	}

	function desfazerCampos() {
		editaveis = lerCampos();
		camposEditados = false;
		errosCampos = [];
	}

	// ---------- Encerrar e apagar ----------
	let confirmarEncerrar = $state(false);
	let confirmarApagar = $state(false);

	async function encerrar() {
		await db.transact(db.tx.grupos[grupo.id]!.update({ status: 'encerrado' }));
		toast.success('Grupo encerrado');
	}
	async function apagar() {
		// A capa não cai em cascata com o grupo: vai na mesma transação.
		await db.transact([
			...(temCapa ? [db.tx.$files[lookup('path', caminhoCapa(grupo.id))]!.delete()] : []),
			db.tx.grupos[grupo.id]!.delete()
		]);
		await goto('/grupos', { replaceState: true });
	}
</script>

<div class="flex flex-col gap-6">
	<section class="flex flex-col gap-4 rounded-xl border-2 bg-card p-4 shadow-md sm:p-5" data-testid="secao-capa">
		<div>
			<h3 class="text-lg font-black">Capa</h3>
			<p class="text-sm text-muted-foreground">Aparece no topo do grupo e no cartão. Só quem participa vê.</p>
		</div>
		<Capa capa={grupo.capa} titulo={grupo.titulo} class="aspect-[3/1] rounded-lg" />
		<input
			bind:this={entradaCapa}
			type="file"
			accept="image/*"
			class="hidden"
			onchange={aoEscolherCapa}
			data-testid="entrada-capa"
		/>
		{#if erroCapa}<p role="alert" class="text-sm font-bold text-destructive">{erroCapa}</p>{/if}
		<div class="flex flex-wrap gap-2">
			<Button class="border-2 font-bold afunda" disabled={enviandoCapa} onclick={() => entradaCapa?.click()}>
				{#if enviandoCapa}<LoaderIcon class="animate-spin" />{:else}<ImageUpIcon />{/if}
				{temCapa ? 'Trocar capa' : 'Enviar capa'}
			</Button>
			{#if temCapa}
				<Button variant="outline" class="border-2 font-bold afunda" disabled={enviandoCapa} onclick={() => void removerCapa().catch((e) => (erroCapa = mensagemDeErro(e)))}>
					Remover capa
				</Button>
			{/if}
		</div>
	</section>

	<form onsubmit={salvarDados} class="flex flex-col gap-4 rounded-xl border-2 bg-card p-4 shadow-md sm:p-5" novalidate>
		<h3 class="text-lg font-black">Dados do grupo</h3>
		<div class="flex flex-col gap-1.5">
			<Label for="cfg-titulo" class="font-bold">Título</Label>
			<Input id="cfg-titulo" bind:value={dados.titulo} maxlength={80} class="border-2" />
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="cfg-descricao" class="font-bold">Descrição (opcional)</Label>
			<Textarea id="cfg-descricao" bind:value={dados.descricao} rows={3} maxlength={500} class="border-2" />
		</div>
		<div class="grid gap-4 sm:grid-cols-3">
			<div class="flex flex-col gap-1.5">
				<Label for="cfg-sorteio" class="font-bold">Sorteio previsto</Label>
				<Input id="cfg-sorteio" type="date" bind:value={dados.dataSorteio} class="border-2" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="cfg-evento" class="font-bold">Evento</Label>
				<Input id="cfg-evento" type="date" bind:value={dados.dataEvento} class="border-2" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="cfg-valor" class="font-bold">Valor sugerido (R$)</Label>
				<Input id="cfg-valor" inputmode="decimal" bind:value={dados.valor} placeholder="Ex.: 50" class="border-2" />
			</div>
		</div>
		{#if errosDados.length}
			<ul role="alert" class="text-sm font-bold text-destructive">
				{#each errosDados as e (e)}<li>{e}</li>{/each}
			</ul>
		{/if}
		<div class="flex flex-wrap gap-2">
			<Button type="submit" class="border-2 font-bold afunda" disabled={salvandoDados}>
				{#if salvandoDados}<LoaderIcon class="animate-spin" />{/if} Salvar dados
			</Button>
			<Button type="button" variant="outline" class="border-2 font-bold afunda" onclick={() => ((dados = lerDados()), (errosDados = []))}>
				Desfazer
			</Button>
		</div>
	</form>

	<section class="flex flex-col gap-4 rounded-xl border-2 bg-card p-4 shadow-md sm:p-5">
		<div>
			<h3 class="text-lg font-black">Campos do perfil</h3>
			<p class="text-sm text-muted-foreground">O que cada participante informa para quem o tirar.</p>
		</div>
		<EditorCampos bind:campos={editaveis} aoEditar={() => (camposEditados = true)} />
		{#if errosCampos.length}
			<ul role="alert" class="text-sm font-bold text-destructive">
				{#each errosCampos as e (e)}<li>{e}</li>{/each}
			</ul>
		{/if}
		<div class="flex flex-wrap gap-2">
			<Button class="border-2 font-bold afunda" disabled={salvandoCampos || !camposEditados} onclick={pedirSalvarCampos}>
				{#if salvandoCampos}<LoaderIcon class="animate-spin" />{/if} Salvar campos
			</Button>
			{#if camposEditados}
				<Button variant="outline" class="border-2 font-bold afunda" onclick={desfazerCampos}>Desfazer</Button>
			{/if}
		</div>
	</section>

	<section class="flex flex-col gap-4 rounded-xl border-2 bg-card p-4 shadow-md sm:p-5">
		<h3 class="text-lg font-black">Código e QR</h3>
		<Compartilhar codigo={grupo.codigo} grupoId={grupo.id} titulo={grupo.titulo} naPaginaDoGrupo />
	</section>

	<section class="flex flex-col gap-4 rounded-xl border-2 border-destructive bg-card p-4 shadow-md sm:p-5">
		<h3 class="text-lg font-black">Zona de perigo</h3>
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p class="font-bold">Encerrar grupo</p>
				<p class="text-sm text-muted-foreground">Ninguém mais entra nem sorteia. Os pares continuam visíveis.</p>
			</div>
			<Button
				variant="outline"
				class="shrink-0 border-2 font-bold afunda"
				disabled={grupo.status === 'encerrado'}
				onclick={() => (confirmarEncerrar = true)}
			>
				<ArchiveIcon /> {grupo.status === 'encerrado' ? 'Grupo encerrado' : 'Encerrar grupo'}
			</Button>
		</div>
		<div class="flex flex-col gap-2 border-t-2 border-dashed pt-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p class="font-bold">Apagar grupo</p>
				<p class="text-sm text-muted-foreground">Apaga tudo: participantes, perfis, restrições e sorteios. Não dá para desfazer.</p>
			</div>
			<Button variant="destructive" class="shrink-0 border-2 font-bold afunda" onclick={() => (confirmarApagar = true)}>
				<Trash2Icon /> Apagar grupo
			</Button>
		</div>
	</section>
</div>

<ConfirmarAcao
	bind:aberto={confirmarRemocao}
	titulo="Remover {removidos.length === 1 ? 'campo' : `${removidos.length} campos`}?"
	texto="As respostas deste campo serão apagadas"
	rotuloConfirmar="Remover e salvar"
	destrutivo
	aoConfirmar={salvarCampos}
/>
<ConfirmarAcao
	bind:aberto={confirmarEncerrar}
	titulo="Encerrar o grupo?"
	texto="O grupo fica só para consulta: ninguém mais entra, sorteia ou refaz o sorteio. Não dá para reabrir."
	rotuloConfirmar="Encerrar grupo"
	aoConfirmar={encerrar}
/>
<ConfirmarAcao
	bind:aberto={confirmarApagar}
	titulo="Apagar o grupo?"
	texto="Tudo será apagado para todos os participantes. Esta ação não pode ser desfeita."
	exigir={grupo.titulo}
	rotuloConfirmar="Apagar para sempre"
	destrutivo
	aoConfirmar={apagar}
/>
