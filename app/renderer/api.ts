import type { Estado } from '../backend';
import type { Resultado } from '../../src/validar';

import type { AvisoImpresion } from '../../src/preflight';
import type { InformeAccesibilidad } from '../../src/accesibilidad';
import type { Coincidencia, OpcionesBusqueda } from '../../src/buscar';
import type { Hallazgo, Manifiesto, PluginInstalado } from '../../src/plugins';

export type { Coincidencia, OpcionesBusqueda };
export type { Estado, Resultado, AvisoImpresion, InformeAccesibilidad, Hallazgo, Manifiesto, PluginInstalado };

export class ErrorApi extends Error {
  constructor(mensaje: string, public estado: number, public datos?: unknown) {
    super(mensaje);
  }
}

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, binario?: Blob | ArrayBuffer): Promise<T> {
  const r = await fetch(ruta, {
    method: metodo,
    headers: binario ? { 'Content-Type': 'application/octet-stream' } : cuerpo !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: binario ?? (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined),
    credentials: 'same-origin',
  });
  const tipo = r.headers.get('Content-Type') ?? '';
  if (!r.ok) {
    const d = tipo.includes('json') ? await r.json() : { error: await r.text() };
    throw new ErrorApi(d.error ?? `Error ${r.status}`, r.status, d.datos);
  }
  return (tipo.includes('json') ? r.json() : r.blob()) as Promise<T>;
}

export const api = {
  estado: () => pedir<Estado>('GET', '/api/estado'),
  nuevo: (titulo: string, autor: string) => pedir<Estado>('POST', '/api/nuevo', { titulo, autor }),
  importar: (archivo: File) => pedir<Estado>('POST', `/api/importar?nombre=${encodeURIComponent(archivo.name)}`, undefined, archivo),
  metadatos: (cambios: object) => pedir<Estado>('PUT', '/api/metadatos', cambios),
  tema: (cambios: object) => pedir<Estado>('PUT', '/api/tema', cambios),
  tipografia: (cambios: object) => pedir<Estado>('PUT', '/api/tipografia', cambios),
  aplicarTipografia: (seccion?: string) => pedir<{ cambios: number; estado: Estado }>('POST', '/api/tipografia/aplicar', { seccion }),
  anadirSeccion: (tipo: string, titulo: string, despuesDe?: string) =>
    pedir<{ seccion: string; estado: Estado }>('POST', '/api/secciones', { tipo, titulo, despuesDe }),
  seccion: (id: string, cambios: object) => pedir<Estado>('PUT', `/api/secciones/${id}`, cambios),
  eliminarSeccion: (id: string) => pedir<Estado>('DELETE', `/api/secciones/${id}`),
  ordenar: (ids: string[]) => pedir<Estado>('PUT', '/api/orden', { ids }),
  subirImagen: (archivo: File) =>
    pedir<{ recurso: { id: string; nombre: string; ancho?: number; alto?: number }; estado: Estado }>(
      'POST',
      `/api/recursos?nombre=${encodeURIComponent(archivo.name)}`,
      undefined,
      archivo,
    ),
  reemplazarImagen: (id: string, archivo: File) => pedir<Estado>('PUT', `/api/recursos/${id}`, undefined, archivo),
  codigo: (id: string) => pedir<{ xhtml: string }>('GET', `/api/codigo/${id}`),
  aplicarCodigo: (id: string, xhtml: string) => pedir<{ secciones: string[]; estado: Estado }>('PUT', `/api/codigo/${id}`, { xhtml }),
  validar: () => pedir<Resultado>('POST', '/api/validar'),
  buscar: (o: OpcionesBusqueda) => pedir<{ coincidencias: Coincidencia[]; total: number }>('POST', '/api/buscar', o),
  reemplazar: (opciones: OpcionesBusqueda, reemplazo: string, solo?: { seccion: string; lugar: string; orden: number }) =>
    pedir<{ n: number; estado: Estado }>('POST', '/api/reemplazar', { opciones, reemplazo, solo }),
  accesibilidad: () => pedir<InformeAccesibilidad>('POST', '/api/accesibilidad'),
  plugins: () => pedir<PluginInstalado[]>('GET', '/api/plugins'),
  inspeccionarPlugin: (archivo: Blob) => pedir<Manifiesto>('POST', '/api/plugins/inspeccionar', undefined, archivo),
  instalarPlugin: (archivo: Blob) => pedir<PluginInstalado[]>('POST', '/api/plugins', undefined, archivo),
  eliminarPlugin: (id: string) => pedir<PluginInstalado[]>('DELETE', `/api/plugins/${id}`),
  revisarPlugin: (id: string) => pedir<{ hallazgos: Hallazgo[]; registros: string[] }>('POST', `/api/plugins/${id}/revisar`),
  transformarPlugin: (id: string) => pedir<{ registros: string[]; estado: Estado }>('POST', `/api/plugins/${id}/transformar`),
  deshacerPlugin: () => pedir<Estado>('POST', '/api/plugins/deshacer'),
  escritura: (escritura: 'horizontal' | 'vertical') => pedir<Estado>('PUT', '/api/escritura', { escritura }),
  correcciones: (archivo: File) =>
    pedir<{ resumen: { actualizadas: string[]; nuevas: string[]; sinCambios: number; comentarios: number; avisos: string[] }; estado: Estado }>(
      'POST',
      `/api/correcciones?nombre=${encodeURIComponent(archivo.name)}`,
      undefined,
      archivo,
    ),
  temaGaleria: (id: string) => pedir<Estado>('POST', '/api/tema/galeria', { id }),
  muestraTema: (modo: 'lector' | 'pagina') => pedir<{ url: string }>('GET', `/api/tema/muestra?modo=${modo}`),
  impresion: (cambios: object) => pedir<Estado>('PUT', '/api/impresion', cambios),
  revisionImpresion: () => pedir<{ avisos: AvisoImpresion[]; paginas?: number }>('GET', '/api/impresion/revision'),
  visorImpresion: () => pedir<{ url: string }>('GET', '/api/impresion/visor'),
};

export function urlRecurso(id: string, version = 0): string {
  return `/api/recursos/${id}?v=${version}`;
}

/** Descarga un archivo de la API (Electron muestra el diálogo de guardar). */
export async function descargar(ruta: string): Promise<void> {
  const r = await fetch(ruta, { credentials: 'same-origin' });
  if (!r.ok) {
    const d = await r.json().catch(() => ({ error: `Error ${r.status}` }));
    throw new ErrorApi(d.error, r.status, d.datos);
  }
  const nombre = decodeURIComponent(r.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? 'archivo');
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
