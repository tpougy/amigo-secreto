// Quais formas de login estão ligadas (variáveis públicas de build).
import { PUBLIC_LOGIN_GOOGLE, PUBLIC_LOGIN_MAGIC } from "$app/env/public";

export const loginMagico = PUBLIC_LOGIN_MAGIC === "on";
export const loginGoogle = PUBLIC_LOGIN_GOOGLE === "on";
