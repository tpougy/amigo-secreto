<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import SeloStatus from '#lib/components/selo-status.svelte';
	import { db } from '#lib/instant.js';
	import { usarSessao } from '#lib/sessao.svelte.js';
	import type { GrupoResumo } from '#lib/meus-grupos.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import GiftIcon from '@lucide/svelte/icons/gift';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import UserIcon from '@lucide/svelte/icons/user';
	import LogOutIcon from '@lucide/svelte/icons/log-out';

	const sessao = usarSessao();
	const sidebar = Sidebar.useSidebar();

	const email = $derived(sessao.usuario?.email ?? '');
	const inicial = $derived((email[0] ?? '?').toUpperCase());

	function fecharNoCelular() {
		if (sidebar.isMobile) sidebar.setOpenMobile(false);
	}

	async function sair() {
		await db.auth.signOut();
		await goto('/', { replaceState: true });
	}
</script>

{#snippet listaGrupos(titulo: string, grupos: GrupoResumo[], vazio: string)}
	<Sidebar.Group>
		<Sidebar.GroupLabel class="text-xs font-black tracking-widest text-sidebar-foreground uppercase">
			{titulo}
		</Sidebar.GroupLabel>
		<Sidebar.GroupContent>
			<Sidebar.Menu>
				{#if sessao.carregandoGrupos}
					<Sidebar.MenuSkeleton />
					<Sidebar.MenuSkeleton />
				{:else if grupos.length === 0}
					<p class="px-2 py-1 text-xs text-muted-foreground">{vazio}</p>
				{:else}
					{#each grupos as g (g.id)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={page.url.pathname === `/grupos/${g.id}`}>
								{#snippet child({ props })}
									<a href={`/grupos/${g.id}`} onclick={fecharNoCelular} {...props}>
										<span class="min-w-0 flex-1 truncate">{g.titulo}</span>
										<SeloStatus status={g.status} />
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				{/if}
			</Sidebar.Menu>
		</Sidebar.GroupContent>
	</Sidebar.Group>
{/snippet}

<Sidebar.Root>
	<Sidebar.Header class="border-b-2 border-sidebar-border">
		<a
			href="/grupos"
			onclick={fecharNoCelular}
			class="flex items-center gap-2 rounded-md border-2 bg-primary px-3 py-2 font-black tracking-tight shadow-sm afunda"
		>
			<GiftIcon class="size-5" />
			<span>Amigo Secreto</span>
		</a>
		<div class="mt-2 grid grid-cols-2 gap-2">
			<a
				href="/criar"
				onclick={fecharNoCelular}
				class="flex items-center justify-center gap-1 rounded-md border-2 bg-lima px-2 py-1.5 text-xs font-bold shadow-xs afunda"
			>
				<PlusIcon class="size-4" /> Criar grupo
			</a>
			<a
				href="/entrar-grupo"
				onclick={fecharNoCelular}
				class="flex items-center justify-center gap-1 rounded-md border-2 bg-ceu px-2 py-1.5 text-xs font-bold shadow-xs afunda"
			>
				<TicketIcon class="size-4" /> Entrar em grupo
			</a>
		</div>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton isActive={page.url.pathname === '/grupos'}>
						{#snippet child({ props })}
							<a href="/grupos" onclick={fecharNoCelular} {...props}>
								<LayoutGridIcon />
								<span class="font-bold">Meus grupos</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Group>
		{@render listaGrupos('Organizando', sessao.grupos.organizando, 'Nenhum grupo ainda.')}
		{@render listaGrupos('Participando', sessao.grupos.participando, 'Nenhum grupo ainda.')}
	</Sidebar.Content>

	<Sidebar.Footer class="border-t-2 border-sidebar-border">
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Sidebar.MenuButton size="lg" class="border-2 bg-background shadow-xs" {...props}>
								<Avatar.Root class="size-8 rounded-md border-2">
									<Avatar.Fallback class="rounded-md bg-rosa font-black">{inicial}</Avatar.Fallback>
								</Avatar.Root>
								<span class="min-w-0 flex-1 truncate text-start text-xs font-semibold">{email}</span>
								<ChevronsUpDownIcon class="ms-auto size-4" />
							</Sidebar.MenuButton>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content side="top" align="start" class="w-(--bits-dropdown-menu-anchor-width) min-w-56">
						<DropdownMenu.Item onSelect={() => { fecharNoCelular(); goto('/conta'); }}>
							<UserIcon /> Minha conta
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onSelect={sair}>
							<LogOutIcon /> Sair
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
</Sidebar.Root>
