<script module lang="ts">
	export type ParticipanteLista = {
		id: string;
		apelido: string;
		perfilCompleto: boolean;
		removido: boolean;
		chave: string;
		entrouEm: string | number;
		viuParNaRodada?: number | null;
		removidoNaRodada?: number | null;
	};
</script>

<script lang="ts">
	// Lista ao vivo dos participantes. O organizador remove: antes do sorteio, apaga o participante;
	// depois, marca `removido`, desliga o usuário e apaga as respostas (e a página abre o refazer).
	import { lookup } from '@instantdb/core';
	import { db } from '#lib/instant.js';
	import { usuarioDaChave } from '#lib/grupo/consultas.js';
	import { textoRemocao } from '#lib/grupo/regras.js';
	import ConfirmarAcao from '#lib/components/ConfirmarAcao.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import UserMinusIcon from '@lucide/svelte/icons/user-minus';

	let {
		participantes,
		meuParticipanteId,
		souOrganizador,
		rodadaAtual,
		campoIds,
		bloqueado = false,
		aoRemoverAposSorteio
	}: {
		participantes: ParticipanteLista[];
		meuParticipanteId: string | null;
		souOrganizador: boolean;
		rodadaAtual: number;
		campoIds: string[];
		/** Sorteio em andamento ou grupo encerrado: não dá para remover agora. */
		bloqueado?: boolean;
		aoRemoverAposSorteio?: () => void;
	} = $props();

	const ordenados = $derived(
		[...participantes].sort(
			(a, b) => Number(a.removido) - Number(b.removido) || new Date(a.entrouEm).getTime() - new Date(b.entrouEm).getTime()
		)
	);
	const ativos = $derived(participantes.filter((p) => !p.removido).length);
	const completos = $derived(participantes.filter((p) => !p.removido && p.perfilCompleto).length);
	const depoisDoSorteio = $derived(rodadaAtual >= 1);

	let alvo = $state<ParticipanteLista | null>(null);
	let confirmando = $state(false);

	function pedirRemocao(p: ParticipanteLista) {
		alvo = p;
		confirmando = true;
	}

	async function remover() {
		const p = alvo;
		if (!p) return;
		if (!depoisDoSorteio) {
			await db.transact(db.tx.participantes[p.id]!.delete());
			return;
		}
		// O organizador não enxerga o $users nem as respostas do membro: o usuário vem da chave e as
		// respostas são apagadas por lookup de `chave` (<participanteId>:<campoId>).
		const uid = usuarioDaChave(p.chave);
		const marcar = db.tx.participantes[p.id]!.update({ removido: true, removidoNaRodada: rodadaAtual });
		await db.transact([
			uid ? marcar.unlink({ usuario: uid }) : marcar,
			...campoIds.map((c) => db.tx.respostas[lookup('chave', `${p.id}:${c}`)]!.delete())
		]);
		aoRemoverAposSorteio?.();
	}
</script>

<div class="flex flex-col gap-3">
	<p class="text-sm font-semibold text-muted-foreground" data-testid="contagem-participantes">
		{ativos} participante{ativos === 1 ? '' : 's'} · {completos} com perfil completo
	</p>
	<ul class="flex flex-col gap-2" data-testid="lista-participantes">
		{#each ordenados as p (p.id)}
			<li
				class="flex items-center gap-3 rounded-xl border-2 bg-card px-3 py-2.5 shadow-sm {p.removido ? 'opacity-60' : ''}"
				data-testid="participante"
			>
				<span
					class="grid size-9 shrink-0 place-items-center rounded-full border-2 font-black uppercase {p.removido
						? 'bg-neutral-200'
						: 'bg-ceu text-tinta'}"
					aria-hidden="true">{p.apelido.slice(0, 1)}</span
				>
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="truncate font-bold {p.removido ? 'line-through' : ''}">
						{p.apelido}{#if p.id === meuParticipanteId}<span class="font-semibold text-muted-foreground"> (você)</span>{/if}
					</span>
					<div class="flex flex-wrap gap-1.5">
						{#if p.removido}
							<span class="rounded-sm border-2 bg-neutral-300 px-1.5 text-[0.65rem] font-bold text-neutral-700 uppercase">
								removido
							</span>
						{:else if p.perfilCompleto}
							<span class="rounded-sm border-2 bg-lima px-1.5 text-[0.65rem] font-bold text-tinta uppercase">
								perfil completo
							</span>
						{:else}
							<span class="rounded-sm border-2 bg-amber-200 px-1.5 text-[0.65rem] font-bold text-tinta uppercase">
								perfil incompleto
							</span>
						{/if}
					</div>
				</div>
				{#if souOrganizador && !p.removido && p.id !== meuParticipanteId}
					<Button
						variant="outline"
						size="sm"
						class="border-2 font-bold afunda"
						disabled={bloqueado}
						aria-label="Remover {p.apelido}"
						onclick={() => pedirRemocao(p)}
					>
						<UserMinusIcon /> <span class="hidden sm:inline">Remover</span>
					</Button>
				{/if}
			</li>
		{/each}
	</ul>
</div>

<ConfirmarAcao
	bind:aberto={confirmando}
	titulo={alvo ? `Remover ${alvo.apelido}?` : 'Remover participante?'}
	texto={textoRemocao(rodadaAtual)}
	rotuloConfirmar="Remover"
	destrutivo
	aoConfirmar={remover}
/>
