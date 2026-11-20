// Informe de accesibilidad: axe-core sobre cada documento del EPUB compilado (en un navegador real,
// con su CSS) más las comprobaciones propias de EPUB Accessibility 1.1 sobre el modelo y los metadatos.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import type { Libro } from './model.js';
import { TIPOS_SECCION } from './model.js';
import { archivoSeccion, compilarArchivos } from './compilar.js';
import { buscarNavegador } from './pdf.js';
import { rutaRecurso } from './recursos.js';

/** Abre cada URL y evalúa `codigo` (una expresión que devuelve una promesa); devuelve los resultados en orden. */
export type Evaluador = (urls: string[], codigo: string) => Promise<unknown[]>;

export type Impacto = 'critical' | 'serious' | 'moderate' | 'minor';

export interface Incidencia {
  regla: string;
  impacto: Impacto;
  descripcion: string;
  ayuda: string;
  url: string;
  /** Documento del EPUB. */
  archivo: string;
  seccion?: string;
  tituloSeccion?: string;
  /** Fragmentos HTML afectados (hasta 3). */
  nodos: string[];
  cantidad: number;
}

export interface Comprobacion {
  nombre: string;
  ok: boolean;
  detalle: string;
  seccion?: string;
}

export interface InformeAccesibilidad {
  fecha: string;
  titulo: string;
  version: string;
  documentos: number;
  comprobaciones: Comprobacion[];
  incidencias: Incidencia[];
  /** Si el libro puede declarar EPUB Accessibility 1.1 / WCAG 2.1 AA. */
  conforme: boolean;
}

const IMPACTO_ES: Record<Impacto, string> = { critical: 'Crítico', serious: 'Grave', moderate: 'Moderado', minor: 'Menor' };

// Reglas que no tienen sentido en un libro: un EPUB no es una web con regiones, saltos de navegación ni un único <main>.
const REGLAS_FUERA = ['region', 'landmark-one-main', 'page-has-heading-one', 'bypass', 'landmark-unique', 'skip-link'];

let fuenteAxe: Promise<string> | undefined;

async function codigoAxe(): Promise<string> {
  fuenteAxe ??= (async () => {
    const ruta = rutaRecurso('axe', 'axe.min.js') ?? createRequire(import.meta.url).resolve('axe-core/axe.min.js');
    const local = rutaRecurso('axe', 'es.json') ?? createRequire(import.meta.url).resolve('axe-core/locales/es.json');
    const [axe, es] = await Promise.all([readFile(ruta, 'utf8'), readFile(local, 'utf8')]);
    const ejecutar = `
      (async () => {
        axe.configure({ locale: ${es} });
        const r = await axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
          rules: Object.fromEntries(${JSON.stringify(REGLAS_FUERA)}.map((id) => [id, { enabled: false }])),
          resultTypes: ['violations'],
        });
        return JSON.stringify({ version: axe.version, violaciones: r.violations.map((v) => ({
          id: v.id, impact: v.impact, description: v.description, help: v.help, helpUrl: v.helpUrl,
          nodos: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 300)), cantidad: v.nodes.length,
        })) });
      })()`;
    return `${axe};\n${ejecutar}`;
  })();
  return fuenteAxe;
}

/** Evaluador con un Chrome/Edge del sistema (línea de comandos, pruebas y modo navegador). */
export function evaluadorChrome(): Evaluador {
  return async (urls, codigo) => {
    const ejecutable = buscarNavegador();
    if (!ejecutable) throw new Error('Para revisar la accesibilidad fuera de la app de escritorio hace falta Chrome o Edge instalado (o la variable OBI_CHROME).');
    const { chromium } = await import('playwright-core');
    const navegador = await chromium.launch({ executablePath: ejecutable, args: ['--no-sandbox'] });
    try {
      const pagina = await navegador.newPage();
      const salida: unknown[] = [];
      for (const url of urls) {
        await pagina.goto(url, { waitUntil: 'load' });
        salida.push(await pagina.evaluate(codigo));
      }
      return salida;
    } finally {
      await navegador.close();
    }
  };
}

