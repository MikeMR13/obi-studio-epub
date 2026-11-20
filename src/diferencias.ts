// Diferencias palabra por palabra (sin dependencias de Node: se usa también en la interfaz).

import type { Bloque } from './model.js';
import { textoPlano } from './model.js';

export interface Trozo {
  tipo: 'igual' | 'borrado' | 'insertado';
  texto: string;
}

const TOKENS = /\s+|[\p{L}\p{N}\p{M}]+|[^\s\p{L}\p{N}\p{M}]/gu;

/** Subsecuencia común más larga entre dos listas; devuelve los pares de índices emparejados. */
export function emparejar<T>(a: T[], b: T[], igual: (x: T, y: T) => boolean = (x, y) => x === y): [number, number][] {
  const n = a.length;
  const m = b.length;
  const t: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = igual(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const pares: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (igual(a[i], b[j])) {
      pares.push([i, j]);
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  }
  return pares;
}

export function diferenciaPalabras(antes: string, despues: string): Trozo[] {
  const a = antes.match(TOKENS) ?? [];
  const b = despues.match(TOKENS) ?? [];
  // Textos enormes: no merece la pena el detalle.
  if (a.length * b.length > 4_000_000) return [{ tipo: 'borrado', texto: antes }, { tipo: 'insertado', texto: despues }];
  const pares = emparejar(a, b);
  const salida: Trozo[] = [];
  const poner = (tipo: Trozo['tipo'], texto: string) => {
    if (!texto) return;
    const ultimo = salida[salida.length - 1];
    if (ultimo?.tipo === tipo) ultimo.texto += texto;
    else salida.push({ tipo, texto });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pares, [a.length, b.length] as [number, number]]) {
    poner('borrado', a.slice(i, pi).join(''));
    poner('insertado', b.slice(j, pj).join(''));
    if (pi < a.length) poner('igual', a[pi]);
    i = pi + 1;
    j = pj + 1;
  }
  return salida;
}

/** Texto plano de una lista de bloques, para mostrar un cambio. */
export function textoBloques(bloques: Bloque[]): string {
  return bloques
    .map((b) =>
      b.tipo === 'parrafo' || b.tipo === 'subtitulo'
        ? textoPlano(b.contenido)
        : b.tipo === 'lista'
          ? b.elementos.map(textoPlano).join('\n')
          : b.tipo === 'recuadro'
            ? [b.titulo ? `[${b.titulo}]` : '', ...b.lineas.map((l) => (l.etiqueta ? `${l.etiqueta}: ` : '') + textoPlano(l.contenido))].filter(Boolean).join('\n')
          : b.tipo === 'separador'
            ? '* * *'
            : b.tipo === 'imagen'
              ? `[Imagen: ${b.alt}]`
              : '[Bloque XHTML]',
    )
    .join('\n');
}
