// Plugins de Obi Studio.
//
// Un plugin es un archivo .obiplugin (ZIP) con:
//   manifiesto.json  — id, nombre, versión, autor, descripción, tipos y permisos
//   principal.js     — un script que llama a obi.registrar({ revisar, transformar, exportar, importar })
//
// Aislamiento, en dos capas:
//  1. Cada ejecución corre en un proceso aparte con el modelo de permisos de Node: sin disco (salvo el
//     propio anfitrión), sin procesos hijos, sin hilos ni módulos nativos, con memoria y tiempo limitados.
//  2. Dentro de ese proceso, el código va en un contexto vm vacío: no hay require, process, Buffer ni fetch.
//     Los datos entran y salen como texto JSON, así que no cruza ningún objeto del anfitrión.
// El plugin solo ve el modelo del libro (no el disco). Las imágenes solo con el permiso «recursos» y la
// red solo con el permiso «red», que el autor aprueba al instalarlo.

import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { Bloque, Inline, Libro, Recurso } from './model.js';
import { ESTILOS_PARRAFO, MARCAS, TIPOS_SECCION, validarTema } from './model.js';
import { errorXhtml } from './formatos/dom.js';

export type TipoPlugin = 'revision' | 'transformacion' | 'exportador' | 'importador';
export type Permiso = 'red' | 'recursos';

export const TIPOS_PLUGIN: { id: TipoPlugin; nombre: string; funcion: string }[] = [
  { id: 'revision', nombre: 'Revisión', funcion: 'revisar' },
  { id: 'transformacion', nombre: 'Transformación', funcion: 'transformar' },
  { id: 'exportador', nombre: 'Exportador', funcion: 'exportar' },
  { id: 'importador', nombre: 'Importador', funcion: 'importar' },
];

export const PERMISOS: { id: Permiso; descripcion: string }[] = [
  { id: 'recursos', descripcion: 'Leer y cambiar las imágenes del libro' },
  { id: 'red', descripcion: 'Conectarse a internet' },
];

export interface Manifiesto {
  id: string;
  nombre: string;
  version: string;
  autor: string;
  descripcion: string;
  tipos: TipoPlugin[];
  permisos: Permiso[];
  /** Importadores: extensiones que abre (sin punto). */
  extensiones?: string[];
  /** Exportadores: extensión y tipo MIME del archivo que produce. */
  salida?: { extension: string; tipoMime: string };
}

export interface Plugin {
  manifiesto: Manifiesto;
  codigo: string;
}

export interface Hallazgo {
  gravedad: 'error' | 'aviso' | 'info';
  mensaje: string;
  /** Id de la sección afectada, si la hay. */
  seccion?: string;
}

export class ErrorPlugin extends Error {}

const MAX_CODIGO = 2 * 1024 * 1024;

function texto(v: unknown, campo: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim()) throw new ErrorPlugin(`El manifiesto no tiene «${campo}».`);
  if (v.length > max) throw new ErrorPlugin(`El campo «${campo}» del manifiesto es demasiado largo.`);
  return v.trim();
}

export function validarManifiesto(entrada: unknown): Manifiesto {
  if (!entrada || typeof entrada !== 'object') throw new ErrorPlugin('El manifiesto no es un objeto JSON.');
  const e = entrada as Record<string, unknown>;
  const id = texto(e.id, 'id', 80);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new ErrorPlugin('El id del plugin solo admite minúsculas, números, punto, guion y guion bajo.');
  const tipos = Array.isArray(e.tipos) ? e.tipos : [];
  const validos = TIPOS_PLUGIN.map((t) => t.id) as string[];
  if (!tipos.length || tipos.some((t) => !validos.includes(t as string)))
    throw new ErrorPlugin(`«tipos» debe ser una lista con alguno de: ${validos.join(', ')}.`);
  const permisos = Array.isArray(e.permisos) ? e.permisos : [];
  const permitidos = PERMISOS.map((p) => p.id) as string[];
  const desconocido = permisos.find((p) => !permitidos.includes(p as string));
  if (desconocido !== undefined) throw new ErrorPlugin(`Permiso desconocido: «${String(desconocido)}».`);
  const m: Manifiesto = {
    id,
    nombre: texto(e.nombre, 'nombre', 80),
    version: texto(e.version, 'version', 30),
    autor: texto(e.autor, 'autor', 120),
    descripcion: typeof e.descripcion === 'string' ? e.descripcion.slice(0, 500) : '',
    tipos: [...new Set(tipos as TipoPlugin[])],
    permisos: [...new Set(permisos as Permiso[])],
  };
  if (m.tipos.includes('importador')) {
    const ext = Array.isArray(e.extensiones) ? e.extensiones.filter((x): x is string => typeof x === 'string' && /^[a-z0-9]{1,10}$/.test(x)) : [];
    if (!ext.length) throw new ErrorPlugin('Un importador debe declarar «extensiones», por ejemplo ["txt"].');
    m.extensiones = ext;
  }
  if (m.tipos.includes('exportador')) {
    const s = e.salida as Record<string, unknown> | undefined;
    if (!s || typeof s.extension !== 'string' || !/^[a-z0-9.]{1,15}$/.test(s.extension) || typeof s.tipoMime !== 'string')
      throw new ErrorPlugin('Un exportador debe declarar «salida»: { "extension": "…", "tipoMime": "…" }.');
    m.salida = { extension: s.extension, tipoMime: s.tipoMime.slice(0, 100) };
  }
  return m;
}

