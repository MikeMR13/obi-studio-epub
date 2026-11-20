// Catálogos de plugins: el integrado (recursos/plugins) y los que el usuario añade por URL.
// Cada paquete se comprueba con su huella SHA-256 y su manifiesto debe coincidir con el del catálogo.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ErrorPlugin, leerPlugin, validarManifiesto, type Manifiesto } from './plugins.js';
import { rutaRecurso } from './recursos.js';

export const CATALOGO_INTEGRADO = 'integrado';

export interface EntradaCatalogo extends Omit<Manifiesto, 'extensiones' | 'salida'> {
  archivo: string;
  sha256: string;
  /** De qué catálogo viene (URL o «integrado»). */
  origen: string;
  nombreCatalogo: string;
}

const MAX_CATALOGO = 2 * 1024 * 1024;
const MAX_PLUGIN = 5 * 1024 * 1024;

async function descargar(url: string, maximo: number): Promise<Uint8Array> {
  if (!/^https:\/\//.test(url)) throw new ErrorPlugin('Los catálogos externos deben usar https://.');
  let r: Response;
  try {
    r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new ErrorPlugin(`No se pudo conectar con ${new URL(url).host}: ${(e as Error).message}`);
  }
  if (!r.ok) throw new ErrorPlugin(`${url} respondió ${r.status}.`);
  const datos = new Uint8Array(await r.arrayBuffer());
  if (datos.length > maximo) throw new ErrorPlugin(`${url} es demasiado grande.`);
  return datos;
}

/** URL del catalogo.json: se acepta la de la carpeta o la del archivo. */
export function normalizarUrlCatalogo(url: string): string {
  const u = url.trim();
  let p: URL;
  try {
    p = new URL(u);
  } catch {
    throw new ErrorPlugin('Escribe la dirección completa del catálogo (https://…).');
  }
  if (p.protocol !== 'https:') throw new ErrorPlugin('Los catálogos externos deben usar https://.');
  return p.pathname.endsWith('.json') ? p.href : p.href.replace(/\/?$/, '/catalogo.json');
}

export async function leerCatalogo(origen: string): Promise<EntradaCatalogo[]> {
  let texto: string;
  if (origen === CATALOGO_INTEGRADO) {
    const ruta = rutaRecurso('plugins', 'catalogo.json');
    if (!ruta) return [];
    texto = await readFile(ruta, 'utf8');
  } else {
    texto = new TextDecoder().decode(await descargar(origen, MAX_CATALOGO));
  }
  let d: { formato?: string; nombre?: string; plugins?: unknown[] };
  try {
    d = JSON.parse(texto);
  } catch {
    throw new ErrorPlugin(`${origen} no es un catálogo válido (JSON).`);
  }
  if (d.formato !== 'obi-catalogo' || !Array.isArray(d.plugins)) throw new ErrorPlugin(`${origen} no es un catálogo de Obi Studio.`);
  const nombreCatalogo = typeof d.nombre === 'string' ? d.nombre.slice(0, 80) : origen;
  const salida: EntradaCatalogo[] = [];
  for (const e of d.plugins.slice(0, 500) as Record<string, unknown>[]) {
    try {
      const m = validarManifiesto({ ...e, extensiones: e.extensiones ?? ['x'], salida: e.salida ?? { extension: 'x', tipoMime: 'x' } });
      if (typeof e.archivo !== 'string' || !/^[\w.-]+\.obiplugin$/.test(e.archivo)) continue;
      if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) continue;
      const { extensiones: _x, salida: _s, ...resto } = m;
      salida.push({ ...resto, archivo: e.archivo, sha256: e.sha256, origen, nombreCatalogo });
    } catch {
      // Una entrada mal escrita no estropea el resto del catálogo.
    }
  }
  return salida;
}

/** Descarga (o lee) el paquete, comprueba su huella y que su manifiesto sea el anunciado. */
export async function paqueteDeCatalogo(e: EntradaCatalogo): Promise<Uint8Array> {
  let datos: Uint8Array;
  if (e.origen === CATALOGO_INTEGRADO) {
    const ruta = rutaRecurso('plugins', e.archivo);
    if (!ruta) throw new ErrorPlugin(`Falta el paquete ${e.archivo} del catálogo integrado.`);
    datos = new Uint8Array(await readFile(ruta));
  } else {
    datos = await descargar(new URL(e.archivo, e.origen).href, MAX_PLUGIN);
  }
  if (createHash('sha256').update(datos).digest('hex') !== e.sha256)
    throw new ErrorPlugin(`La huella de «${e.nombre}» no coincide con la del catálogo: el paquete se ha modificado. No se instala.`);
  const p = await leerPlugin(datos);
  if (p.manifiesto.id !== e.id || p.manifiesto.version !== e.version) throw new ErrorPlugin(`El paquete de «${e.nombre}» no coincide con el catálogo.`);
  if (JSON.stringify([...p.manifiesto.permisos].sort()) !== JSON.stringify([...e.permisos].sort()))
    throw new ErrorPlugin(`«${e.nombre}» pide permisos distintos de los que anuncia el catálogo. No se instala.`);
  return datos;
}

/** Lista de catálogos externos guardada junto a los plugins. */
export class ListaCatalogos {
  constructor(private archivo: string) {}

  async leer(): Promise<string[]> {
    try {
      const d = JSON.parse(await readFile(this.archivo, 'utf8'));
      return Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  async guardar(urls: string[]) {
    await mkdir(dirname(this.archivo), { recursive: true });
    await writeFile(this.archivo, JSON.stringify([...new Set(urls)], null, 2));
  }
}

export function archivoCatalogos(carpetaPlugins: string): string {
  return join(carpetaPlugins, 'catalogos.json');
}

/** Compara versiones «1.2.3» (las partes no numéricas cuentan como 0). */
export function versionMayor(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) if ((pa[k] ?? 0) !== (pb[k] ?? 0)) return (pa[k] ?? 0) > (pb[k] ?? 0);
  return false;
}
