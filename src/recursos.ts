// Ubicación de los recursos que van con la app (EPUBCheck, Java, visor de Vivliostyle, fuentes, patrones de división).
// En desarrollo están en recursos/ del repositorio; en la app instalada, en process.resourcesPath/recursos.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const recursosApp = (process as { resourcesPath?: string }).resourcesPath;

export function carpetaRecursos(): string | undefined {
  const candidatos = [
    process.env.OBI_RECURSOS,
    resolve(aqui, '../recursos'),
    resolve(aqui, '../../recursos'),
    recursosApp ? join(recursosApp, 'recursos') : undefined,
  ].filter(Boolean) as string[];
  return candidatos.find((c) => existsSync(c));
}

export function rutaRecurso(...partes: string[]): string | undefined {
  const base = carpetaRecursos();
  if (!base) return undefined;
  const ruta = join(base, ...partes);
  return existsSync(ruta) ? ruta : undefined;
}
