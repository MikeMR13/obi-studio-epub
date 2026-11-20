// Idioma de la interfaz. Las claves son el texto en español (el idioma de origen); el catálogo inglés
// está en i18n-en.ts. Un texto sin traducción se muestra en español, nunca vacío.
// Los marcadores {nombre} se sustituyen por los valores que se pasan.

import { EN } from './i18n-en.js';

export type IdiomaInterfaz = 'es' | 'en';

function inicial(): IdiomaInterfaz {
  try {
    const guardado = localStorage.getItem('obi.idioma');
    if (guardado === 'es' || guardado === 'en') return guardado;
  } catch {
    // Sin almacenamiento: se usa el del sistema.
  }
  return typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('es') ? 'en' : 'es';
}

let actual: IdiomaInterfaz = inicial();

export function idiomaInterfaz(): IdiomaInterfaz {
  return actual;
}

/** Cambia el idioma y recarga la interfaz (el libro abierto sigue en el servidor). */
export function cambiarIdioma(i: IdiomaInterfaz, seguirEnElLibro = true) {
  try {
    localStorage.setItem('obi.idioma', i);
  } catch {
    // Se aplica solo a esta sesión.
  }
  actual = i;
  // Al recargar se vuelve a donde estaba (no a la pantalla de inicio).
  try {
    if (seguirEnElLibro) sessionStorage.setItem('obi.seguir', '1');
  } catch {
    // Sin almacenamiento de sesión: se verá la pantalla de inicio.
  }
  location.reload();
}

const faltan = new Set<string>();

export function t(es: string, valores?: Record<string, string | number | undefined>): string {
  let texto = es;
  if (actual === 'en') {
    const en = EN[es];
    if (en !== undefined) texto = en;
    else if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV && !faltan.has(es)) {
      faltan.add(es);
      console.warn('[i18n] Falta traducción:', es);
    }
  }
  if (valores) texto = texto.replace(/\{(\w+)\}/g, (m, k: string) => (valores[k] !== undefined ? String(valores[k]) : k in valores ? '' : m));
  return texto;
}

/** Locale para fechas y números. */
export function locale(): string {
  return actual === 'en' ? 'en-US' : 'es-MX';
}
