<script lang="ts">
	// Editor dos campos do perfil: adicionar, remover, reordenar (↑/↓), rótulo, ajuda, tipo,
	// opções (múltipla/única) e obrigatório. Muda o array recebido e avisa com `aoEditar`.
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { novoCampo, temOpcoes, TIPOS_CAMPO, type CampoEditavel } from '#lib/criar/estado.svelte.js';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import type { TipoCampo } from '@amigo/dominio';

	let {
		campos = $bindable(),
		aoEditar
	}: { campos: CampoEditavel[]; aoEditar?: () => void } = $props();

	function mexeu() {
		aoEditar?.();
	}
	function adicionar() {
		campos.push(novoCampo());
		mexeu();
	}
	function remover(i: number) {
		campos.splice(i, 1);
		mexeu();
	}
	function mover(i: number, d: -1 | 1) {
		const j = i + d;
		if (j < 0 || j >= campos.length) return;
		[campos[i], campos[j]] = [campos[j]!, campos[i]!];
		mexeu();
	}
	function trocarTipo(c: CampoEditavel, tipo: TipoCampo) {
		c.tipo = tipo;
		if (temOpcoes(tipo) && c.opcoes.length === 0) c.opcoes = ['', ''];
		mexeu();
	}
	function adicionarOpcao(c: CampoEditavel) {
		c.opcoes.push('');
		mexeu();
	}
	function removerOpcao(c: CampoEditavel, k: number) {
		c.opcoes.splice(k, 1);
		mexeu();
	}
</script>

<div class="flex flex-col gap-4">
	{#if campos.length === 0}
		<p class="rounded-xl border-2 border-dashed bg-muted p-4 text-sm font-semibold">
			Nenhum campo ainda. Adicione o que cada participante vai informar (gostos, tamanhos, restrições...).
		</p>
	{/if}

	{#each campos as c, i (c.chave)}
		<fieldset class="flex flex-col gap-3 rounded-xl border-2 bg-card p-3 shadow-sm">
			<legend class="px-1 text-xs font-black tracking-wider uppercase">Campo {i + 1}</legend>
			<div class="flex flex-wrap items-end gap-2">
				<div class="flex min-w-48 flex-1 flex-col gap-1">
					<Label for="rotulo-{c.chave}" class="font-bold">Rótulo</Label>
					<Input
						id="rotulo-{c.chave}"
						bind:value={c.rotulo}
						oninput={mexeu}
						maxlength={80}
						placeholder="Ex.: Gêneros que mais gosto"
						class="border-2"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<Label for="tipo-{c.chave}" class="font-bold">Tipo</Label>
					<select
						id="tipo-{c.chave}"
						value={c.tipo}
						onchange={(e) => trocarTipo(c, e.currentTarget.value as TipoCampo)}
						class="h-9 rounded-md border-2 bg-background px-2 text-sm font-semibold"
					>
						{#each TIPOS_CAMPO as t (t.valor)}
							<option value={t.valor}>{t.nome}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<Label for="ajuda-{c.chave}" class="font-bold">Ajuda (opcional)</Label>
				<Input
					id="ajuda-{c.chave}"
					bind:value={c.ajuda}
					oninput={mexeu}
					maxlength={160}
					placeholder="Uma dica para quem vai preencher"
					class="border-2"
				/>
			</div>

			{#if temOpcoes(c.tipo)}
				<div class="flex flex-col gap-2">
					<span class="text-sm font-bold">Opções (mínimo 2)</span>
					{#each c.opcoes as _, k (k)}
						<div class="flex items-center gap-2">
							<Input
								bind:value={c.opcoes[k]}
								oninput={mexeu}
								maxlength={60}
								placeholder="Opção {k + 1}"
								aria-label="Opção {k + 1} do campo {i + 1}"
								class="border-2"
							/>
							<Button
								variant="outline"
								size="icon-sm"
								class="afunda"
								aria-label="Remover opção {k + 1}"
								onclick={() => removerOpcao(c, k)}><XIcon /></Button
							>
						</div>
					{/each}
					<Button variant="outline" size="sm" class="w-fit font-bold afunda" onclick={() => adicionarOpcao(c)}>
						<PlusIcon /> Adicionar opção
					</Button>
				</div>
			{/if}

			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<Checkbox
						id="obrig-{c.chave}"
						bind:checked={c.obrigatorio}
						onCheckedChange={mexeu}
						class="size-5 border-2"
					/>
					<Label for="obrig-{c.chave}" class="font-bold">Obrigatório</Label>
				</div>
				<div class="flex gap-1.5">
					<Button
						variant="outline"
						size="icon-sm"
						class="afunda"
						disabled={i === 0}
						aria-label="Mover campo {i + 1} para cima"
						onclick={() => mover(i, -1)}><ArrowUpIcon /></Button
					>
					<Button
						variant="outline"
						size="icon-sm"
						class="afunda"
						disabled={i === campos.length - 1}
						aria-label="Mover campo {i + 1} para baixo"
						onclick={() => mover(i, 1)}><ArrowDownIcon /></Button
					>
					<Button
						variant="destructive"
						size="icon-sm"
						class="afunda"
						aria-label="Remover campo {i + 1}"
						onclick={() => remover(i)}><Trash2Icon /></Button
					>
				</div>
			</div>
		</fieldset>
	{/each}

	<Button variant="secondary" class="w-fit font-bold afunda" onclick={adicionar}>
		<PlusIcon /> Adicionar campo
	</Button>
</div>
