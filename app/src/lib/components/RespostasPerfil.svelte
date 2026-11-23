<script lang="ts">
	// Respostas de um perfil, na ordem dos campos (usado em "Você tirou" e no diálogo de perfil).
	import type { DefCampo, ValorResposta } from '@amigo/dominio';

	let { respostas }: { respostas: { campo: DefCampo; valor: ValorResposta }[] } = $props();
</script>

<dl class="grid gap-3 sm:grid-cols-2">
	{#each respostas as r (r.campo.id)}
		<div class="rounded-xl border-2 bg-background p-3 shadow-sm">
			<dt class="text-xs font-black tracking-wider text-muted-foreground uppercase">{r.campo.rotulo}</dt>
			<dd class="mt-1">
				{#if Array.isArray(r.valor)}
					<ul class="flex flex-wrap gap-1.5">
						{#each r.valor as v, k (k)}
							<li class="rounded-md border-2 bg-ceu px-2 py-0.5 text-sm font-bold text-tinta">{v}</li>
						{/each}
					</ul>
				{:else}
					<p class="font-semibold whitespace-pre-line break-words">{r.valor}</p>
				{/if}
			</dd>
		</div>
	{/each}
</dl>
