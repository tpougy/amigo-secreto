<script lang="ts">
	// Provisório (Task 10): a rota de verdade chega numa das Tasks 11–14 e substitui este arquivo.
	import EmBreve from '#lib/components/em-breve.svelte';
	import { page } from '$app/state';
</script>

<EmBreve titulo="Entrar em um grupo" detalhe={`Código: ${page.params.codigo}`} />
