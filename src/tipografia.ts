// Tipografía española: raya de diálogo, comillas y puntos suspensivos.

import type { Bloque, Inline, Libro, Seccion, Tipografia } from './model.js';

export interface Cambios {
  cambios: number;
}

function corregirParrafo(contenido: Inline[], t: Tipografia, cuenta: Cambios): void {
  const textos = contenido.filter((i): i is Extract<Inline, { tipo: 'texto' }> => i.tipo === 'texto');
  if (!textos.length) return;
  let abierta = false; // estado de comillas a lo largo del párrafo
  const esDialogo = /^\s*[-–—]/.test(textos[0].texto);
  textos.forEach((i, k) => {
    let s = i.texto;
    const antes = s;
    if (t.suspensivos) s = s.replace(/\.{3}/g, '…');
    s = s.replace(/ {2,}/g, ' ');
    if (t.raya) {
      if (k === 0) s = s.replace(/^\s*[-–—]\s*/, '—');
      // Inciso que se abre: « -dijo» → « —dijo».
      s = s.replace(/(\s)[-–](?=\p{L})/gu, '$1—');
      if (esDialogo) {
        // Inciso que se cierra: «dijo- .» / «dijo-.» → «dijo—.»
        s = s.replace(/(\p{L}|[!?…])[-–](?=[\s.,;:]|$)/gu, '$1—');
      }
    }
    if (t.comillas !== 'sin-cambio') {
      const abre = t.comillas === 'latinas' ? '«' : '“';
      const cierra = t.comillas === 'latinas' ? '»' : '”';
      s = s.replace(/["“”«»]/g, (c, pos: number, todo: string) => {
        if (c === '«' || c === '“') {
          abierta = true;
          return abre;
        }
        if (c === '»' || c === '”') {
          abierta = false;
          return cierra;
        }
        const previo = pos > 0 ? todo[pos - 1] : '';
        const abrir = !abierta && (pos === 0 || /[\s(\[—¿¡]/.test(previo));
        abierta = abrir;
        return abrir ? abre : cierra;
      });
    }
    if (s !== antes) cuenta.cambios++;
    i.texto = s;
  });
}

function corregirBloques(bloques: Bloque[], t: Tipografia, cuenta: Cambios): void {
  for (const b of bloques) {
    if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') corregirParrafo(b.contenido, t, cuenta);
    if (b.tipo === 'lista') b.elementos.forEach((e) => corregirParrafo(e, t, cuenta));
    if (b.tipo === 'tabla') b.filas.forEach((f) => f.forEach((c) => corregirParrafo(c.contenido, t, cuenta)));
    if (b.tipo === 'recuadro') b.lineas.forEach((l) => corregirParrafo(l.contenido, t, cuenta));
  }
}

export function aplicarTipografiaSeccion(s: Seccion, t: Tipografia): number {
  const cuenta = { cambios: 0 };
  corregirBloques(s.bloques, t, cuenta);
  for (const n of s.notas) corregirParrafo(n.contenido, t, cuenta);
  return cuenta.cambios;
}

export function aplicarTipografiaLibro(libro: Libro): number {
  return libro.secciones.reduce((total, s) => total + aplicarTipografiaSeccion(s, libro.tipografia), 0);
}