/** Lee un .obiplugin (ZIP con manifiesto.json y principal.js). */
export async function leerPlugin(datos: Uint8Array): Promise<Plugin> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(datos);
  } catch {
    throw new ErrorPlugin('El archivo no es un plugin de Obi Studio (.obiplugin).');
  }
  const json = await zip.file('manifiesto.json')?.async('string');
  if (!json) throw new ErrorPlugin('Al plugin le falta manifiesto.json.');
  let crudo: unknown;
  try {
    crudo = JSON.parse(json);
  } catch (e) {
    throw new ErrorPlugin(`manifiesto.json no es JSON válido: ${(e as Error).message}`);
  }
  const manifiesto = validarManifiesto(crudo);
  const codigo = await zip.file('principal.js')?.async('string');
  if (!codigo) throw new ErrorPlugin('Al plugin le falta principal.js.');
  if (codigo.length > MAX_CODIGO) throw new ErrorPlugin('principal.js supera los 2 MB.');
  return { manifiesto, codigo };
}

/** Empaqueta un plugin (para el SDK y las pruebas). */
export async function empaquetarPlugin(manifiesto: Manifiesto, codigo: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('manifiesto.json', JSON.stringify(manifiesto, null, 2));
  zip.file('principal.js', codigo);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------------------
// Anfitrión: el proceso aislado.

const ANFITRION = String.raw`'use strict';
const vm = require('node:vm');
const PRELUDIO = ${'`'}
(() => {
  const puente = globalThis.__puente;
  delete globalThis.__puente;
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const T = {}; for (let k = 0; k < 64; k++) T[A[k]] = k;
  const aBytes = (s) => {
    s = s.replace(/=+$/, '');
    const out = new Uint8Array(Math.floor(s.length * 3 / 4));
    let buf = 0, bits = 0, j = 0;
    for (let k = 0; k < s.length; k++) { buf = (buf << 6) | T[s[k]]; bits += 6; if (bits >= 8) { bits -= 8; out[j++] = (buf >> bits) & 255; } buf &= 0xffff; }
    return out;
  };
  const aBase64 = (b) => {
    let s = '';
    for (let k = 0; k < b.length; k += 3) {
      const n = (b[k] << 16) | ((b[k + 1] ?? 0) << 8) | (b[k + 2] ?? 0);
      s += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (k + 1 < b.length ? A[(n >> 6) & 63] : '=') + (k + 2 < b.length ? A[n & 63] : '=');
    }
    return s;
  };
  const leer = (t) => JSON.parse(t, (_k, v) => (v && typeof v === 'object' && typeof v.__u8 === 'string' ? aBytes(v.__u8) : v));
  const escribir = (v) => JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? { __u8: aBase64(x) } : x));
  let hooks = null;
  const registros = [];
  const texto = (inlines) => (inlines || []).map((i) => (i.tipo === 'texto' ? i.texto : i.tipo === 'ruby' ? i.base : i.tipo === 'salto' ? '\\n' : '')).join('');
  const obi = Object.freeze({
    version: 1,
    registrar(h) { if (hooks) throw new Error('obi.registrar solo se puede llamar una vez.'); hooks = h; },
    texto,
    textoBloque(b) { return b.tipo === 'lista' ? b.elementos.map(texto).join('\\n') : b.tipo === 'parrafo' || b.tipo === 'subtitulo' ? texto(b.contenido) : ''; },
  });
  const consola = Object.freeze({
    log: (...a) => { if (registros.length < 200) registros.push(a.map(String).join(' ').slice(0, 2000)); },
    warn: (...a) => consola.log(...a),
    error: (...a) => consola.log(...a),
  });
  globalThis.obi = obi;
  globalThis.console = consola;
  if (puente.red) {
    globalThis.fetch = (url, op) => new Promise((ok, mal) => {
      puente.llamar('fetch', escribir({ url: String(url), metodo: op && op.method, cuerpo: op && typeof op.body === 'string' ? op.body : undefined }), (error, r) => {
        if (error) return mal(new Error(error));
        const d = JSON.parse(r);
        ok(Object.freeze({ ok: d.estado >= 200 && d.estado < 300, status: d.estado, text: () => Promise.resolve(d.texto), json: () => Promise.resolve(JSON.parse(d.texto)) }));
      });
    });
  }
  return {
    async ejecutar(funcion, entradaTexto) {
      if (!hooks) throw new Error('El plugin no llamó a obi.registrar(...).');
      if (typeof hooks[funcion] !== 'function') throw new Error('El plugin no define ' + funcion + '().');
      const args = leer(entradaTexto);
      const r = await hooks[funcion](...args);
      return escribir({ resultado: r === undefined ? null : r, registros });
    },
  };
})()
${'`'};
process.once('message', async (m) => {
  const responder = (x) => { process.send(x, () => process.exit(0)); };
  try {
    const puente = {
      red: m.permisos.includes('red'),
      llamar(op, datos, cb) {
        if (op !== 'fetch' || !this.red) return cb('Operación no permitida.');
        const d = JSON.parse(datos);
        if (!/^https?:\/\//.test(d.url)) return cb('Solo se permiten URL http(s).');
        fetch(d.url, { method: d.metodo || 'GET', body: d.cuerpo })
          .then(async (r) => cb(null, JSON.stringify({ estado: r.status, texto: (await r.text()).slice(0, 5000000) })))
          .catch((e) => cb(String(e && e.message || e)));
      },
    };
    const ctx = vm.createContext({ __puente: puente }, { codeGeneration: { strings: false, wasm: false } });
    const api = vm.runInContext(PRELUDIO, ctx, { timeout: 2000 });
    vm.runInContext(m.codigo, ctx, { filename: 'principal.js', timeout: 5000 });
    const salida = await api.ejecutar(m.funcion, m.entrada);
    responder({ ok: String(salida) });
  } catch (e) {
    responder({ error: String((e && e.message) || e).slice(0, 2000) });
  }
});
`;

let rutaAnfitrion: Promise<string> | undefined;

function anfitrion(): Promise<string> {
  rutaAnfitrion ??= (async () => {
    const hash = createHash('sha256').update(ANFITRION).digest('hex').slice(0, 12);
    const carpeta = join(tmpdir(), 'obi-studio-plugins');
    await mkdir(carpeta, { recursive: true });
    const ruta = join(carpeta, `anfitrion-${hash}.cjs`);
    await writeFile(ruta, ANFITRION);
    return ruta;
  })();
  return rutaAnfitrion;
}

function aJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? { __u8: Buffer.from(x).toString('base64') } : x));
}

function deJson(t: string): unknown {
  return JSON.parse(t, (_k, v) => (v && typeof v === 'object' && typeof v.__u8 === 'string' ? new Uint8Array(Buffer.from(v.__u8, 'base64')) : v));
}

export interface ResultadoEjecucion<T> {
  resultado: T;
  /** Lo que el plugin escribió con console.log. */
  registros: string[];
}

/** Ejecuta una función del plugin en un proceso aislado. */
export async function ejecutarPlugin<T = unknown>(
  plugin: Plugin,
  tipo: TipoPlugin,
  args: unknown[],
  tiempo = 30_000,
): Promise<ResultadoEjecucion<T>> {
  if (!plugin.manifiesto.tipos.includes(tipo)) throw new ErrorPlugin(`«${plugin.manifiesto.nombre}» no es un plugin de tipo ${tipo}.`);
  const funcion = TIPOS_PLUGIN.find((t) => t.id === tipo)!.funcion;
  const ruta = await anfitrion();
  // En Electron, el mismo ejecutable hace de Node con ELECTRON_RUN_AS_NODE.
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1', PATH: '' };
  const hijo = fork(ruta, [], {
    execPath: process.execPath,
    execArgv: ['--permission', `--allow-fs-read=${ruta}`, '--max-old-space-size=512', '--disallow-code-generation-from-strings'],
    env,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let errorEstandar = '';
  hijo.stderr?.on('data', (d) => (errorEstandar = (errorEstandar + d).slice(-2000)));
  return new Promise((ok, mal) => {
    let terminado = false;
    const fin = (f: () => void) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(reloj);
      if (hijo.exitCode === null) hijo.kill('SIGKILL');
      f();
    };
    const reloj = setTimeout(() => fin(() => mal(new ErrorPlugin(`El plugin tardó más de ${Math.round(tiempo / 1000)} s y se detuvo.`))), tiempo);
    hijo.once('message', (m: { ok?: string; error?: string }) => {
      if (m.error !== undefined) return fin(() => mal(new ErrorPlugin(`El plugin falló: ${m.error}`)));
      try {
        const d = deJson(m.ok!) as { resultado: T; registros: string[] };
        fin(() => ok({ resultado: d.resultado, registros: d.registros ?? [] }));
      } catch (e) {
        fin(() => mal(new ErrorPlugin(`Respuesta del plugin ilegible: ${(e as Error).message}`)));
      }
    });
    hijo.once('exit', (codigo) =>
      fin(() =>
        mal(
          new ErrorPlugin(
            codigo === 0
              ? 'El plugin terminó sin devolver nada: alguna promesa quedó sin resolver.'
              : `El proceso del plugin se detuvo (código ${codigo}). ${errorEstandar.trim().split('\n').pop() ?? ''}`.trim(),
          ),
        ),
      ),
    );
    hijo.once('error', (e) => fin(() => mal(new ErrorPlugin(`No se pudo iniciar el plugin: ${e.message}`))));
    hijo.send({ codigo: plugin.codigo, funcion, entrada: aJson(args), permisos: plugin.manifiesto.permisos });
  });
}

// ---------------------------------------------------------------------------
// Lo que el plugin ve y lo que devuelve.

/** Copia del libro que se entrega al plugin: sin los bytes de las imágenes salvo con el permiso «recursos». */
export function libroParaPlugin(libro: Libro, permisos: Permiso[]): Libro {
  const copia = structuredClone(libro);
  if (!permisos.includes('recursos')) copia.recursos = copia.recursos.map((r) => ({ ...r, datos: new Uint8Array(0) }));
  return copia;
}

export function validarHallazgos(entrada: unknown, libro: Libro): Hallazgo[] {
  if (!Array.isArray(entrada)) throw new ErrorPlugin('revisar() debe devolver una lista de hallazgos.');
  const ids = new Set(libro.secciones.map((s) => s.id));
  return entrada.slice(0, 2000).map((h, k) => {
    const x = (h ?? {}) as Record<string, unknown>;
    if (typeof x.mensaje !== 'string' || !x.mensaje.trim()) throw new ErrorPlugin(`El hallazgo ${k + 1} no tiene «mensaje».`);
    const gravedad = x.gravedad === 'error' || x.gravedad === 'info' ? x.gravedad : 'aviso';
    return { gravedad, mensaje: x.mensaje.slice(0, 1000), ...(typeof x.seccion === 'string' && ids.has(x.seccion) ? { seccion: x.seccion } : {}) };
  });
}

const ESTILOS = new Set(ESTILOS_PARRAFO.map((e) => e.id as string));
const TIPOS = new Set(TIPOS_SECCION.map((t) => t.id as string));
const MARCAS_VALIDAS = new Set(MARCAS as string[]);

function comprobarInlines(v: unknown, donde: string, notas: Set<string>): Inline[] {
  if (!Array.isArray(v)) throw new ErrorPlugin(`${donde}: el contenido debe ser una lista.`);
  for (const i of v as Record<string, unknown>[]) {
    if (!i || typeof i !== 'object') throw new ErrorPlugin(`${donde}: elemento de texto no válido.`);
    const marcas = i.marcas as unknown;
    if (marcas !== undefined && (!Array.isArray(marcas) || marcas.some((m) => !MARCAS_VALIDAS.has(m as string))))
      throw new ErrorPlugin(`${donde}: marca de formato desconocida.`);
    if (i.tipo === 'texto') {
      if (typeof i.texto !== 'string') throw new ErrorPlugin(`${donde}: un texto no es una cadena.`);
    } else if (i.tipo === 'ruby') {
      if (typeof i.base !== 'string' || typeof i.lectura !== 'string') throw new ErrorPlugin(`${donde}: furigana incompleto.`);
    } else if (i.tipo === 'nota') {
      if (typeof i.id !== 'string' || !notas.has(i.id)) throw new ErrorPlugin(`${donde}: llamada a una nota que no existe.`);
    } else if (i.tipo !== 'salto') throw new ErrorPlugin(`${donde}: tipo de texto desconocido «${String(i.tipo)}».`);
  }
  return v as Inline[];
}

function comprobarBloque(b: Record<string, unknown>, donde: string, notas: Set<string>, recursos: Set<string>): Bloque {
  switch (b?.tipo) {
    case 'parrafo':
      if (!ESTILOS.has(b.estilo as string)) throw new ErrorPlugin(`${donde}: estilo de párrafo desconocido «${String(b.estilo)}».`);
      comprobarInlines(b.contenido, donde, notas);
      break;
    case 'subtitulo':
      if (b.nivel !== 2 && b.nivel !== 3) throw new ErrorPlugin(`${donde}: un subtítulo debe ser de nivel 2 o 3.`);
      comprobarInlines(b.contenido, donde, notas);
      break;
    case 'separador':
      break;
    case 'imagen':
      if (typeof b.recurso !== 'string' || !recursos.has(b.recurso)) throw new ErrorPlugin(`${donde}: imagen que no existe en el libro.`);
      if (typeof b.alt !== 'string') throw new ErrorPlugin(`${donde}: imagen sin descripción (alt).`);
      break;
    case 'lista':
      if (!Array.isArray(b.elementos)) throw new ErrorPlugin(`${donde}: lista sin elementos.`);
      for (const e of b.elementos) comprobarInlines(e, donde, notas);
      break;
    case 'crudo': {
      if (typeof b.xhtml !== 'string') throw new ErrorPlugin(`${donde}: bloque XHTML vacío.`);
      const error = errorXhtml(b.xhtml);
      if (error) throw new ErrorPlugin(`${donde}: XHTML mal formado (${error}).`);
      break;
    }
    default:
      throw new ErrorPlugin(`${donde}: tipo de bloque desconocido «${String(b?.tipo)}».`);
  }
  return b as unknown as Bloque;
}

/**
 * Comprueba el libro que devuelve una transformación o un importador.
 * Sin el permiso «recursos», las imágenes se conservan del libro original.
 */
export function validarLibroPlugin(entrada: unknown, original: Libro | null, permisos: Permiso[]): Libro {
  if (!entrada || typeof entrada !== 'object') throw new ErrorPlugin('El plugin no devolvió un libro.');
  const l = entrada as Record<string, unknown>;
  const md = { ...(original?.metadatos ?? {}), ...((l.metadatos as object) ?? {}) } as Record<string, unknown>;
  if (typeof md.titulo !== 'string') throw new ErrorPlugin('El libro devuelto no tiene metadatos con título.');
  if (!Array.isArray(l.secciones) || !l.secciones.length) throw new ErrorPlugin('El libro devuelto no tiene secciones.');

  let recursos: Recurso[];
  if (original && (!permisos.includes('recursos') || l.recursos === undefined)) {
    recursos = original.recursos;
  } else {
    if (!Array.isArray(l.recursos)) throw new ErrorPlugin('El libro devuelto no tiene la lista de recursos.');
    recursos = (l.recursos as Record<string, unknown>[]).map((r, k) => {
      if (typeof r?.id !== 'string' || typeof r.nombre !== 'string' || !(r.datos instanceof Uint8Array) || !/^image\//.test(String(r.tipoMime)))
        throw new ErrorPlugin(`El recurso ${k + 1} no es una imagen válida.`);
      if (!/^[A-Za-z0-9._-]+$/.test(r.nombre)) throw new ErrorPlugin(`Nombre de recurso no válido: «${r.nombre}».`);
      return r as unknown as Recurso;
    });
  }
  const idsRecursos = new Set(recursos.map((r) => r.id));
  const idsSecciones = new Set<string>();
  for (const [k, s] of (l.secciones as Record<string, unknown>[]).entries()) {
    const donde = `Sección ${k + 1}`;
    if (!s || typeof s !== 'object') throw new ErrorPlugin(`${donde}: no es un objeto.`);
    if (s.id === undefined) s.id = `s${k + 1}-${Math.random().toString(36).slice(2, 8)}`;
    if (s.notas === undefined) s.notas = [];
    if (s.titulo === undefined) s.titulo = '';
    if (typeof s.id !== 'string' || !s.id || idsSecciones.has(s.id)) throw new ErrorPlugin(`${donde}: id repetido.`);
    idsSecciones.add(s.id);
    if (!TIPOS.has(s.tipo as string)) throw new ErrorPlugin(`${donde}: tipo de sección desconocido «${String(s.tipo)}».`);
    if (typeof s.titulo !== 'string') throw new ErrorPlugin(`${donde}: sin título (puede ser una cadena vacía).`);
    if (!Array.isArray(s.bloques) || !Array.isArray(s.notas)) throw new ErrorPlugin(`${donde}: faltan bloques o notas.`);
    const notas = new Set<string>();
    for (const n of s.notas as Record<string, unknown>[]) {
      if (typeof n?.id !== 'string') throw new ErrorPlugin(`${donde}: nota sin id.`);
      notas.add(n.id);
    }
    for (const n of s.notas as Record<string, unknown>[]) comprobarInlines(n.contenido, `${donde}, nota`, notas);
    for (const [j, b] of (s.bloques as Record<string, unknown>[]).entries()) comprobarBloque(b, `${donde}, bloque ${j + 1}`, notas, idsRecursos);
    if (s.imagenCabecera !== undefined && !idsRecursos.has(s.imagenCabecera as string)) delete s.imagenCabecera;
    s.mostrarTitulo = s.mostrarTitulo !== false;
    s.enIndice = s.enIndice !== false;
  }
  const base = original ?? null;
  const tema = { ...(base?.tema ?? {}), ...validarTema(l.tema) };
  return {
    ...(base ?? {}),
    ...(l as object),
    metadatos: { ...(base?.metadatos ?? {}), ...(md as object) } as Libro['metadatos'],
    formato: 'obi-studio',
    version: 1,
    recursos,
    tema,
    tipografia: (l.tipografia as Libro['tipografia']) ?? base?.tipografia,
  } as Libro;
}

export interface ArchivoExportado {
  nombre: string;
  tipoMime: string;
  datos: Uint8Array;
}

export function validarExportacion(entrada: unknown, m: Manifiesto, titulo: string): ArchivoExportado {
  const x = (entrada ?? {}) as Record<string, unknown>;
  let datos: Uint8Array;
  if (x.datos instanceof Uint8Array) datos = x.datos;
  else if (typeof x.datos === 'string') datos = new TextEncoder().encode(x.datos);
  else throw new ErrorPlugin('exportar() debe devolver { datos } con texto o Uint8Array.');
  const base = (typeof x.nombre === 'string' && x.nombre.trim() ? x.nombre : titulo).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const ext = m.salida!.extension;
  return { nombre: base.endsWith('.' + ext) ? base : `${base}.${ext}`, tipoMime: m.salida!.tipoMime, datos };
}

// ---------------------------------------------------------------------------
// Plugins instalados.

export interface PluginInstalado extends Manifiesto {
  /** Huella del paquete instalado. */
  huella: string;
}

export class AlmacenPlugins {
  constructor(private carpeta: string) {}

  async listar(): Promise<PluginInstalado[]> {
    let nombres: string[] = [];
    try {
      nombres = (await readdir(this.carpeta)).filter((n) => n.endsWith('.obiplugin'));
    } catch {
      return [];
    }
    const lista: PluginInstalado[] = [];
    for (const n of nombres.sort()) {
      try {
        const datos = new Uint8Array(await readFile(join(this.carpeta, n)));
        const p = await leerPlugin(datos);
        lista.push({ ...p.manifiesto, huella: createHash('sha256').update(datos).digest('hex').slice(0, 16) });
      } catch {
        // Un paquete dañado no impide usar los demás.
      }
    }
    return lista;
  }

  async instalar(datos: Uint8Array): Promise<PluginInstalado> {
    const p = await leerPlugin(datos);
    await mkdir(this.carpeta, { recursive: true });
    await writeFile(join(this.carpeta, `${p.manifiesto.id}.obiplugin`), datos);
    return { ...p.manifiesto, huella: createHash('sha256').update(datos).digest('hex').slice(0, 16) };
  }

  async obtener(id: string): Promise<Plugin> {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new ErrorPlugin('Id de plugin no válido.');
    try {
      return await leerPlugin(new Uint8Array(await readFile(join(this.carpeta, `${id}.obiplugin`))));
    } catch (e) {
      if (e instanceof ErrorPlugin) throw e;
      throw new ErrorPlugin(`El plugin «${id}» no está instalado.`);
    }
  }

  async eliminar(id: string): Promise<void> {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new ErrorPlugin('Id de plugin no válido.');
    await rm(join(this.carpeta, `${id}.obiplugin`), { force: true });
  }
}
