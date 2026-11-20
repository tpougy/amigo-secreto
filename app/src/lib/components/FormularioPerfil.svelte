<script module lang="ts">
	export type RespostaSalva = { id: string; campoId: string; valor: unknown };
</script>

<script lang="ts">
	// Perfil do participante: um campo por `DefCampo` do grupo, na ordem. Valida com `validarResposta`,
	// grava as respostas (upsert por `chave` única), apaga as esvaziadas e recalcula `perfilCompleto`.
	import { id, lookup } from '@instantdb/core';
	import { limparRespostas, perfilCompleto, validarResposta, type DefCampo, type ValorResposta } from '@amigo/dominio';
	import { db } from '#lib/instant.js';
	import { mensagemDeErro } from '#lib/erros.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';

	let {
		participanteId,
		campos,
		respostas,
		aoSalvar
	}: {
		participanteId: string;
		campos: DefCampo[];
		respostas: RespostaSalva[];
		aoSalvar: () => void;
	} = $props();

	const ordenados = $derived([...campos].sort((a, b) => a.ordem - b.ordem));

	// Valores brutos dos campos: texto, ou lista de strings (lista, múltipla).
	function inicial(): Record<string, string | string[]> {
		const v: Record<string, string | string[]> = {};
		for (const c of campos) {
			const salvo = respostas.find((r) => r.campoId === c.id)?.valor;
			if (c.tipo === 'lista') v[c.id] = Array.isArray(salvo) ? salvo.map(String) : [''];
			else if (c.tipo === 'multipla') v[c.id] = Array.isArray(salvo) ? salvo.map(String) : [];
			else v[c.id] = typeof salvo === 'string' ? salvo : '';
		}
		return v;
	}
	let valores = $state<Record<string, string | string[]>>(inicial());
	let erros = $state<Record<string, string>>({});
	let erroGeral = $state<string | null>(null);
	let salvando = $state(false);

	function alternar(c: DefCampo, opcao: string, marcado: boolean) {
		const atual = valores[c.id] as string[];
		valores[c.id] = marcado ? [...atual.filter((o) => o !== opcao), opcao] : atual.filter((o) => o !== opcao);
	}

	async function salvar(e: SubmitEvent) {
		e.preventDefault();
		if (salvando) return;
		erroGeral = null;
		const novosErros: Record<string, string> = {};
		const limpas: Record<string, ValorResposta> = {};
		for (const c of ordenados) {
			const r = validarResposta(c, valores[c.id]);
			if (!r.ok) novosErros[c.id] = r.erro;
		}
		erros = novosErros;
		if (Object.keys(novosErros).length > 0) return;
		Object.assign(limpas, limparRespostas(ordenados, valores));

		salvando = true;
		try {
			const ops: Parameters<typeof db.transact>[0] = [];
			for (const c of ordenados) {
				const existente = respostas.find((r) => r.campoId === c.id);
				const valor = limpas[c.id];
				if (valor === undefined) {
					if (existente) ops.push(db.tx.respostas[existente.id]!.delete());
					continue;
				}
				if (existente) {
					ops.push(db.tx.respostas[existente.id]!.update({ valor }));
				} else {
					const chave = `${participanteId}:${c.id}`;
					// Upsert por chave única: `update({})` com lookup cria (ou reaproveita) e os links entram junto.
					ops.push(
						db.tx.respostas[lookup('chave', chave)]!.update({ valor }).link({
							participante: participanteId,
							campo: c.id
						})
					);
				}
			}
			ops.push(
				db.tx.participantes[participanteId]!.update({ perfilCompleto: perfilCompleto(ordenados, limpas) })
			);
			await db.transact(ops);
			aoSalvar();
		} catch (err) {
			erroGeral = mensagemDeErro(err);
		} finally {
			salvando = false;
		}
	}
</script>

<form onsubmit={salvar} class="flex flex-col gap-5" novalidate>
	{#each ordenados as c (c.id)}
		<div class="flex flex-col gap-1.5">
			{#if c.tipo === 'multipla' || c.tipo === 'unica' || c.tipo === 'lista'}
				<span id="rot-{c.id}" class="text-sm font-bold">
					{c.rotulo}{#if c.obrigatorio}<span class="text-destructive"> *</span>{/if}
				</span>
			{:else}
				<Label for="campo-{c.id}" class="font-bold">
					{c.rotulo}{#if c.obrigatorio}<span class="text-destructive"> *</span>{/if}
				</Label>
			{/if}
			{#if c.ajuda}<span class="text-xs text-muted-foreground">{c.ajuda}</span>{/if}

			{#if c.tipo === 'texto-curto'}
				<Input id="campo-{c.id}" bind:value={valores[c.id] as string} maxlength={120} class="border-2" />
			{:else if c.tipo === 'texto-longo'}
				<Textarea id="campo-{c.id}" bind:value={valores[c.id] as string} rows={4} maxlength={2000} class="border-2" />
			{:else if c.tipo === 'lista'}
				<div class="flex flex-col gap-2" aria-labelledby="rot-{c.id}" role="group">
					{#each valores[c.id] as string[] as _, k (k)}
						<div class="flex items-center gap-2">
							<Input
								bind:value={(valores[c.id] as string[])[k]}
								maxlength={120}
								aria-label="{c.rotulo}, item {k + 1}"
								class="border-2"
							/>
							<Button
								type="button"
								variant="outline"
								size="icon-sm"
								class="afunda"
								aria-label="Remover item {k + 1} de {c.rotulo}"
								onclick={() => (valores[c.id] = (valores[c.id] as string[]).filter((_, j) => j !== k))}
							>
								<XIcon />
							</Button>
						</div>
					{/each}
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="self-start border-2 font-bold afunda"
						onclick={() => (valores[c.id] = [...(valores[c.id] as string[]), ''])}
					>
						<PlusIcon /> Adicionar item
					</Button>
				</div>
			{:else if c.tipo === 'multipla'}
				<div class="flex flex-col gap-2" role="group" aria-labelledby="rot-{c.id}">
					{#each c.opcoes ?? [] as o (o)}
						<div class="flex items-center gap-2">
							<Checkbox
								id="op-{c.id}-{o}"
								class="size-5 border-2"
								checked={(valores[c.id] as string[]).includes(o)}
								onCheckedChange={(v) => alternar(c, o, v === true)}
							/>
							<Label for="op-{c.id}-{o}" class="font-medium">{o}</Label>
						</div>
					{/each}
				</div>
			{:else if c.tipo === 'unica'}
				<RadioGroup.Root bind:value={valores[c.id] as string} class="flex flex-col gap-2" aria-labelledby="rot-{c.id}">
					{#each c.opcoes ?? [] as o (o)}
						<div class="flex items-center gap-2">
							<RadioGroup.Item id="op-{c.id}-{o}" value={o} class="size-5 border-2" />
							<Label for="op-{c.id}-{o}" class="font-medium">{o}</Label>
						</div>
					{/each}
				</RadioGroup.Root>
			{/if}

			{#if erros[c.id]}<p role="alert" class="text-sm font-bold text-destructive">{erros[c.id]}</p>{/if}
		</div>
	{/each}

	{#if erroGeral}<p role="alert" class="text-sm font-bold text-destructive">{erroGeral}</p>{/if}

	<Button type="submit" class="self-start border-2 font-bold afunda" disabled={salvando}>
		{#if salvando}<LoaderIcon class="animate-spin" />{/if}
		Salvar perfil
	</Button>
</form>
