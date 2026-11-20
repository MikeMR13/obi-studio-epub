// Entrega por HTTP lo que necesita el visor de Vivliostyle: el libro de impresión, sus imágenes, las fuentes y el visor.

import { archivosCubierta, posprocesarCubierta } from './cubierta.js';
import { aGrises } from './procesar-imagen.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { Libro } from './model.js';
import { archivosImpresion } from './impresion.js';
import { dividirLibro } from './division.js';
import { ajustesImpresion } from './model.js';
import { rutaRecurso } from './recursos.js';
import { generarPdf, urlVisor, renderizadorChrome, type Renderizador, type TipoPdf, type ResultadoPdf } from './pdf.js';

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

export interface Respuesta {
  tipo: string;
  datos: string | Uint8Array;
}

/** Libro preparado para compaginar (con división silábica si está activada). */
export async function libroParaImprimir(libro: Libro, digital = false): Promise<Libro> {
  const a = ajustesImpresion(libro);
  let l = a.division ? await dividirLibro(libro) : libro;
  if (a.grises && !digital) {
    // Mismo nombre de archivo salvo los GIF (pasan a PNG): se mantienen las rutas.
    const recursos = await Promise.all(l.recursos.map(async (r) => (r.tipoMime === 'image/gif' ? r : aGrises(r).catch(() => r))));
    l = { ...l, recursos };
  }
  return l;
}

/**
 * Resuelve una ruta del servicio de impresión:
 *   /vivliostyle/…                     visor (público)
 *   /impresion/<clave>/<v>/fuentes/…   fuentes
 *   /impresion/<clave>/<v>/…           libro.html, impresion.css, img/…
 */
export async function resolverImpresion(
  ruta: string,
  clave: string,
  archivos: (version: string) => Promise<Map<string, string | Uint8Array>>,
): Promise<Respuesta | undefined> {
  if (ruta.startsWith('/vivliostyle/')) {
    const base = rutaRecurso('vivliostyle');
    if (!base) return undefined;
    const relativa = normalize(decodeURIComponent(ruta.slice('/vivliostyle/'.length))).replace(/^(\.\.[/\\])+/, '');
    try {
      return { tipo: TIPOS[extname(relativa)] ?? 'application/octet-stream', datos: new Uint8Array(await readFile(join(base, relativa))) };
    } catch {
      return undefined;
    }
  }
  const m = ruta.match(/^\/impresion\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m || m[1] !== clave) return undefined;
  const archivo = decodeURIComponent(m[3]);
  if (archivo.startsWith('fuentes/')) {
    const f = rutaRecurso('fuentes', archivo.slice('fuentes/'.length).replace(/[/\\]/g, ''));
    // Si no está en recursos/fuentes, es una fuente propia del libro (va en los archivos de la versión).
    if (f) return { tipo: 'font/woff2', datos: new Uint8Array(await readFile(f)) };
  }
  const d = (await archivos(m[2])).get(archivo);
  return d === undefined ? undefined : { tipo: TIPOS[extname(archivo)] ?? 'application/octet-stream', datos: d };
}

/** PDF desde la línea de comandos o las pruebas: levanta un servidor temporal y usa Chrome. */
export async function pdfDesdeLibro(libro: Libro, tipo: TipoPdf, renderizar: Renderizador = renderizadorChrome()): Promise<ResultadoPdf> {
  const preparado = await libroParaImprimir(libro, tipo === 'digital');
  const clave = globalThis.crypto.randomUUID();
  const versiones = new Map<string, Map<string, string | Uint8Array>>();
  let contador = 0;
  const servidor = createServer(async (req, res) => {
    const r = await resolverImpresion(new URL(req.url ?? '/', 'http://x').pathname, clave, async (v) => versiones.get(v) ?? new Map());
    if (!r) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': r.tipo });
    res.end(typeof r.datos === 'string' ? r.datos : Buffer.from(r.datos));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  try {
    return await generarPdf(
      libro,
      tipo,
      async (interior) => {
        const v = String(++contador);
        versiones.set(v, archivosImpresion(preparado, { interior, digital: tipo === 'digital' }));
        return urlVisor(`http://127.0.0.1:${puerto}`, clave, Number(v));
      },
      renderizar,
    );
  } finally {
    servidor.close();
  }
}

/** PDF de la cubierta de imprenta desde la línea de comandos o las pruebas. */
export async function cubiertaDesdeLibro(libro: Libro, paginas: number, renderizar: Renderizador = renderizadorChrome()): Promise<Uint8Array> {
  const clave = globalThis.crypto.randomUUID();
  const archivos = archivosCubierta(libro, paginas);
  const servidor = createServer(async (req, res) => {
    const r = await resolverImpresion(new URL(req.url ?? '/', 'http://x').pathname, clave, async () => archivos);
    if (!r) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': r.tipo });
    res.end(typeof r.datos === 'string' ? r.datos : Buffer.from(r.datos));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  try {
    return await posprocesarCubierta(await renderizar(urlVisor(`http://127.0.0.1:${puerto}`, clave, 1)), libro, paginas);
  } finally {
    servidor.close();
  }
}
