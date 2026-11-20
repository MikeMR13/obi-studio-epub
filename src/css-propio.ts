// CSS propio del libro: se añade después del tema en el EPUB y en el PDF. Antes se revisa con las
// reglas que hacen fallar a EPUBCheck o a los lectores (sin recursos remotos, sin direction…).

import type { Libro } from './model.js';

export interface ProblemaCss {
  linea: number;
  plantilla: string;
  valores?: Record<string, string | number>;
}

export const MAXIMO_CSS = 100_000;

function linea(css: string, pos: number): number {
  return css.slice(0, pos).split('\n').length;
}

/** Problemas del CSS propio. Vacío = se puede usar. */
export function revisarCss(css: string, libro?: Pick<Libro, 'recursos'>): ProblemaCss[] {
  const p: ProblemaCss[] = [];
  if (css.length > MAXIMO_CSS) return [{ linea: 1, plantilla: 'El CSS es demasiado largo (más de {0} caracteres).', valores: { 0: MAXIMO_CSS } }];
  // Comentarios y cadenas fuera para contar llaves sin falsos positivos.
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m.replace(/[^\n]/g, 'x'));
  if (/\/\*/.test(limpio)) p.push({ linea: linea(limpio, limpio.indexOf('/*')), plantilla: 'Hay un comentario sin cerrar.' });
  let nivel = 0;
  for (let i = 0; i < limpio.length; i++) {
    if (limpio[i] === '{') nivel++;
    else if (limpio[i] === '}' && --nivel < 0) {
      p.push({ linea: linea(limpio, i), plantilla: 'Sobra una llave de cierre «}».' });
      nivel = 0;
    }
  }
  if (nivel > 0) p.push({ linea: linea(limpio, limpio.length), plantilla: 'Falta cerrar {0} llave(s) «}».', valores: { 0: nivel } });
  for (const m of limpio.matchAll(/@import\b/gi)) p.push({ linea: linea(limpio, m.index!), plantilla: 'No se admite @import: escribe aquí todo el CSS.' });
  for (const m of limpio.matchAll(/(?:^|[;{\s])(direction|unicode-bidi)\s*:/gi)) {
    p.push({ linea: linea(limpio, m.index!), plantilla: 'EPUBCheck no admite la propiedad «{0}»: usa el atributo dir o la escritura del libro.', valores: { 0: m[1].toLowerCase() } });
  }
  for (const m of limpio.matchAll(/position\s*:\s*fixed/gi)) p.push({ linea: linea(limpio, m.index!), plantilla: 'position: fixed no funciona en los lectores y puede tapar el texto.' });
  const nombres = new Set((libro?.recursos ?? []).map((r) => r.nombre));
  for (const m of css.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi)) {
    const u = m[2].trim();
    if (!u) p.push({ linea: linea(css, m.index!), plantilla: 'Hay un url() vacío.' });
    else if (/^[a-z][\w+.-]*:/i.test(u)) p.push({ linea: linea(css, m.index!), plantilla: 'Los recursos remotos no se admiten en un EPUB ({0}).', valores: { 0: u.slice(0, 60) } });
    else if (u.startsWith('img/') && libro && !nombres.has(decodeURIComponent(u.slice(4)))) p.push({ linea: linea(css, m.index!), plantilla: 'La imagen «{0}» no está en el libro.', valores: { 0: u.slice(4) } });
    else if (!u.startsWith('img/') && !u.startsWith('fuentes/')) p.push({ linea: linea(css, m.index!), plantilla: 'Las rutas deben empezar por img/ (imágenes del libro) o fuentes/.' });
  }
  if (/<\/?style|<\/?script/i.test(css)) p.push({ linea: 1, plantilla: 'Escribe solo CSS, sin etiquetas HTML.' });
  return p;
}

/** CSS propio listo para añadir al final de la hoja (vacío si no hay o tiene problemas). */
export function cssPropioSeguro(libro: Libro): string {
  const css = libro.cssPropio?.trim();
  if (!css || revisarCss(css, libro).length) return '';
  return `\n/* CSS propio del libro */\n${css.replace(/<\//g, '<\\/')}\n`;
}