const TIPOS: Record<string, string> = {
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Comprobaciones sobre el modelo que axe no puede ver (EPUB Accessibility 1.1). */
export function comprobacionesLibro(libro: Libro): Comprobacion[] {
  const c: Comprobacion[] = [];
  const m = libro.metadatos;
  c.push({ nombre: 'Idioma del libro', ok: !!m.idioma, detalle: m.idioma ? `Declarado: ${m.idioma}.` : 'Falta el idioma en los metadatos.' });
  c.push({ nombre: 'Título', ok: !!m.titulo.trim(), detalle: m.titulo.trim() ? 'El libro tiene título.' : 'El libro no tiene título.' });
  const sinTitulo = libro.secciones.filter((s) => s.enIndice && !s.titulo.trim() && !['portada', 'ilustracion'].includes(s.tipo));
  c.push({
    nombre: 'Índice navegable',
    ok: sinTitulo.length === 0,
    detalle: sinTitulo.length
      ? `${sinTitulo.length} sección(es) del índice sin título: los lectores de pantalla las anuncian como «${TIPOS_SECCION.find((t) => t.id === sinTitulo[0].tipo)?.nombre}».`
      : 'Todas las secciones del índice tienen título.',
    ...(sinTitulo[0] ? { seccion: sinTitulo[0].id } : {}),
  });
  let sinAlt = 0;
  let primera: string | undefined;
  for (const s of libro.secciones)
    for (const b of s.bloques)
      if (b.tipo === 'imagen' && !b.decorativa && !b.alt.trim()) {
        sinAlt++;
        primera ??= s.id;
      }
  c.push({
    nombre: 'Descripción de las imágenes',
    ok: sinAlt === 0,
    detalle: sinAlt ? `${sinAlt} imagen(es) sin descripción ni marca de decorativa.` : 'Todas las imágenes tienen descripción o están marcadas como decorativas.',
    ...(primera ? { seccion: primera } : {}),
  });
  const resumen = (m.resumenAccesibilidad ?? '').trim();
  c.push({
    nombre: 'Resumen de accesibilidad',
    ok: true,
    detalle: resumen ? 'Escrito por el autor.' : 'Se usa el resumen automático (puedes escribir uno propio en la pestaña Libro).',
  });
  c.push({ nombre: 'Metadatos EPUB Accessibility 1.1', ok: true, detalle: 'accessMode, accessModeSufficient, accessibilityFeature, accessibilityHazard, accessibilitySummary y conformsTo se generan solos.' });
  if (libro.escritura === 'vertical')
    c.push({ nombre: 'Escritura vertical', ok: true, detalle: 'Avance de páginas de derecha a izquierda declarado en el spine; tate-chū-yoko automático.' });
  return c;
}

/** Revisa la accesibilidad del libro: sirve el EPUB compilado en un servidor temporal y pasa axe a cada documento. */
export async function revisarAccesibilidad(libro: Libro, evaluar: Evaluador): Promise<InformeAccesibilidad> {
  const archivos = compilarArchivos(libro);
  const servidor = createServer((req, res) => {
    const ruta = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.slice(1));
    const d = archivos.get(ruta);
    if (d === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[extname(ruta)] ?? 'application/octet-stream' });
    res.end(typeof d === 'string' ? d : Buffer.from(d));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  try {
    const documentos = ['nav.xhtml', ...libro.secciones.map(archivoSeccion)].filter((a) => archivos.has(a));
    const resultados = await evaluar(
      documentos.map((a) => `http://127.0.0.1:${puerto}/${encodeURI(a)}`),
      await codigoAxe(),
    );
    const incidencias: Incidencia[] = [];
    let version = '';
    resultados.forEach((r, k) => {
      const d = JSON.parse(String(r)) as { version: string; violaciones: { id: string; impact: Impacto; description: string; help: string; helpUrl: string; nodos: string[]; cantidad: number }[] };
      version = d.version;
      const archivo = documentos[k];
      const s = libro.secciones.find((x) => archivoSeccion(x) === archivo);
      for (const v of d.violaciones)
        incidencias.push({
          regla: v.id,
          impacto: v.impact ?? 'minor',
          descripcion: v.description,
          ayuda: v.help,
          url: v.helpUrl,
          archivo,
          ...(s ? { seccion: s.id, tituloSeccion: s.titulo || TIPOS_SECCION.find((t) => t.id === s.tipo)?.nombre } : { tituloSeccion: 'Índice (nav)' }),
          nodos: v.nodos,
          cantidad: v.cantidad,
        });
    });
    const orden: Impacto[] = ['critical', 'serious', 'moderate', 'minor'];
    incidencias.sort((a, b) => orden.indexOf(a.impacto) - orden.indexOf(b.impacto));
    const comprobaciones = comprobacionesLibro(libro);
    return {
      fecha: new Date().toISOString(),
      titulo: libro.metadatos.titulo,
      version,
      documentos: documentos.length,
      comprobaciones,
      incidencias,
      conforme: comprobaciones.every((c) => c.ok) && !incidencias.some((i) => i.impacto === 'critical' || i.impacto === 'serious'),
    };
  } finally {
    servidor.close();
  }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Informe en HTML autónomo, para guardar o enviar. */
export function informeHtml(i: InformeAccesibilidad): string {
  const filas = i.incidencias
    .map(
      (x) => `<tr><td><span class="imp ${x.impacto}">${IMPACTO_ES[x.impacto]}</span></td><td>${esc(x.ayuda)}<br><small>${esc(x.descripcion)} · <a href="${esc(x.url)}">${esc(x.regla)}</a></small></td><td>${esc(x.tituloSeccion ?? x.archivo)}</td><td>${x.cantidad}</td><td>${x.nodos.map((n) => `<code>${esc(n)}</code>`).join('<br>')}</td></tr>`,
    )
    .join('');
  const comp = i.comprobaciones.map((c) => `<li class="${c.ok ? 'ok' : 'mal'}">${c.ok ? '✓' : '✕'} <strong>${esc(c.nombre)}</strong>: ${esc(c.detalle)}</li>`).join('');
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Informe de accesibilidad — ${esc(i.titulo)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#222}
h1{font-size:1.5rem}.estado{padding:.8rem 1rem;border-radius:8px;font-weight:600}
.estado.si{background:#e5f2e7;color:#1f5a2b}.estado.no{background:#fbe9e7;color:#8a1f12}
ul{padding-left:1.2rem}li.ok{color:#1f5a2b}li.mal{color:#8a1f12}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}
code{font-size:12px;word-break:break-all}.imp{font-weight:600}.critical,.serious{color:#8a1f12}.moderate{color:#7a5200}.minor{color:#555}
</style></head><body>
<h1>Informe de accesibilidad: ${esc(i.titulo)}</h1>
<p>${new Date(i.fecha).toLocaleString('es-MX')} · ${i.documentos} documentos revisados con axe-core ${esc(i.version)} (WCAG 2.1 A y AA y buenas prácticas) y las comprobaciones de EPUB Accessibility 1.1 de Obi Studio.</p>
<p class="estado ${i.conforme ? 'si' : 'no'}">${i.conforme ? 'Sin problemas graves: el libro puede declarar EPUB Accessibility 1.1 – WCAG 2.1 AA.' : 'Hay problemas que corregir antes de declarar EPUB Accessibility 1.1 – WCAG 2.1 AA.'}</p>
<h2>Comprobaciones del libro</h2><ul>${comp}</ul>
<h2>Incidencias (${i.incidencias.length})</h2>
${i.incidencias.length ? `<table><thead><tr><th>Impacto</th><th>Problema</th><th>Sección</th><th>Casos</th><th>Ejemplos</th></tr></thead><tbody>${filas}</tbody></table>` : '<p>axe no encontró incidencias.</p>'}
</body></html>`;
}
