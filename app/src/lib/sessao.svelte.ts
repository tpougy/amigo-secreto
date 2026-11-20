// Estado compartilhado das páginas internas: usuário logado e "Meus grupos".
// O layout `(app)` cria uma vez (`criarSessao`) e as páginas leem com `usarSessao`.
import { getContext, setContext } from "svelte";
import { db } from "./instant";
import { separarGrupos, type MeusGrupos } from "./meus-grupos";

export interface Sessao {
  readonly carregandoAuth: boolean;
  readonly usuario: { id: string; email?: string | null } | null;
  readonly carregandoGrupos: boolean;
  readonly erroGrupos: string | null;
  readonly grupos: MeusGrupos;
}

const CHAVE = Symbol("sessao");

export function criarSessao(): Sessao {
  const auth = db.useAuth();
  const consulta = db.useQuery(() => {
    const uid = auth.user?.id;
    if (!uid) return null;
    return {
      grupos: { $: { where: { "organizador.id": uid } } },
      participantes: {
        $: { where: { "usuario.id": uid, removido: false } },
        grupo: {},
      },
    };
  });
  const grupos = $derived(
    separarGrupos(consulta.data?.grupos ?? [], consulta.data?.participantes ?? []),
  );
  const sessao: Sessao = {
    get carregandoAuth() {
      return auth.isLoading;
    },
    get usuario() {
      return auth.user ?? null;
    },
    get carregandoGrupos() {
      return consulta.isLoading;
    },
    get erroGrupos() {
      return consulta.error?.message ?? null;
    },
    get grupos() {
      return grupos;
    },
  };
  setContext(CHAVE, sessao);
  return sessao;
}

export function usarSessao(): Sessao {
  const s = getContext<Sessao | undefined>(CHAVE);
  if (!s) throw new Error("usarSessao fora do layout interno");
  return s;
}
