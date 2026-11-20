// Lista de tiendas y sus reglas (datos puros: se usa también en la interfaz). Ver src/tiendas.ts.

/** Límites de las imágenes interiores. */
export interface Limites {
  maxPixeles?: number;
  maxLado?: number;
  maxBytes?: number;
}

export type IdTienda = 'kindle' | 'apple' | 'kobo' | 'google' | 'ingram';

export interface Tienda {
  id: IdTienda;
  nombre: string;
  /** Portada: lado corto y largo mínimos, recomendada y máximo por lado. */
  portada: { minCorto: number; minLargo?: number; recomendada: string; maxLado?: number; proporcion?: number };
  /** Límites de las imágenes interiores. */
  imagenes: Limites;
  maxEpubMb?: number;
  sinPaginaFija?: boolean;
  ayuda: string;
}

export const TIENDAS: Tienda[] = [
  {
    id: 'kindle',
    nombre: 'Kindle (KDP)',
    portada: { minCorto: 625, minLargo: 1000, recomendada: '1600 × 2560 px', maxLado: 10000, proporcion: 1.6 },
    imagenes: {},
    maxEpubMb: 650,
    ayuda: 'https://kdp.amazon.com/help/topic/G200645690',
  },
  {
    id: 'apple',
    nombre: 'Apple Books',
    portada: { minCorto: 1400, recomendada: '1600 × 2400 px' },
    imagenes: { maxPixeles: 5_600_000 },
    ayuda: 'https://help.apple.com/itc/booksassetguide/',
  },
  {
    id: 'kobo',
    nombre: 'Kobo Writing Life',
    portada: { minCorto: 600, minLargo: 800, recomendada: '1600 × 2400 px' },
    imagenes: { maxBytes: 3 * 1024 * 1024 },
    maxEpubMb: 100,
    ayuda: 'https://github.com/kobolabs/epub-spec',
  },
  {
    id: 'google',
    nombre: 'Google Play Books',
    portada: { minCorto: 640, recomendada: '1600 × 2400 px', maxLado: 7200 },
    imagenes: {},
    ayuda: 'https://support.google.com/books/partner/answer/3316879',
  },
  {
    id: 'ingram',
    nombre: 'IngramSpark (EPUB)',
    portada: { minCorto: 1600, recomendada: '1600 × 2560 px' },
    imagenes: { maxPixeles: 3_200_000 },
    sinPaginaFija: true,
    ayuda: 'https://lightningsourcelegacy.zendesk.com/hc/en-us/articles/210308226-ePUB-Guidelines',
  },
];

export function tienda(id: string): Tienda {
  const t = TIENDAS.find((x) => x.id === id);
  if (!t) throw new Error(`Tienda desconocida: ${id}`);
  return t;
}

