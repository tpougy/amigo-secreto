// Cache local do Instant (IndexedDB) depois de uma mudança de schema.
// O @instantdb/core guarda no navegador o resultado das consultas (`querySubs`/`syncSubs`), e um
// cache de antes de um schema novo (entidade/atributo novo) já quebrou o app com erro 500 até
// limpar os dados do site. Ao abrir, se a assinatura do schema mudou desde a última visita,
// apaga só esses resultados; o `kv` (login e gravações pendentes) fica intacto.

/** Versão do banco IndexedDB do @instantdb/core 1.0.67 (`IndexedDBStorage.js`: `instant_<appId>_6`). */
export const VERSAO_IDB_INSTANT = 6;
export const STORES_DE_CONSULTA = ["querySubs", "syncSubs"] as const;
const CHAVE = "amigo:schema-do-cache";

/** Hash curto (djb2) do schema serializado: muda quando entidades, atributos ou links mudam. */
export function assinaturaSchema(schema: unknown): string {
  const s = JSON.stringify(schema);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Limpa quando a assinatura guardada é outra, inclusive quando não há nenhuma: quem abriu o app
 * antes desta proteção pode estar com um cache antigo. Limpar à toa só custa refazer as consultas.
 */
export function precisaLimpar(guardada: string | null, atual: string): boolean {
  return guardada !== atual;
}

function pedido<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, erro) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}

async function limparStores(appId: string): Promise<void> {
  const nome = `instant_${appId}_${VERSAO_IDB_INSTANT}`;
  // Não abrir um banco que não existe: criá-lo vazio impediria o Instant de criar as stores.
  const bancos = await indexedDB.databases?.();
  if (!bancos?.some((b) => b.name === nome)) return;
  const banco = await pedido(indexedDB.open(nome));
  try {
    const stores = STORES_DE_CONSULTA.filter((s) => banco.objectStoreNames.contains(s));
    if (!stores.length) return;
    const tx = banco.transaction(stores, "readwrite");
    for (const s of stores) tx.objectStore(s).clear();
    await new Promise<void>((ok, erro) => {
      tx.oncomplete = () => ok();
      tx.onerror = () => erro(tx.error);
      tx.onabort = () => erro(tx.error);
    });
  } finally {
    banco.close();
  }
}

/**
 * Roda antes do app (hook `init` do cliente), sem nunca travar a abertura: qualquer falha ou
 * demora acima de 2 s segue em frente. Devolve se limpou.
 */
export async function limparCacheSeSchemaMudou(appId: string, schema: unknown): Promise<boolean> {
  try {
    const atual = assinaturaSchema(schema);
    const guardada = localStorage.getItem(CHAVE);
    if (!precisaLimpar(guardada, atual)) return false;
    await Promise.race([limparStores(appId), new Promise((ok) => setTimeout(ok, 2000))]);
    localStorage.setItem(CHAVE, atual);
    return true;
  } catch {
    return false;
  }
}
