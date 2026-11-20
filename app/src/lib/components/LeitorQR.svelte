<script lang="ts">
	// Lê um QR com a câmera: BarcodeDetector quando existe, jsQR como fallback.
	// Devolve o texto bruto do QR em `aoLer` (a página extrai o código).
	import { onDestroy } from 'svelte';
	import jsQR from 'jsqr';
	import { Button } from '#lib/components/ui/button/index.js';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import XIcon from '@lucide/svelte/icons/x';

	let { aoLer, aoFechar }: { aoLer: (texto: string) => void; aoFechar: () => void } = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let erro = $state<string | null>(null);
	let iniciando = $state(true);
	let fluxo: MediaStream | null = null;
	let ativo = true;
	let quadro = 0;

	type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

	function criarDetector(): Detector | null {
		const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector })
			.BarcodeDetector;
		if (!BD) return null;
		try {
			return new BD({ formats: ['qr_code'] });
		} catch {
			return null;
		}
	}

	function parar() {
		ativo = false;
		cancelAnimationFrame(quadro);
		fluxo?.getTracks().forEach((t) => t.stop());
		fluxo = null;
	}

	async function iniciar(v: HTMLVideoElement) {
		if (!navigator.mediaDevices?.getUserMedia) {
			erro = 'Este navegador não permite usar a câmera. Digite o código.';
			iniciando = false;
			return;
		}
		try {
			fluxo = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' } },
				audio: false
			});
		} catch {
			erro = 'Não foi possível acessar a câmera. Verifique a permissão ou digite o código.';
			iniciando = false;
			return;
		}
		if (!ativo) return parar();
		v.srcObject = fluxo;
		await v.play().catch(() => {});
		iniciando = false;

		let detector = criarDetector();
		const tela = document.createElement('canvas');
		const ctx = tela.getContext('2d', { willReadFrequently: true });
		let ocupado = false;

		const ciclo = async () => {
			if (!ativo) return;
			if (!ocupado && v.readyState >= 2 && v.videoWidth > 0) {
				ocupado = true;
				try {
					let texto: string | null = null;
					let usarJsQR = !detector;
					if (detector) {
						try {
							texto = (await detector.detect(v))[0]?.rawValue ?? null;
						} catch {
							// BarcodeDetector existe mas falhou: cai para o jsQR daqui em diante.
							detector = null;
							usarJsQR = true;
						}
					}
					if (usarJsQR && ctx) {
						// jsQR: reduz o quadro para no máximo 640px de largura.
						const esc = Math.min(1, 640 / v.videoWidth);
						tela.width = Math.round(v.videoWidth * esc);
						tela.height = Math.round(v.videoHeight * esc);
						ctx.drawImage(v, 0, 0, tela.width, tela.height);
						const img = ctx.getImageData(0, 0, tela.width, tela.height);
						texto = jsQR(img.data, img.width, img.height)?.data ?? null;
					}
					if (texto && ativo) {
						parar();
						aoLer(texto);
						return;
					}
				} catch {
					// Quadro ruim: tenta o próximo.
				}
				ocupado = false;
			}
			quadro = requestAnimationFrame(ciclo);
		};
		quadro = requestAnimationFrame(ciclo);
	}

	$effect(() => {
		if (video) void iniciar(video);
	});
	onDestroy(parar);
</script>

<div class="flex flex-col gap-3 rounded-xl border-2 bg-card p-3 shadow-md" data-testid="leitor-qr">
	<div class="relative aspect-square w-full overflow-hidden rounded-lg border-2 bg-black">
		<video bind:this={video} class="size-full object-cover" playsinline muted></video>
		{#if iniciando && !erro}
			<div class="absolute inset-0 flex items-center justify-center gap-2 text-sm font-bold text-white">
				<CameraIcon class="size-5" /> Abrindo a câmera...
			</div>
		{/if}
	</div>
	{#if erro}
		<p role="alert" class="text-sm font-bold text-destructive">{erro}</p>
	{:else}
		<p class="text-sm text-muted-foreground">Aponte a câmera para o QR Code do grupo.</p>
	{/if}
	<Button variant="outline" class="border-2 font-bold afunda" onclick={() => { parar(); aoFechar(); }}>
		<XIcon class="size-4" /> Cancelar
	</Button>
</div>
