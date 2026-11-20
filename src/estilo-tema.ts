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
  reglas.push(`h1 { font-size: ${tema.tituloTamano}em; ${tema.tituloMayusculas ? 'font-variant: small-caps; letter-spacing: 0.04em;' : ''}${tema.tituloEnMayusculas ? ' text-transform: uppercase;' : ''} }`);
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
  if (tema.espaciadoLetras) reglas.push(`p { letter-spacing: ${tema.espaciadoLetras}em; }`);
  if (tema.espaciadoPalabras) reglas.push(`p { word-spacing: ${tema.espaciadoPalabras}em; }`);
  reglas.push(cssRecuadros(tema));
  void familiaTexto;
  return reglas.join('\n');
}

/** Recuadros de novela ligera (ventanas de sistema, estado, chat, diario…). Medidas relativas para el EPUB. */
export function cssRecuadros(tema: Tema): string {
  const a = tema.colorAcento;
  return [
    `div.recuadro { margin: 1em 0; padding: 0.6em 0.9em; border: 1px solid ${a}; border-radius: 0.35em; page-break-inside: avoid; break-inside: avoid; }`,
    `div.recuadro p { text-indent: 0; margin: 0.25em 0 0; text-align: left; }`,
    `div.recuadro p:first-child { margin-top: 0; }`,
    `div.recuadro p.recuadro-titulo { font-weight: bold; text-align: center; margin: 0 0 0.4em; padding-bottom: 0.3em; border-bottom: 1px solid ${a}; }`,
    `div.recuadro-sistema { border: 3px double ${a}; font-family: sans-serif; font-size: 0.95em; }`,
    `div.recuadro-notificacion { border-width: 1px 0; border-radius: 0; padding: 0.4em 0; text-align: center; font-weight: bold; }`,
    `div.recuadro-notificacion p { text-align: center; }`,
    `div.recuadro-estado { font-family: sans-serif; font-size: 0.95em; }`,
    `div.recuadro-estado span.etiqueta { display: inline-block; min-width: 7em; font-weight: bold; }`,
    `div.recuadro-chat { border-style: none; padding: 0.3em 0; }`,
    `div.recuadro-chat p.recuadro-titulo { font-size: 0.85em; font-weight: normal; border-bottom-style: dotted; }`,
    `div.recuadro-chat p.mensaje { margin: 0.45em 0 0; }`,
    `div.recuadro-chat p.der { text-align: right; }`,
    `div.recuadro-chat span.emisor { display: block; font-size: 0.75em; font-weight: bold; }`,
    `div.recuadro-chat span.globo { display: inline-block; text-align: left; max-width: 80%; padding: 0.3em 0.75em; border: 1px solid ${a}; border-radius: 0.9em; }`,
    `div.recuadro-chat p.der span.globo { border-width: 2px; }`,
    `div.recuadro-diario { border-width: 0 0 0 3px; border-radius: 0; font-style: italic; padding: 0.2em 0 0.2em 1em; }`,
    `div.recuadro-diario p.recuadro-titulo { text-align: right; border-bottom: 0; font-style: normal; font-size: 0.9em; }`,
    `div.recuadro-nota { border-style: dashed; margin-left: 1.5em; margin-right: 1.5em; }`,
    `div.recuadro-nota p.recuadro-titulo { text-align: left; font-size: 0.9em; border-bottom-style: dashed; }`,
  ].join('\n');
}
