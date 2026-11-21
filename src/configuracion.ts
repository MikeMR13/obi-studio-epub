// Configuración de la app (no del libro): se guarda en un JSON junto a los datos del usuario.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Configuracion {
  /** Permitir la colaboración en tiempo real en la red local. Desactivada por defecto. */
  colaboracion: boolean;
  /** Idiomas del corrector ortográfico (códigos como «es», «en», «pt»). */
  idiomasCorrector: string[];
  /** Añadir al corrector el idioma del libro abierto. */
  corregirIdiomaLibro: boolean;
  /** Buscar versiones nuevas de la app al abrirla (solo la app de escritorio instalada). */
  buscarActualizaciones: boolean;
}

export const CONFIGURACION_PREDETERMINADA: Configuracion = { colaboracion: false, idiomasCorrector: ['es'], corregirIdiomaLibro: true, buscarActualizaciones: true };

/** Idiomas que se pueden elegir para el corrector. */
export { IDIOMAS_CORRECTOR, diccionariosPara } from './idiomas-corrector.js';

function limpiar(d: Partial<Configuracion>, base: Configuracion): Configuracion {
  const idiomas = Array.isArray(d.idiomasCorrector) ? d.idiomasCorrector.filter((x): x is string => typeof x === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(x)).slice(0, 8) : base.idiomasCorrector;
  return {
    colaboracion: typeof d.colaboracion === 'boolean' ? d.colaboracion : base.colaboracion,
    idiomasCorrector: idiomas,
    corregirIdiomaLibro: typeof d.corregirIdiomaLibro === 'boolean' ? d.corregirIdiomaLibro : base.corregirIdiomaLibro,
    buscarActualizaciones: typeof d.buscarActualizaciones === 'boolean' ? d.buscarActualizaciones : base.buscarActualizaciones,
  };
}

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
    this.cache = limpiar(d, CONFIGURACION_PREDETERMINADA);
    return this.cache;
  }

  async cambiar(cambios: Partial<Configuracion>): Promise<Configuracion> {
    const actual = await this.leer();
    const nueva = limpiar(cambios, actual);
    await mkdir(dirname(this.ruta), { recursive: true });
    await writeFile(this.ruta, JSON.stringify(nueva, null, 2));
    this.cache = nueva;
    return nueva;
  }
}
