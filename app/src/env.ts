// Variáveis de ambiente do SPA (SvelteKit 3: declaradas aqui, lidas de `$app/env/public`).
// Todas são públicas e fixadas no build; os valores vêm de `.env.production` / `.env.development`.
import { defineEnvVars } from '@sveltejs/kit/env';

const obrigatoria = (nome: string) => (v: string | undefined) => {
	if (!v) throw new Error(`${nome} não definido`);
	return v;
};

const chave = (v: string | undefined) => {
	if (v !== undefined && v !== 'on' && v !== 'off') throw new Error('use "on" ou "off"');
	return v ?? 'off';
};

export const variables = defineEnvVars({
	PUBLIC_INSTANT_APP_ID: {
		public: true,
		static: true,
		schema: obrigatoria('PUBLIC_INSTANT_APP_ID'),
		description: 'Id do app Instant de produção (público).'
	},
	PUBLIC_INSTANT_API_URI: {
		public: true,
		static: true,
		schema: obrigatoria('PUBLIC_INSTANT_API_URI'),
		description: 'URL HTTP do servidor Instant.'
	},
	PUBLIC_INSTANT_WS_URI: {
		public: true,
		static: true,
		schema: obrigatoria('PUBLIC_INSTANT_WS_URI'),
		description: 'URL do WebSocket do Instant.'
	},
	PUBLIC_LOGIN_MAGIC: {
		public: true,
		static: true,
		schema: chave,
		description: 'Login por código no e-mail: "on" | "off".'
	},
	PUBLIC_LOGIN_GOOGLE: {
		public: true,
		static: true,
		schema: chave,
		description: 'Login com Google (client "google" no Instant): "on" | "off".'
	}
});
