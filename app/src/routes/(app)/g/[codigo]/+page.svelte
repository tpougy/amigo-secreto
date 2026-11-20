<script lang="ts">
	import { page } from '$app/state';
	import PreviaGrupo from '#lib/components/PreviaGrupo.svelte';
</script>

<!-- `{#key}`: a consulta usa `ruleParams` fixos na criação, então cada código ganha uma instância. -->
{#key page.params.codigo}
	<PreviaGrupo codigoBruto={page.params.codigo ?? ''} />
{/key}
