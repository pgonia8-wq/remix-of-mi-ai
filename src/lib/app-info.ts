// Public app facts shown in Soporte y legal.
export const APP_NAME = "MI AI";
export const APP_VERSION: string = (import.meta.env["VITE_APP_VERSION"] as string | undefined) ?? "0.1.0";
export const SUPPORT_EMAIL = "soporte@tramanetwork.lat";

/** Removes anything that looks like a credential before text leaves the device (reports, crash logs). */
export function redactText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [oculto]")
    .replace(/\b(sk|pk|rk|ghp|gho|github_pat|xox[abp]|AIza)[-_A-Za-z0-9]{12,}/g, "[clave oculta]")
    .replace(/(api[-_]?key|password|contraseña|secret|token)(["'\s:=]+)[^\s"',}]{4,}/gi, "$1$2[oculto]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[clave oculta]")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}/g, "[dato oculto]");
}
