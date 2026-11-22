// Validación con EPUBCheck (Java). Mensajes traducidos al español y ligados a la sección del problema.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Mensaje {
  gravedad: 'error' | 'aviso' | 'info';
  codigo: string;
  mensaje: string;
  original: string;
  archivo?: string;
  linea?: number;
  seccion?: string;
}

export interface Resultado {
  valido: boolean;
  errores: number;
  avisos: number;
  mensajes: Mensaje[];
  disponible: boolean;
}

const aqui = dirname(fileURLToPath(import.meta.url));
const recursosApp = (process as { resourcesPath?: string }).resourcesPath;

export function rutaEpubcheck(): string | undefined {
  const candidatos = [
    process.env.EPUBCHECK_JAR,
    resolve(aqui, '../recursos/epubcheck/epubcheck.jar'),
    resolve(aqui, '../../recursos/epubcheck/epubcheck.jar'),
    recursosApp ? join(recursosApp, 'recursos/epubcheck/epubcheck.jar') : undefined,
  ].filter(Boolean) as string[];
  return candidatos.find((c) => existsSync(c));
}

export function rutaJava(): string {
  if (process.env.OBI_JAVA) return process.env.OBI_JAVA;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const propios = [
    resolve(aqui, `../recursos/java/bin/java${ext}`),
    resolve(aqui, `../../recursos/java/bin/java${ext}`),
    recursosApp ? join(recursosApp, `recursos/java/bin/java${ext}`) : '',
  ];
  return propios.find((p) => p && existsSync(p)) ?? 'java';
}

// Traducciones de los mensajes más frecuentes de EPUBCheck.
const TRADUCCIONES: [RegExp, string][] = [
  [/^RSC-005$/, 'El código XHTML no cumple el esquema de EPUB.'],
  [/^RSC-007$/, 'Falta un archivo al que se hace referencia.'],
  [/^RSC-008$/, 'Un archivo usado en el libro no está declarado en el manifiesto.'],
  [/^RSC-012$/, 'Un enlace apunta a un identificador que no existe.'],
  [/^RSC-016$/, 'El XHTML está mal formado (etiquetas sin cerrar o caracteres no válidos).'],
  [/^RSC-017$/, 'Aviso de contenido.'],
  [/^OPF-003$/, 'Hay un archivo en el EPUB que no aparece en el manifiesto.'],
  [/^OPF-014$/, 'Falta declarar una propiedad (svg, mathml o scripted) en el manifiesto.'],
  [/^OPF-085$/, 'El identificador no es un UUID válido.'],
  [/^OPF-096$/, 'Un documento sin enlace en el orden de lectura no es alcanzable.'],
  [/^PKG-021$/, 'Imagen dañada o con formato incorrecto.'],
  [/^MED-001$/, 'Tipo de imagen no admitido por EPUB.'],
  [/^ACC-/, 'Problema de accesibilidad.'],
  [/^CSS-/, 'Problema en la hoja de estilos.'],
  [/^HTM-/, 'Problema en el HTML.'],
  [/^NAV-/, 'Problema en la navegación (índice).'],
];

function traducir(codigo: string, original: string): string {
  const t = TRADUCCIONES.find(([re]) => re.test(codigo));
  return t ? `${t[1]} (${original})` : original;
}

export async function validarArchivo(ruta: string): Promise<Resultado> {
  const jar = rutaEpubcheck();
  // Sin EPUBCheck no se puede afirmar que el libro es válido: se dice como error, no se da por bueno.
  if (!jar)
    return {
      valido: false,
      errores: 1,
      avisos: 0,
      disponible: false,
      mensajes: [{ gravedad: 'error', codigo: 'OBI-EPUBCHECK', mensaje: 'No se encontró EPUBCheck: el libro no se pudo validar. Reinstala la app (o ejecuta «npm run recursos» en desarrollo).', original: '' }],
    };
  const dir = await mkdtemp(join(tmpdir(), 'obi-check-'));
  const salidaJson = join(dir, 'resultado.json');
  try {
    await new Promise<void>((ok) => {
      // Con un límite de tiempo: un EPUB enorme o un Java colgado no deja la app esperando para siempre.
      execFile(rutaJava(), ['-jar', jar, ruta, '--json', salidaJson], { maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 }, () => ok());
    });
    if (!existsSync(salidaJson)) {
      return {
        valido: false,
        errores: 1,
        avisos: 0,
        disponible: false,
        mensajes: [{ gravedad: 'error', codigo: 'OBI-JAVA', mensaje: 'No se pudo ejecutar EPUBCheck (¿falta Java?).', original: '' }],
      };
    }
    const json = JSON.parse(await readFile(salidaJson, 'utf8'));
    const mensajes: Mensaje[] = [];
    for (const m of json.messages ?? []) {
      const gravedad = m.severity === 'ERROR' || m.severity === 'FATAL' ? 'error' : m.severity === 'WARNING' ? 'aviso' : 'info';
      if (gravedad === 'info') continue;
      const locs = m.locations?.length ? m.locations : [{}];
      for (const loc of locs) {
        const archivo: string | undefined = loc.path;
        const seccion = archivo?.match(/EPUB\/([^/]+)\.xhtml$/)?.[1];
        mensajes.push({
          gravedad,
          codigo: m.ID,
          original: m.message,
          mensaje: traducir(m.ID, m.message),
          archivo,
          linea: loc.line > 0 ? loc.line : undefined,
          seccion,
        });
      }
    }
    const errores = mensajes.filter((m) => m.gravedad === 'error').length;
    const avisos = mensajes.filter((m) => m.gravedad === 'aviso').length;
    return { valido: errores === 0, errores, avisos, mensajes, disponible: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function validarDatos(epub: Uint8Array): Promise<Resultado> {
  const dir = await mkdtemp(join(tmpdir(), 'obi-epub-'));
  const ruta = join(dir, 'libro.epub');
  try {
    await writeFile(ruta, epub);
    return await validarArchivo(ruta);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
