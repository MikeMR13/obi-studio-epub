// Modelo del libro de Obi Studio.
// El libro vive aquí, nunca en HTML: el editor visual, el código y cada exportador leen y escriben este modelo.

export type Marca =
  | 'negrita'
  | 'cursiva'
  | 'subrayado'
  | 'tachado'
  | 'versalitas'
  | 'superindice'
  | 'subindice';

export const MARCAS: Marca[] = ['negrita', 'cursiva', 'subrayado', 'tachado', 'versalitas', 'superindice', 'subindice'];

export interface Texto {
  tipo: 'texto';
  texto: string;
  marcas?: Marca[];
  enlace?: string;
  /** Idioma BCP 47 de este fragmento, si difiere del libro (p. ej. "ja"). */
  idioma?: string;
}

/** Furigana u otra anotación ruby sobre un texto base. */
export interface Ruby {
  tipo: 'ruby';
  base: string;
  lectura: string;
  marcas?: Marca[];
}

export interface NotaRef {
  tipo: 'nota';
  id: string;
}

export interface Salto {
  tipo: 'salto';
}

export type Inline = Texto | Ruby | NotaRef | Salto;

export type EstiloParrafo =
  | 'cuerpo'
  | 'sin-sangria'
  | 'centrado'
  | 'derecha'
  | 'pensamiento'
  | 'onomatopeya'
  | 'carta'
  | 'cita';

export const ESTILOS_PARRAFO: { id: EstiloParrafo; nombre: string }[] = [
  { id: 'cuerpo', nombre: 'Cuerpo' },
  { id: 'sin-sangria', nombre: 'Sin sangría' },
  { id: 'centrado', nombre: 'Centrado' },
  { id: 'derecha', nombre: 'A la derecha' },
  { id: 'pensamiento', nombre: 'Pensamiento' },
  { id: 'onomatopeya', nombre: 'Onomatopeya' },
  { id: 'carta', nombre: 'Carta' },
  { id: 'cita', nombre: 'Cita' },
];

export interface Parrafo {
  tipo: 'parrafo';
  estilo: EstiloParrafo;
  contenido: Inline[];
}

export interface Subtitulo {
  tipo: 'subtitulo';
  nivel: 2 | 3;
  contenido: Inline[];
}

export interface Separador {
  tipo: 'separador';
}

export interface Imagen {
  tipo: 'imagen';
  recurso: string;
  alt: string;
  decorativa?: boolean;
  pie?: string;
}

export interface Lista {
  tipo: 'lista';
  ordenada: boolean;
  elementos: Inline[][];
}

/**
 * XHTML que el editor visual no sabe representar (tablas, SVG, MathML…).
 * Se conserva tal cual para no perder nada y se edita en la vista de código.
 */
export interface Crudo {
  tipo: 'crudo';
  xhtml: string;
}

export type Bloque = Parrafo | Subtitulo | Separador | Imagen | Lista | Crudo;

export type TipoSeccion =
  | 'portada'
  | 'ilustracion'
  | 'creditos'
  | 'indice'
  | 'dedicatoria'
  | 'prologo'
  | 'capitulo'
  | 'interludio'
  | 'epilogo'
  | 'posfacio'
  | 'apendice'
  | 'otro';

export const TIPOS_SECCION: { id: TipoSeccion; nombre: string }[] = [
  { id: 'portada', nombre: 'Portada' },
  { id: 'ilustracion', nombre: 'Ilustración' },
  { id: 'creditos', nombre: 'Créditos' },
  { id: 'indice', nombre: 'Índice' },
  { id: 'dedicatoria', nombre: 'Dedicatoria' },
  { id: 'prologo', nombre: 'Prólogo' },
  { id: 'capitulo', nombre: 'Capítulo' },
  { id: 'interludio', nombre: 'Interludio' },
  { id: 'epilogo', nombre: 'Epílogo' },
  { id: 'posfacio', nombre: 'Posfacio' },
  { id: 'apendice', nombre: 'Apéndice' },
  { id: 'otro', nombre: 'Otra sección' },
];

export interface Nota {
  id: string;
  contenido: Inline[];
}

export interface Seccion {
  id: string;
  tipo: TipoSeccion;
  titulo: string;
  /** Mostrar el título como encabezado dentro de la página. */
  mostrarTitulo: boolean;
  enIndice: boolean;
  bloques: Bloque[];
  notas: Nota[];
}

export interface Recurso {
  id: string;
  /** Nombre de archivo dentro del EPUB (sin carpeta). */
  nombre: string;
  tipoMime: string;
  datos: Uint8Array;
  ancho?: number;
  alto?: number;
}

export type RolCredito = 'aut' | 'ill' | 'trl' | 'edt';

export const ROLES: { id: RolCredito; nombre: string }[] = [
  { id: 'aut', nombre: 'Autor' },
  { id: 'ill', nombre: 'Ilustrador' },
  { id: 'trl', nombre: 'Traductor' },
  { id: 'edt', nombre: 'Editor' },
];

export interface Credito {
  nombre: string;
  rol: RolCredito;
}

export interface Metadatos {
  titulo: string;
  subtitulo?: string;
  creditos: Credito[];
  idioma: string;
  /** ISBN o urn:uuid:… */
  identificador: string;
  fecha?: string;
  editorial?: string;
  descripcion?: string;
  serie?: string;
  volumen?: number;
  derechos?: string;
  resumenAccesibilidad?: string;
  /** Id del recurso de imagen de la portada. */
  portada?: string;
}

