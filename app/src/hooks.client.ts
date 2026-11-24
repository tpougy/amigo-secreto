// Versão nova publicada com uma aba antiga aberta: os arquivos JS da versão anterior não existem
// mais e o Worker devolve o index.html no lugar (SPA), o que quebraria a navegação com erro 500.
// Quando o módulo da página não carrega, abre o destino com carregamento completo (versão nova).
// No máximo uma vez a cada 30 s, para não entrar em loop se o problema for outro.
import type { ClientInit, HandleClientError } from '@sveltejs/kit/hooks';
import { PUBLIC_INSTANT_APP_ID } from '$app/env/public';
import schema from '@amigo/instant';
import { limparCacheSeSchemaMudou } from '#lib/cacheInstant.js';

const CHAVE = 'amigo:recarregou-em';
const MODULO_QUEBRADO = /dynamically imported module|Importing a module script failed|MIME type|Unable to preload/i;

function podeRecarregar(): boolean {
	try {
		if (Date.now() - Number(sessionStorage.getItem(CHAVE) ?? 0) < 30_000) return false;
		sessionStorage.setItem(CHAVE, String(Date.now()));
	} catch {
		// sem sessionStorage: recarrega mesmo assim
	}
	return true;
}

export const handleError: HandleClientError = ({ error, event }) => {
	const texto = error instanceof Error ? error.message : String(error);
	if (MODULO_QUEBRADO.test(texto) && podeRecarregar()) location.assign(event.url.href);
	// sem retorno: mantém o status e a mensagem padrão
};

/** Antes de o app abrir (e de o Instant ler o IndexedDB): descarta consultas guardadas de um schema antigo. */
export const init: ClientInit = async () => {
	await limparCacheSeSchemaMudou(PUBLIC_INSTANT_APP_ID, schema);
};
