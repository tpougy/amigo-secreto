<script lang="ts">
	// "Você tirou": o par do usuário na rodada atual, com as respostas do perfil de quem ele tirou.
	// Na primeira vez da rodada o par vem embrulhado: a pessoa toca para revelar, e só então
	// gravamos `viuParNaRodada = rodadaAtual` (é isso que o refazer conta como "já viu").
	// Se já viu nesta rodada, o par aparece aberto direto.
	import type { DefCampo } from '@amigo/dominio';
	import { db } from '#lib/instant.js';
	import { respostasVisiveis, type RespostaBruta } from '#lib/grupo/consultas.js';
	import RespostasPerfil from '#lib/components/RespostasPerfil.svelte';
	import GiftIcon from '@lucide/svelte/icons/gift';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';

	let {
		meuParticipanteId,
		viuParNaRodada,
		rodadaAtual,
		receptor,
		campos
	}: {
		meuParticipanteId: string;
		viuParNaRodada: number | null | undefined;
		rodadaAtual: number;
		receptor: { apelido: string; respostas: RespostaBruta[] };
		campos: DefCampo[];
	} = $props();

	const jaViu = $derived(viuParNaRodada === rodadaAtual);
	let abriuAgora = $state(false);
	const aberto = $derived(jaViu || abriuAgora);
	const respostas = $derived(respostasVisiveis(campos, receptor.respostas));

	// Grava "vi o par" quando o par está visível e ainda não foi gravado nesta rodada.
	let gravando = false;
	$effect(() => {
		if (!aberto || jaViu || gravando) return;
		gravando = true;
		db.transact(db.tx.participantes[meuParticipanteId]!.update({ viuParNaRodada: rodadaAtual }))
			.catch(() => {})
			.finally(() => (gravando = false));
	});

	const cores = ['bg-rosa', 'bg-lima', 'bg-ceu', 'bg-primary', 'bg-amber-300'];
	const confete = Array.from({ length: 22 }, (_, i) => ({
		cor: cores[i % cores.length],
		x: Math.round(Math.random() * 100),
		atraso: Math.round(Math.random() * 300),
		giro: Math.round(Math.random() * 720 - 360),
		queda: 120 + Math.round(Math.random() * 160)
	}));
</script>

<section
	class="relative overflow-hidden rounded-2xl border-2 bg-primary shadow-lg"
	aria-live="polite"
	data-testid="voce-tirou"
	data-aberto={aberto}
>
	<div class="bg-pontos pointer-events-none absolute inset-0 opacity-30" aria-hidden="true"></div>

	{#if !aberto}
		<div class="relative flex flex-col items-center gap-4 px-5 py-8 text-center">
			<span class="grid size-20 place-items-center rounded-2xl border-2 bg-rosa text-tinta shadow-md motion-safe:animate-bounce">
				<GiftIcon class="size-10" />
			</span>
			<div>
				<p class="text-sm font-black tracking-widest uppercase">O sorteio saiu!</p>
				<h2 class="text-2xl font-black sm:text-3xl">Quem você tirou?</h2>
			</div>
			<button
				type="button"
				class="rounded-xl border-2 bg-background px-6 py-3 text-lg font-black shadow-md afunda"
				onclick={() => (abriuAgora = true)}
				data-testid="revelar"
			>
				Revelar meu amigo secreto
			</button>
			<p class="text-xs font-semibold">Confira longe de olhares curiosos.</p>
		</div>
	{:else}
		{#if abriuAgora}
			<div class="pointer-events-none absolute inset-x-0 top-0 h-0" aria-hidden="true">
				{#each confete as c, i (i)}
					<span
						class="confete absolute top-0 block h-3 w-2 rounded-[1px] border border-black {c.cor}"
						style="left: {c.x}%; animation-delay: {c.atraso}ms; --giro: {c.giro}deg; --queda: {c.queda}px"
					></span>
				{/each}
			</div>
		{/if}
		<div class="relative flex flex-col gap-4 px-5 py-6 sm:px-7">
			<div class={abriuAgora ? 'revela' : ''}>
				<p class="flex items-center gap-1.5 text-sm font-black tracking-widest uppercase">
					<SparklesIcon class="size-4" /> Você tirou
				</p>
				<h2
					class="mt-1 inline-block -rotate-1 rounded-xl border-2 bg-background px-4 py-1 text-4xl font-black break-words shadow-md sm:text-5xl"
					data-testid="nome-tirado"
				>
					{receptor.apelido}
				</h2>
			</div>

			{#if respostas.length === 0}
				<p class="rounded-xl border-2 border-dashed bg-background/70 px-3 py-2 text-sm font-semibold">
					{receptor.apelido} ainda não preencheu o perfil. Volte mais tarde para ver as dicas.
				</p>
			{:else}
				<RespostasPerfil {respostas} />
			{/if}
		</div>
	{/if}
</section>

<style>
	.confete {
		animation: cair 1.4s cubic-bezier(0.2, 0.6, 0.4, 1) forwards;
		opacity: 0;
	}
	@keyframes cair {
		0% {
			transform: translateY(-10px) rotate(0);
			opacity: 1;
		}
		100% {
			transform: translateY(var(--queda)) rotate(var(--giro));
			opacity: 0;
		}
	}
	.revela {
		animation: pulo 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	@keyframes pulo {
		0% {
			transform: scale(0.6) rotate(-6deg);
			opacity: 0;
		}
		100% {
			transform: scale(1) rotate(0);
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.confete {
			display: none;
		}
		.revela {
			animation: none;
		}
	}
</style>
