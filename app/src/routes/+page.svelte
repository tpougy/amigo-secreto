<script lang="ts">
	import { goto } from '$app/navigation';
	import { db } from '#lib/instant.js';
	import { destinoAposLogin, guardarIntencao, type Intencao } from '#lib/intencao.js';
	import RodapePublico from '#lib/components/rodape-publico.svelte';
	import GiftIcon from '@lucide/svelte/icons/gift';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import ShuffleIcon from '@lucide/svelte/icons/shuffle';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';

	const auth = db.useAuth();

	// Quem já está logado vai direto para "Meus grupos".
	$effect(() => {
		if (auth.user) goto('/grupos', { replaceState: true });
	});

	function ir(intencao: Intencao) {
		if (auth.user) {
			goto(destinoAposLogin(intencao));
			return;
		}
		guardarIntencao(intencao);
		goto('/entrar');
	}

	const passos = [
		{ Icone: PlusIcon, cor: 'bg-primary', titulo: 'Crie o grupo', texto: 'Tema, datas e o que cada um deve contar sobre si.' },
		{ Icone: QrCodeIcon, cor: 'bg-ceu', titulo: 'Chame a turma', texto: 'Um código de 6 letras ou um QR Code. Sem cadastro chato.' },
		{ Icone: ShuffleIcon, cor: 'bg-rosa', titulo: 'Sorteie', texto: 'Cada um vê só quem tirou. Nem o organizador sabe os pares.' }
	];
</script>

<svelte:head><title>Amigo Secreto · sem papelzinho</title></svelte:head>

<div class="flex min-h-svh flex-col bg-pontos">
	<header class="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
		<span class="flex items-center gap-2 rounded-md border-2 bg-primary px-3 py-1.5 font-black tracking-tight shadow-sm">
			<GiftIcon class="size-5" /> Amigo Secreto
		</span>
		<a href="/entrar" class="rounded-md border-2 bg-background px-3 py-1.5 text-sm font-bold shadow-xs afunda">
			Entrar
		</a>
	</header>

	<main class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-4 py-8 md:py-16">
		<section class="relative rounded-2xl border-4 bg-background p-6 sombra-dura md:p-12">
			<span
				class="absolute -top-5 right-6 rotate-3 rounded-md border-2 bg-rosa px-3 py-1 text-sm font-black uppercase shadow-sm"
			>
				sem papelzinho!
			</span>
			<h1 class="text-5xl leading-[0.95] font-black tracking-tighter md:text-7xl">
				Amigo secreto
				<span class="mt-2 inline-block -rotate-1 rounded-lg border-4 bg-primary px-3 sombra-dura-sm">
					do jeito certo.
				</span>
			</h1>
			<p class="mt-6 max-w-xl text-lg font-medium md:text-xl">
				Crie o grupo, chame a turma por código ou QR e deixe o sorteio com a gente: cada um descobre
				quem tirou e o que essa pessoa gosta de ganhar.
			</p>
			<div class="mt-8 flex flex-col gap-4 sm:flex-row">
				<button
					type="button"
					onclick={() => ir({ tipo: 'criar' })}
					class="flex items-center justify-center gap-2 rounded-lg border-4 bg-primary px-6 py-4 text-lg font-black shadow-lg afunda"
				>
					<PlusIcon class="size-6" /> Criar um grupo
				</button>
				<button
					type="button"
					onclick={() => ir({ tipo: 'entrar' })}
					class="flex items-center justify-center gap-2 rounded-lg border-4 bg-ceu px-6 py-4 text-lg font-black shadow-lg afunda"
				>
					<TicketIcon class="size-6" /> Entrar em um grupo
				</button>
			</div>
		</section>

		<section class="grid gap-6 md:grid-cols-3">
			{#each passos as p, i (p.titulo)}
				<div class="rounded-xl border-2 bg-background p-5 shadow-md {i === 1 ? 'md:translate-y-4' : ''}">
					<div class="flex items-center gap-3">
						<span class="inline-flex size-11 items-center justify-center rounded-md border-2 shadow-xs {p.cor}">
							<p.Icone class="size-6" />
						</span>
						<span class="text-3xl font-black">{i + 1}</span>
					</div>
					<h2 class="mt-4 text-xl font-black">{p.titulo}</h2>
					<p class="mt-1 font-medium text-muted-foreground">{p.texto}</p>
				</div>
			{/each}
		</section>

		<section class="flex items-center gap-3 self-start rounded-lg border-2 bg-lima px-4 py-3 font-bold shadow-sm">
			<EyeOffIcon class="size-5 shrink-0" />
			Sem anúncios. Seus dados ficam num servidor no Brasil e não são compartilhados.
		</section>
	</main>

	<RodapePublico />
</div>
