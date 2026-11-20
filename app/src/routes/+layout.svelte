<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Amigo Secreto</title>
	<meta name="description" content="Amigo secreto sem papelzinho: crie o grupo, chame a turma, sorteie." />
</svelte:head>

<Toaster theme="light" position="top-center" />

{@render children()}
