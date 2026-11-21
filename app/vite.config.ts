import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// O schema do Instant vem do workspace @amigo/instant (pacotes/instant/schema.ts), fora de app/.
const raiz = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// SPA puro: toda rota cai no index.html (o Worker de arquivos estáticos serve o fallback: not_found_handling).
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	server: {
		fs: { allow: [raiz] }
	}
});
