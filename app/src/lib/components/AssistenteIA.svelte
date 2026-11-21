<script lang="ts">
	// Seção "Use com seu assistente de IA": conecta o MCP ao Claude (deep link) ou ao ChatGPT (manual).
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { linkAdicionarAoClaude, URL_MCP } from '#lib/assistente.js';
	import { toast } from 'svelte-sonner';
	import BotIcon from '@lucide/svelte/icons/bot';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	const exemplos = [
		'Quem eu tirei no amigo livro?',
		'Me sugere 3 livros para quem eu tirei, evitando os que a pessoa já leu',
		'Atualiza meu perfil: gosto de fantasia e suspense'
	];

	async function copiar() {
		try {
			await navigator.clipboard.writeText(URL_MCP);
			toast.success('URL copiada');
		} catch {
			toast.error(`Não deu para copiar automaticamente. Copie à mão: ${URL_MCP}`);
		}
	}
</script>

<section data-testid="assistente-ia">
	<Card.Root class="border-2 shadow-sm">
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-xl font-black tracking-tight">
				<span class="inline-flex size-9 items-center justify-center rounded-md border-2 bg-primary shadow-xs">
					<BotIcon class="size-5" />
				</span>
				Use com seu assistente de IA
			</Card.Title>
			<Card.Description>
				Pergunte ao Claude ou ao ChatGPT quem você tirou e peça sugestões de presente com base no perfil da pessoa. Ele só vê o que você vê.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">
			<div class="flex flex-wrap gap-2">
				<Button href={linkAdicionarAoClaude()} target="_blank" rel="noopener noreferrer" class="afunda font-bold">
					<ExternalLinkIcon /> Adicionar ao Claude
				</Button>
				<Button variant="secondary" class="afunda border-2 font-bold" onclick={copiar}>
					<CopyIcon /> Copiar URL do MCP
				</Button>
			</div>
			<p class="text-sm text-muted-foreground">
				Depois clique em Adicionar e entre com a mesma conta Google. No plano gratuito do Claude cabe um conector personalizado.
			</p>
			<details class="rounded-md border-2 bg-background p-3">
				<summary class="cursor-pointer font-bold">Como adicionar no ChatGPT</summary>
				<p class="mt-2 text-sm">
					Em Configurações, ative o modo desenvolvedor e adicione um conector (app) com a URL acima. Os nomes do menu mudam entre versões e planos; precisa de plano pago.
				</p>
			</details>
			<div>
				<h3 class="mb-2 text-sm font-black">Exemplos de perguntas</h3>
				<ul class="flex flex-col gap-2 text-sm">
					{#each exemplos as e (e)}
						<li class="rounded-md border-2 bg-muted px-3 py-2">“{e}”</li>
					{/each}
				</ul>
			</div>
		</Card.Content>
	</Card.Root>
</section>
