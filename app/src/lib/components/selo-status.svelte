<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { cn } from '#lib/utils.js';
	import { ehStatus, rotuloStatus } from '#lib/meus-grupos.js';

	let { status, class: className }: { status: string; class?: string } = $props();

	const cores: Record<string, string> = {
		aberto: 'bg-lima text-tinta',
		sorteado: 'bg-rosa text-tinta',
		encerrado: 'bg-neutral-300 text-neutral-700'
	};
</script>

<Badge
	class={cn(
		'rounded-sm border-2 px-1.5 text-[0.65rem] font-bold tracking-wide uppercase',
		cores[status] ?? 'bg-muted',
		className
	)}
>
	{ehStatus(status) ? rotuloStatus[status] : status}
</Badge>
