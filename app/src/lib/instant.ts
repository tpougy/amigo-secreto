// Cliente Instant único do SPA. Importe `db` daqui em qualquer rota ou componente.
import { init } from "@instantdb/svelte";
import {
  PUBLIC_INSTANT_API_URI,
  PUBLIC_INSTANT_APP_ID,
  PUBLIC_INSTANT_WS_URI,
} from "$app/env/public";
import schema from "../../../instant.schema";

export const db = init({
  appId: PUBLIC_INSTANT_APP_ID,
  apiURI: PUBLIC_INSTANT_API_URI,
  websocketURI: PUBLIC_INSTANT_WS_URI,
  schema,
});

export type DB = typeof db;
