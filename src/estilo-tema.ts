// CSS del tema compartido por el EPUB y el PDF: títulos, aperturas, capitulares, ornamentos y colores.
// El EPUB y la impresión añaden encima solo lo propio de cada medio.

import type { Tema } from './model.js';
import { escAttr } from './xml.js';
import { esc } from './xml.js';
import { partesTitulo } from './model.js';

export const ORNAMENTOS: Record<string, string> = {
  asteriscos: '* * *',
  flor: '❦',
  rombos: '◇ ◆ ◇',
  puntos: '· · ·',
};

/** Marcado del separador de escena según el tema. */
export function separadorXhtml(tema: Tema, rutaImagenSeparador?: string): string {
  switch (tema.separador) {
    case 'linea':
      return '<hr class="escena"/>';
    case 'espacio':
      return '<div class="escena espacio" role="separator"></div>';
    case 'imagen':
      if (rutaImagenSeparador) return `<div class="escena imagen" role="separator"><img src="${escAttr(rutaImagenSeparador)}" alt="" role="presentation"/></div>`;
      return `<div class="escena" role="separator">${ORNAMENTOS.asteriscos}</div>`;
    default:
      return `<div class="escena ${tema.separador}" role="separator">${ORNAMENTOS[tema.separador] ?? ORNAMENTOS.asteriscos}</div>`;
  }
}

/** Contenido del título de capítulo: «Capítulo 3» y «El gremio» en elementos separados para poder darles estilo. */
export function contenidoTitulo(titulo: string): string {
  const p = partesTitulo(titulo);
  if (!p) return `<span class="nombre">${esc(titulo)}</span>`;
  return `<span class="etiqueta">${esc(p.etiqueta)}</span><span class="sep">${esc(p.sep)}</span><span class="nombre">${esc(p.nombre)}</span>`;
}

export function cssTema(tema: Tema, familiaTexto: string, familiaTitulos: string): string {
  const alineacion = tema.tituloEstilo === 'izquierda' || tema.tituloEstilo === 'linea' ? 'left' : 'center';
  const titulos = `h1, h2, h3 { font-family: ${familiaTitulos}; color: ${tema.colorTitulos}; text-align: ${alineacion}; }`;
  const reglas: string[] = [titulos];
  reglas.push(`h1 { font-size: ${tema.tituloTamano}em; ${tema.tituloMayusculas ? 'font-variant: small-caps; letter-spacing: 0.04em;' : ''} }`);
  reglas.push(`h1 .etiqueta, h1 .nombre, h1 .sep { font-family: inherit; }`);
  if (tema.tituloEstilo === 'numero-grande') {
    reglas.push(
      `h1 .etiqueta { display: block; font-size: 0.45em; font-weight: normal; letter-spacing: 0.18em; font-variant: small-caps; color: ${tema.colorAcento}; margin-bottom: 0.5em; }`,
      `h1 .sep { display: none; }`,
      `h1 .nombre { display: block; }`,
    );
  }
  if (tema.tituloEstilo === 'linea') {
    reglas.push(`h1 { border-bottom: 1px solid ${tema.colorAcento}; padding-bottom: 0.3em; }`);
  }
  if (tema.capitular === 'letra') {
    reglas.push(
      `h1 + p::first-letter, .cabecera-capitulo + p::first-letter { float: left; font-family: ${familiaTitulos}; font-size: 3.2em; line-height: 0.82; margin: 0.06em 0.08em 0 0; color: ${tema.colorAcento}; font-weight: normal; font-style: normal; }`,
    );
  }
  if (tema.primeraLinea) {
    reglas.push(`h1 + p::first-line, .cabecera-capitulo + p::first-line { font-variant: small-caps; letter-spacing: 0.03em; }`);
  }
  reglas.push(
    `.escena { color: ${tema.colorAcento}; }`,
    `.escena.flor { font-size: 1.4em; line-height: 1; }`,
    `.escena.rombos { font-size: 0.75em; }`,
    `.escena.imagen img { max-width: 35%; max-height: 3em; }`,
    `hr.escena { border: 0; border-top: 1px solid ${tema.colorAcento}; }`,
    `.cabecera-capitulo { text-align: center; margin: 0 0 1em; text-indent: 0; }`,
    `.cabecera-capitulo img { max-width: 100%; max-height: 30vh; }`,
  );
  void familiaTexto;
  return reglas.join('\n');
}
