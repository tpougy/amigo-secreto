<script lang="ts">
	import { goto } from '$app/navigation';
	import { db } from '#lib/instant.js';
	import { loginGoogle, loginMagico } from '#lib/login.js';
	import { consumirIntencao, destinoAposLogin } from '#lib/intencao.js';
	import { mensagemDeErro } from '#lib/erros.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import RodapePublico from '#lib/components/rodape-publico.svelte';
	import GiftIcon from '@lucide/svelte/icons/gift';
	import MailIcon from '@lucide/svelte/icons/mail';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';

	const auth = db.useAuth();

	let etapa = $state<'email' | 'codigo'>('email');
	let email = $state('');
	let codigo = $state('');
	let enviando = $state(false);
	let erro = $state<string | null>(null);
	let redirecionou = false;

	// Logado (agora ou já antes): retoma a intenção guardada (uso único) ou vai para Meus grupos.
	$effect(() => {
		if (!auth.user || redirecionou) return;
		redirecionou = true;
		goto(destinoAposLogin(consumirIntencao()), { replaceState: true });
	});

	async function pedirCodigo(ev: SubmitEvent) {
		ev.preventDefault();
		erro = null;
		const e = email.trim().toLowerCase();
		if (!e.includes('@')) {
			erro = 'Informe um e-mail válido.';
			return;
		}
		enviando = true;
		try {
			await db.auth.sendMagicCode({ email: e });
			email = e;
			etapa = 'codigo';
		} catch (err) {
			erro = mensagemDeErro(err);
		} finally {
			enviando = false;
		}
	}

	async function confirmarCodigo(ev: SubmitEvent) {
		ev.preventDefault();
		erro = null;
		const c = codigo.replace(/\s/g, '');
		if (!/^\d{6}$/.test(c)) {
			erro = 'O código tem 6 dígitos.';
			return;
		}
		enviando = true;
		try {
			await db.auth.signInWithMagicCode({ email, code: c });
			// O $effect acima redireciona quando o auth atualizar.
		} catch (err) {
			erro = mensagemDeErro(err);
		} finally {
			enviando = false;
		}
	}

	function entrarComGoogle() {
		const url = db.auth.createAuthorizationURL({
			clientName: 'google',
			redirectURL: location.origin + '/entrar'
		});
		location.href = url;
	}

	function trocarEmail() {
		etapa = 'email';
		codigo = '';
		erro = null;
	}
</script>

<svelte:head><title>Entrar · Amigo Secreto</title></svelte:head>

<div class="flex min-h-svh flex-col bg-pontos">
	<main class="flex flex-1 items-center justify-center px-4 py-10">
		<div class="w-full max-w-md rounded-2xl border-4 bg-background p-6 sombra-dura md:p-8">
			<a href="/" class="inline-flex items-center gap-2 rounded-md border-2 bg-primary px-3 py-1.5 font-black shadow-xs">
				<GiftIcon class="size-5" /> Amigo Secreto
			</a>
			<h1 class="mt-6 text-4xl font-black tracking-tighter">Entrar</h1>

			{#if auth.isLoading || auth.user}
				<div class="mt-6 flex items-center gap-2 font-semibold">
					<LoaderIcon class="size-5 animate-spin" /> Um instante…
				</div>
			{:else}
				{#if auth.error}
					<p class="mt-4 rounded-md border-2 bg-destructive p-3 text-sm font-semibold text-white">
						{auth.error.message}
					</p>
				{/if}

				{#if loginGoogle}
					<Button
						type="button"
						variant="outline"
						size="lg"
						class="mt-6 w-full border-2 font-bold afunda"
						onclick={entrarComGoogle}
					>
						<svg viewBox="0 0 24 24" class="size-5" aria-hidden="true">
							<path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8Z" />
							<path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z" />
							<path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8Z" />
							<path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4Z" />
						</svg>
						Entrar com Google
					</Button>
				{/if}

				{#if loginGoogle && loginMagico}
					<div class="my-6 flex items-center gap-3 text-xs font-bold uppercase">
						<Separator class="flex-1" /> ou <Separator class="flex-1" />
					</div>
				{/if}

				{#if loginMagico}
					{#if etapa === 'email'}
						<form class="mt-6 flex flex-col gap-4" onsubmit={pedirCodigo}>
							<Field.Field>
								<Field.Label for="email" class="font-bold">Seu e-mail</Field.Label>
								<Input
									id="email"
									type="email"
									autocomplete="email"
									inputmode="email"
									required
									placeholder="voce@exemplo.com"
									bind:value={email}
									class="h-11 border-2"
								/>
								<Field.Description>Mandamos um código de 6 dígitos para esse e-mail.</Field.Description>
							</Field.Field>
							<Button type="submit" size="lg" class="h-12 text-base font-black afunda" disabled={enviando}>
								{#if enviando}<LoaderIcon class="animate-spin" />{:else}<MailIcon />{/if}
								Receber código
							</Button>
						</form>
					{:else}
						<form class="mt-6 flex flex-col gap-4" onsubmit={confirmarCodigo}>
							<p class="rounded-md border-2 bg-lima p-3 text-sm font-semibold">
								Enviamos um código para <strong>{email}</strong>.
							</p>
							<Field.Field>
								<Field.Label for="codigo" class="font-bold">Código</Field.Label>
								<Input
									id="codigo"
									inputmode="numeric"
									autocomplete="one-time-code"
									maxlength={6}
									required
									placeholder="123456"
									bind:value={codigo}
									class="h-14 border-2 text-center font-mono text-2xl tracking-[0.5em]"
								/>
							</Field.Field>
							<Button type="submit" size="lg" class="h-12 text-base font-black afunda" disabled={enviando}>
								{#if enviando}<LoaderIcon class="animate-spin" />{:else}<KeyRoundIcon />{/if}
								Entrar
							</Button>
							<button type="button" class="text-sm font-semibold underline underline-offset-4" onclick={trocarEmail}>
								Usar outro e-mail
							</button>
						</form>
					{/if}
				{/if}

				{#if erro}
					<p role="alert" class="mt-4 rounded-md border-2 bg-destructive p-3 text-sm font-semibold text-white">
						{erro}
					</p>
				{/if}

				{#if !loginGoogle && !loginMagico}
					<p class="mt-6 font-semibold">O login está temporariamente desligado.</p>
				{/if}

				<p class="mt-6 text-xs text-muted-foreground">
					Ao entrar você concorda com os <a class="underline" href="/termos">termos</a> e a
					<a class="underline" href="/privacidade">política de privacidade</a>.
				</p>
			{/if}
		</div>
	</main>
	<RodapePublico />
</div>
