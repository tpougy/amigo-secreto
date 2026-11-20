<script module lang="ts">
	export type RestricaoLista = {
		id: string;
		motivo?: string | null;
		participanteA?: { id: string; apelido: string; removido: boolean } | null;
		participanteB?: { id: string; apelido: string; removido: boolean } | null;
	};
</script>

<script lang="ts">
	// Restrições do sorteio ("A e B não se tiram", nos dois sentidos). Só o organizador vê e edita;
	// fica na aba Sorteio antes do primeiro sorteio e entre rodadas. Restrições com removidos
	// ou com quem saiu do grupo (link vazio) aparecem marcadas e são ignoradas pelo worker.
	import { id } from '@instantdb/core';
	import { db } from '#lib/instant.js';
	import { mensagemDeErro } from '#lib/erros.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';

	let {
		grupoId,
		participantes,
		restricoes,
		editavel
	}: {
		grupoId: string;
		/** Participantes ativos (não removidos). */
		participantes: { id: string; apelido: string }[];
		restricoes: RestricaoLista[];
		editavel: boolean;
	} = $props();

	let a = $state('');
	let b = $state('');
	let motivo = $state('');
	let salvando = $state(false);
	let erro = $state<string | null>(null);

	const ordenados = $derived([...participantes].sort((x, y) => x.apelido.localeCompare(y.apelido, 'pt-BR')));
	const jaExiste = $derived(
		restricoes.some((r) => {
			const ids = [r.participanteA?.id, r.participanteB?.id];
			return ids.includes(a) && ids.includes(b);
		})
	);

	async function adicionar(e: SubmitEvent) {
		e.preventDefault();
		erro = null;
		if (!a || !b) return void (erro = 'Escolha as duas pessoas.');
		if (a === b) return void (erro = 'Escolha duas pessoas diferentes.');
		if (jaExiste) return void (erro = 'Essa restrição já existe.');
		salvando = true;
		// Limpa o formulário já (a lista atualiza otimista); se falhar, devolve o que foi digitado.
		const [pa, pb, m] = [a, b, motivo.trim()];
		a = b = motivo = '';
		try {
			await db.transact(
				db.tx.restricoes[id()]!.create(m ? { motivo: m } : {}).link({ grupo: grupoId, participanteA: pa, participanteB: pb })
			);
		} catch (err) {
			[a, b, motivo] = [pa, pb, m];
			erro = mensagemDeErro(err);
		} finally {
			salvando = false;
		}
	}

	async function apagar(r: RestricaoLista) {
		erro = null;
		try {
			await db.transact(db.tx.restricoes[r.id]!.delete());
		} catch (err) {
			erro = mensagemDeErro(err);
		}
	}
</script>

<section class="flex flex-col gap-3" aria-labelledby="titulo-restricoes">
	<div>
		<h3 id="titulo-restricoes" class="text-lg font-black">Restrições</h3>
		<p class="text-sm text-muted-foreground">Pessoas que não podem se tirar (nos dois sentidos), como casais.</p>
	</div>

	{#if restricoes.length === 0}
		<p class="rounded-xl border-2 border-dashed bg-muted px-3 py-2 text-sm font-semibold">Nenhuma restrição.</p>
	{:else}
		<ul class="flex flex-col gap-2" data-testid="lista-restricoes">
			{#each restricoes as r (r.id)}
				{@const orfa = !r.participanteA || !r.participanteB || r.participanteA.removido || r.participanteB.removido}
				<li class="flex items-center gap-2 rounded-xl border-2 bg-card px-3 py-2 shadow-sm {orfa ? 'opacity-60' : ''}">
					<div class="min-w-0 flex-1">
						<p class="font-bold break-words">
							{r.participanteA?.apelido ?? '?'} <span class="font-black text-muted-foreground">×</span>
							{r.participanteB?.apelido ?? '?'}
						</p>
						{#if r.motivo}<p class="text-xs text-muted-foreground">{r.motivo}</p>{/if}
						{#if orfa}<p class="text-xs font-bold">Ignorada: alguém saiu ou foi removido.</p>{/if}
					</div>
					{#if editavel}
						<Button
							variant="outline"
							size="icon-sm"
							class="afunda"
							aria-label="Apagar restrição"
							onclick={() => apagar(r)}><XIcon /></Button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if editavel}
		<form onsubmit={adicionar} class="flex flex-col gap-3 rounded-xl border-2 bg-muted/50 p-3" novalidate>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1">
					<Label for="restricao-a" class="font-bold">Pessoa</Label>
					<select id="restricao-a" bind:value={a} class="h-9 rounded-md border-2 bg-background px-2 text-sm font-semibold">
						<option value="">Escolha...</option>
						{#each ordenados as p (p.id)}<option value={p.id}>{p.apelido}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<Label for="restricao-b" class="font-bold">Não tira (nem é tirada por)</Label>
					<select id="restricao-b" bind:value={b} class="h-9 rounded-md border-2 bg-background px-2 text-sm font-semibold">
						<option value="">Escolha...</option>
						{#each ordenados as p (p.id)}<option value={p.id} disabled={p.id === a}>{p.apelido}</option>{/each}
					</select>
				</div>
			</div>
			<div class="flex flex-col gap-1">
				<Label for="restricao-motivo" class="font-bold">Motivo (opcional)</Label>
				<Input id="restricao-motivo" bind:value={motivo} maxlength={80} placeholder="Ex.: são casados" class="border-2" />
			</div>
			{#if erro}<p role="alert" class="text-sm font-bold text-destructive">{erro}</p>{/if}
			<Button type="submit" variant="outline" class="self-start border-2 font-bold afunda" disabled={salvando}>
				{#if salvando}<LoaderIcon class="animate-spin" />{:else}<PlusIcon />{/if}
				Adicionar restrição
			</Button>
		</form>
	{:else if erro}
		<p role="alert" class="text-sm font-bold text-destructive">{erro}</p>
	{/if}
</section>
