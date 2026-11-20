// Configuración de la app (no del libro): se guarda en un JSON junto a los datos del usuario.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Configuracion {
  /** Permitir la colaboración en tiempo real en la red local. Desactivada por defecto. */
  colaboracion: boolean;
}

export const CONFIGURACION_PREDETERMINADA: Configuracion = { colaboracion: false };

export class ArchivoConfiguracion {
  private cache?: Configuracion;
  constructor(readonly ruta: string) {}

  async leer(): Promise<Configuracion> {
    if (this.cache) return this.cache;
    let d: Partial<Configuracion> = {};
    try {
      d = JSON.parse(await readFile(this.ruta, 'utf8'));
    } catch {
      // Sin archivo o ilegible: valores predeterminados.
    }
    this.cache = { ...CONFIGURACION_PREDETERMINADA, colaboracion: d.colaboracion === true };
    return this.cache;
  }

  async cambiar(cambios: Partial<Configuracion>): Promise<Configuracion> {
    const actual = await this.leer();
    const nueva: Configuracion = { ...actual, ...(typeof cambios.colaboracion === 'boolean' ? { colaboracion: cambios.colaboracion } : {}) };
    await mkdir(dirname(this.ruta), { recursive: true });
    await writeFile(this.ruta, JSON.stringify(nueva, null, 2));
    this.cache = nueva;
    return nueva;
  }
}
