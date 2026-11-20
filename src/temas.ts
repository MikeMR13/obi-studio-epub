// Galería de temas. Cada tema es un conjunto de valores del modelo: el autor parte de uno y lo ajusta sin tocar CSS.

import type { Tema } from './model.js';
import { TEMA_PREDETERMINADO } from './model.js';

export interface TemaGaleria {
  id: string;
  nombre: string;
  descripcion: string;
  tema: Tema;
}

const t = (nombre: string, cambios: Partial<Tema>): Tema => ({ ...TEMA_PREDETERMINADO, ...cambios, nombre });

export const TEMAS: TemaGaleria[] = [
  {
    id: 'clasico',
    nombre: 'Clásico',
    descripcion: 'Sobrio y legible; respeta la letra que elija el lector.',
    tema: t('Clásico', {}),
  },
  {
    id: 'novela-ligera',
    nombre: 'Novela ligera',
    descripcion: 'Número de capítulo arriba y título grande, como las ediciones japonesas.',
    tema: t('Novela ligera', {
      fuenteTexto: 'literata',
      fuenteTitulos: 'noto-sans',
      tituloEstilo: 'numero-grande',
      tituloTamano: 1.7,
      tituloEspacio: 3,
      separador: 'rombos',
      colorAcento: '#b5341f',
      colorTitulos: '#1f1d1a',
    }),
  },
  {
    id: 'fantasia',
    nombre: 'Fantasía épica',
    descripcion: 'Títulos en Cinzel, capitular y ornamento floral.',
    tema: t('Fantasía épica', {
      fuenteTexto: 'eb-garamond',
      fuenteTitulos: 'cinzel',
      interlineado: 1.45,
      tituloEstilo: 'numero-grande',
      tituloMayusculas: false,
      tituloTamano: 1.8,
      tituloEspacio: 4,
      capitular: 'letra',
      primeraLinea: true,
      separador: 'flor',
      colorTitulos: '#5a2a12',
      colorAcento: '#8a5a00',
    }),
  },
  {
    id: 'romance',
    nombre: 'Romance',
    descripcion: 'Garamond, títulos delicados en versalitas y rombos.',
    tema: t('Romance', {
      fuenteTexto: 'eb-garamond',
      fuenteTitulos: 'eb-garamond',
      interlineado: 1.5,
      tituloMayusculas: true,
      tituloTamano: 1.4,
      tituloEspacio: 4,
      primeraLinea: true,
      separador: 'rombos',
      colorTitulos: '#7a2e4a',
      colorAcento: '#b0577a',
    }),
  },
  {
    id: 'ciencia-ficcion',
    nombre: 'Ciencia ficción',
    descripcion: 'Sin remate, títulos a la izquierda con línea y separador de línea.',
    tema: t('Ciencia ficción', {
      fuenteTexto: 'noto-sans',
      fuenteTitulos: 'noto-sans',
      interlineado: 1.55,
      alinear: 'izquierda',
      tituloEstilo: 'linea',
      tituloMayusculas: true,
      tituloTamano: 1.4,
      separador: 'linea',
      colorTitulos: '#1d3c6e',
      colorAcento: '#1d3c6e',
    }),
  },
  {
    id: 'misterio',
    nombre: 'Misterio',
    descripcion: 'Literata, títulos a la izquierda y capitular.',
    tema: t('Misterio', {
      fuenteTexto: 'literata',
      fuenteTitulos: 'literata',
      tituloEstilo: 'izquierda',
      tituloTamano: 1.6,
      tituloEspacio: 3,
      capitular: 'letra',
      separador: 'puntos',
      colorTitulos: '#2b2b2b',
      colorAcento: '#6b0f0f',
    }),
  },
  {
    id: 'juvenil',
    nombre: 'Juvenil',
    descripcion: 'Aireado: espacio entre párrafos, sin sangría y títulos grandes.',
    tema: t('Juvenil', {
      fuenteTexto: 'literata',
      fuenteTitulos: 'noto-sans',
      interlineado: 1.6,
      sangria: 0,
      espacioParrafos: 0.6,
      alinear: 'izquierda',
      tituloEstilo: 'numero-grande',
      tituloTamano: 2,
      separador: 'puntos',
      colorTitulos: '#155e63',
      colorAcento: '#155e63',
    }),
  },
  {
    id: 'minimalista',
    nombre: 'Minimalista',
    descripcion: 'Solo lo esencial: espacio en blanco entre escenas.',
    tema: t('Minimalista', {
      fuenteTexto: 'serif',
      fuenteTitulos: 'sans-serif',
      tituloTamano: 1.3,
      tituloEspacio: 5,
      tituloMayusculas: true,
      separador: 'espacio',
    }),
  },
  {
    id: 'literario',
    nombre: 'Literario',
    descripcion: 'Garamond justificado, versalitas en la primera línea y capitular.',
    tema: t('Literario', {
      fuenteTexto: 'eb-garamond',
      fuenteTitulos: 'eb-garamond',
      interlineado: 1.45,
      sangria: 1.2,
      tituloTamano: 1.5,
      tituloEspacio: 5,
      capitular: 'letra',
      primeraLinea: true,
      separador: 'flor',
    }),
  },
];