export interface Tema {
  fuenteTexto: 'serif' | 'sans-serif';
  fuenteTitulos: 'serif' | 'sans-serif';
  /** Interlineado, en múltiplos del tamaño de letra. */
  interlineado: number;
  /** Sangría de primera línea, en em. */
  sangria: number;
  /** Espacio entre párrafos, en em. */
  espacioParrafos: number;
  alinear: 'justificado' | 'izquierda';
  separador: 'asteriscos' | 'linea' | 'espacio';
}

export interface Tipografia {
  raya: boolean;
  comillas: 'latinas' | 'inglesas' | 'sin-cambio';
  suspensivos: boolean;
}

export interface Libro {
  formato: 'obi-studio';
  version: 1;
  metadatos: Metadatos;
  secciones: Seccion[];
  recursos: Recurso[];
  tema: Tema;
  tipografia: Tipografia;
}

export const TEMA_PREDETERMINADO: Tema = {
  fuenteTexto: 'serif',
  fuenteTitulos: 'serif',
  interlineado: 1.5,
  sangria: 1.5,
  espacioParrafos: 0,
  alinear: 'justificado',
  separador: 'asteriscos',
};

export const TIPOGRAFIA_PREDETERMINADA: Tipografia = {
  raya: true,
  comillas: 'latinas',
  suspensivos: true,
};

let contador = 0;
/** Identificador corto y estable, válido como id XML (empieza por letra). */
export function nuevoId(prefijo = 'x'): string {
  contador = (contador + 1) % 1_000_000;
  const azar = Math.random().toString(36).slice(2, 8);
  return `${prefijo}${Date.now().toString(36)}${contador.toString(36)}${azar}`;
}

export function uuid(): string {
  return globalThis.crypto.randomUUID();
}

export function nuevaSeccion(tipo: TipoSeccion, titulo = ''): Seccion {
  return {
    id: nuevoId('s'),
    tipo,
    titulo,
    mostrarTitulo: !['portada', 'ilustracion', 'creditos', 'dedicatoria'].includes(tipo),
    enIndice: !['portada', 'ilustracion', 'creditos', 'dedicatoria'].includes(tipo),
    bloques: [],
    notas: [],
  };
}

export function parrafo(texto: string, estilo: EstiloParrafo = 'cuerpo'): Parrafo {
  return { tipo: 'parrafo', estilo, contenido: texto ? [{ tipo: 'texto', texto }] : [] };
}

export function libroNuevo(titulo = 'Libro sin título', autor = ''): Libro {
  const prologo = nuevaSeccion('prologo', 'Prólogo');
  prologo.bloques = [parrafo('')];
  const capitulo = nuevaSeccion('capitulo', 'Capítulo 1');
  capitulo.bloques = [parrafo('')];
  const creditos = nuevaSeccion('creditos', 'Créditos');
  creditos.bloques = [parrafo(titulo, 'centrado')];
  return {
    formato: 'obi-studio',
    version: 1,
    metadatos: {
      titulo,
      creditos: autor ? [{ nombre: autor, rol: 'aut' }] : [],
      idioma: 'es',
      identificador: `urn:uuid:${uuid()}`,
      fecha: new Date().toISOString().slice(0, 10),
    },
    secciones: [creditos, prologo, capitulo],
    recursos: [],
    tema: { ...TEMA_PREDETERMINADO },
    tipografia: { ...TIPOGRAFIA_PREDETERMINADA },
  };
}

/** Texto plano de una lista de inlines (para conteos, búsquedas y títulos). */
export function textoPlano(contenido: Inline[]): string {
  return contenido
    .map((i) => (i.tipo === 'texto' ? i.texto : i.tipo === 'ruby' ? i.base : i.tipo === 'salto' ? '\n' : ''))
    .join('');
}

export function contarPalabras(seccion: Seccion): number {
  let total = 0;
  for (const b of seccion.bloques) {
    let t = '';
    if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') t = textoPlano(b.contenido);
    else if (b.tipo === 'lista') t = b.elementos.map(textoPlano).join(' ');
    total += t.split(/\s+/).filter(Boolean).length;
  }
  return total;
}

/** Une textos contiguos con las mismas marcas y quita los vacíos. */
export function normalizarInlines(lista: Inline[]): Inline[] {
  const salida: Inline[] = [];
  for (const i of lista) {
    if (i.tipo === 'texto' && i.texto === '') continue;
    const prev = salida[salida.length - 1];
    if (
      i.tipo === 'texto' &&
      prev &&
      prev.tipo === 'texto' &&
      prev.enlace === i.enlace &&
      prev.idioma === i.idioma &&
      mismasMarcas(prev.marcas, i.marcas)
    ) {
      prev.texto += i.texto;
      continue;
    }
    salida.push(i.tipo === 'texto' ? { ...i, marcas: i.marcas?.length ? [...i.marcas].sort() : undefined } : i);
  }
  for (const i of salida) if (i.tipo === 'texto' && !i.marcas) delete i.marcas;
  return salida;
}

export function mismasMarcas(a: Marca[] = [], b: Marca[] = []): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((m, k) => m === sb[k]);
}
