// Fuentes instaladas en el sistema (Windows, macOS y Linux), agrupadas por familia y con su licencia.

import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { leerFuentePropia, permisoFuente, type PermisoFuente } from './fuentes-propias.js';

export interface CaraSistema {
  ruta: string;
  subfamilia: string;
  peso: number;
  estilo: 'normal' | 'italic';
  permiso: PermisoFuente;
}

export interface FamiliaSistema {
  familia: string;
  caras: CaraSistema[];
}

export function carpetasFuentes(plataforma = process.platform, env = process.env, casa = homedir()): string[] {
  if (plataforma === 'win32') {
    const windir = env.WINDIR || env.SystemRoot || 'C:\\Windows';
    const local = env.LOCALAPPDATA || join(casa, 'AppData', 'Local');
    return [join(windir, 'Fonts'), join(local, 'Microsoft', 'Windows', 'Fonts')];
  }
  if (plataforma === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', join(casa, 'Library', 'Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(casa, '.local', 'share', 'fonts'), join(casa, '.fonts')];
}

async function* archivos(carpeta: string, profundidad = 0): AsyncGenerator<string> {
  let entradas;
  try {
    entradas = await readdir(carpeta, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entradas) {
    const ruta = join(carpeta, e.name);
    if (e.isDirectory() && profundidad < 5) yield* archivos(ruta, profundidad + 1);
    else if (/\.(ttf|otf)$/i.test(e.name)) yield ruta;
  }
}

/** Lee la fuente entera (las tablas pueden estar en cualquier parte del archivo); se saltan las de más de 40 MB. */
async function leer(ruta: string): Promise<Uint8Array | undefined> {
  const s = await stat(ruta);
  if (s.size > 40 * 1024 * 1024) return undefined;
  const f = await open(ruta, 'r');
  try {
    const d = new Uint8Array(s.size);
    await f.read(d, 0, s.size, 0);
    return d;
  } finally {
    await f.close();
  }
}

export async function buscarFuentesSistema(carpetas = carpetasFuentes()): Promise<FamiliaSistema[]> {
  const familias = new Map<string, FamiliaSistema>();
  let leidas = 0;
  for (const c of carpetas) {
    for await (const ruta of archivos(c)) {
      if (++leidas > 5000) break;
      try {
        const d = await leer(ruta);
        if (!d) continue;
        const i = leerFuentePropia(d);
        const f = familias.get(i.familia) ?? { familia: i.familia, caras: [] };
        if (!f.caras.some((x) => x.peso === i.peso && x.estilo === i.estilo)) {
          f.caras.push({ ruta, subfamilia: i.subfamilia, peso: i.peso, estilo: i.estilo, permiso: permisoFuente(i.fsType) });
        }
        familias.set(i.familia, f);
      } catch {
        // Archivo dañado o no admitido: se ignora.
      }
    }
  }
  for (const f of familias.values()) f.caras.sort((a, b) => a.peso - b.peso || (a.estilo === b.estilo ? 0 : a.estilo === 'normal' ? -1 : 1));
  return [...familias.values()].sort((a, b) => a.familia.localeCompare(b.familia));
}
