// Modelo del libro de Obi Studio.
// El libro vive aquí, nunca en HTML: el editor visual, el código y cada exportador leen y escriben este modelo.

export type Marca =
  | 'negrita'
  | 'cursiva'
  | 'subrayado'
  | 'tachado'
  | 'versalitas'
  | 'superindice'
  | 'subindice'
  /** Puntos de énfasis (傍点 / bōten) de la tipografía japonesa. */
  | 'enfasis';

export const MARCAS: Marca[] = ['negrita', 'cursiva', 'subrayado', 'tachado', 'versalitas', 'superindice', 'subindice', 'enfasis'];

export interface Texto {
  tipo: 'texto';
  texto: string;
  marcas?: Marca[];
  enlace?: string;
  /** Idioma BCP 47 de este fragmento, si difiere del libro (p. ej. "ja"). */
  idioma?: string;
  /** Comentarios de revisión anclados a este fragmento (ids de `Seccion.comentarios`). No salen en el EPUB ni en el PDF. */
  comentarios?: string[];
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

/** Respuesta dentro de un hilo de comentarios. */
export interface Respuesta {
  autor: string;
  /** Fecha ISO 8601. */
  fecha: string;
  texto: string;
}

/** Comentario de revisión. Solo vive en el proyecto y en el Word de corrección; nunca en el EPUB ni en el PDF. */
export interface Comentario {
  id: string;
  autor: string;
  fecha: string;
  texto: string;
  resuelto?: boolean;
  respuestas?: Respuesta[];
  /** Texto comentado, cuando el ancla se perdió (p. ej. el corrector borró la frase). */
  cita?: string;
}

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
  /** Imagen decorativa sobre el título del capítulo. */
  imagenCabecera?: string;
  /** Ilustración horizontal a doble página enfrentada (PDF y, con página fija, también en el EPUB). */
  doblePagina?: boolean;
  /** Ilustración o portada como página fija (pre-paginated) dentro de un libro fluido. */
  paginaFija?: boolean;
  /** Comentarios de revisión de esta sección. */
  comentarios?: Comentario[];
  /** Cambios propuestos (control de cambios) pendientes de aceptar o rechazar. */
  cambios?: CambioPropuesto[];
}

/**
 * Cambio propuesto: sustituye los bloques `antes` (que empiezan en `posicion`) por `despues`.
 * Un cambio solo de título lleva `titulo` y listas vacías.
 */
export interface CambioPropuesto {
  id: string;
  autor: string;
  fecha: string;
  posicion: number;
  antes: Bloque[];
  despues: Bloque[];
  /** Notas a las que llaman los bloques de `despues`. */
  notas?: Nota[];
  titulo?: { antes: string; despues: string };
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

/** Fuentes disponibles. Las «del lector» no se incrustan; las demás (licencia OFL) van dentro del EPUB y del PDF. */
export interface Fuente {
  id: string;
  nombre: string;
  familia: string;
  /** Prefijo de los archivos .woff2 en recursos/fuentes; vacío si no se incrusta. */
  archivo: string;
  estilos: string[];
  /** Fuente con la que se imprime si no se incrusta en el EPUB. */
  impresion: string;
  generica: 'serif' | 'sans-serif';
  soloTitulos?: boolean;
}

/** Una cara (grosor y estilo) de una fuente propia del usuario. */
export interface CaraFuentePropia {
  peso: number;
  estilo: 'normal' | 'italic';
  formato: 'ttf' | 'otf';
  /** Campo fsType de la fuente (licencia de incrustación). */
  fsType: number;
  /** Nombre del archivo original. */
  origen: string;
  datos: Uint8Array;
}

/** Fuente propia (TTF u OTF del usuario), incrustada como subconjunto en el EPUB y el PDF. */
export interface FuentePropia {
  id: string;
  familia: string;
  generica: 'serif' | 'sans-serif';
  caras: CaraFuentePropia[];
}

export const FUENTES: Fuente[] = [
  { id: 'serif', nombre: 'Con remate del lector', familia: 'serif', archivo: '', estilos: [], impresion: 'literata', generica: 'serif' },
  { id: 'sans-serif', nombre: 'Sin remate del lector', familia: 'sans-serif', archivo: '', estilos: [], impresion: 'noto-sans', generica: 'sans-serif' },
  { id: 'literata', nombre: 'Literata', familia: 'Literata', archivo: 'literata', estilos: ['400-normal', '400-italic', '700-normal', '700-italic'], impresion: 'literata', generica: 'serif' },
  { id: 'eb-garamond', nombre: 'EB Garamond', familia: 'EB Garamond', archivo: 'eb-garamond', estilos: ['400-normal', '400-italic', '700-normal', '700-italic'], impresion: 'eb-garamond', generica: 'serif' },
  { id: 'noto-sans', nombre: 'Noto Sans', familia: 'Noto Sans', archivo: 'noto-sans', estilos: ['400-normal', '400-italic', '700-normal', '700-italic'], impresion: 'noto-sans', generica: 'sans-serif' },
  { id: 'cinzel', nombre: 'Cinzel (títulos)', familia: 'Cinzel', archivo: 'cinzel', estilos: ['400-normal', '700-normal'], impresion: 'cinzel', generica: 'serif', soloTitulos: true },
];

export function fuente(id: string): Fuente {
  return FUENTES.find((f) => f.id === id) ?? FUENTES[0];
}

export type EstiloTitulo = 'centrado' | 'izquierda' | 'numero-grande' | 'linea';
export type SeparadorEscena = 'asteriscos' | 'linea' | 'espacio' | 'flor' | 'rombos' | 'puntos' | 'imagen';

export interface Tema {
  /** Nombre del tema (para guardarlo y reconocerlo en la galería). */
  nombre?: string;
  fuenteTexto: string;
  fuenteTitulos: string;
  /** Interlineado, en múltiplos del tamaño de letra. */
  interlineado: number;
  /** Sangría de primera línea, en em. */
  sangria: number;
  /** Espacio entre párrafos, en em. */
  espacioParrafos: number;
  alinear: 'justificado' | 'izquierda';
  separador: SeparadorEscena;
  /** Imagen del separador cuando separador = 'imagen'. */
  separadorImagen?: string;
  tituloEstilo: EstiloTitulo;
  tituloMayusculas: boolean;
  /** Tamaño del título de capítulo, en em. */
  tituloTamano: number;
  /** Espacio sobre el título en la apertura, en em. */
  tituloEspacio: number;
  capitular: 'ninguna' | 'letra';
  /** Primera línea del capítulo en versalitas. */
  primeraLinea: boolean;
  colorTitulos: string;
  colorAcento: string;
}

export const TEMA_PREDETERMINADO: Tema = {
  nombre: 'Clásico',
  fuenteTexto: 'serif',
  fuenteTitulos: 'serif',
  interlineado: 1.5,
  sangria: 1.5,
  espacioParrafos: 0,
  alinear: 'justificado',
  separador: 'asteriscos',
  tituloEstilo: 'centrado',
  tituloMayusculas: false,
  tituloTamano: 1.5,
  tituloEspacio: 2,
  capitular: 'ninguna',
  primeraLinea: false,
  colorTitulos: '#000000',
  colorAcento: '#000000',
};

/** Tema completo (los proyectos antiguos no tienen todos los campos). */
export function temaCompleto(libro: Pick<Libro, 'tema'>): Tema {
  return { ...TEMA_PREDETERMINADO, ...(libro.tema ?? {}) };
}

const COLOR = /^#[0-9a-f]{6}$/i;

/** Valida un tema que llega de fuera (archivo .obitema o la interfaz) y devuelve solo los campos correctos. */
export function validarTema(entrada: unknown, propias: string[] = []): Partial<Tema> {
  const e = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const t: Partial<Tema> = {};
  const numero = (k: keyof Tema, min: number, max: number) => {
    const v = Number(e[k]);
    if (e[k] !== undefined && !isNaN(v)) (t as Record<string, unknown>)[k] = Math.min(max, Math.max(min, v));
  };
  const opcion = <T extends string>(k: keyof Tema, validos: readonly T[]) => {
    if (validos.includes(e[k] as T)) (t as Record<string, unknown>)[k] = e[k];
  };
  if (typeof e.nombre === 'string') t.nombre = e.nombre.slice(0, 60);
  opcion('fuenteTexto', [...FUENTES.filter((f) => !f.soloTitulos).map((f) => f.id), ...propias]);
  opcion('fuenteTitulos', [...FUENTES.map((f) => f.id), ...propias]);
  numero('interlineado', 1.1, 2.2);
  numero('sangria', 0, 4);
  numero('espacioParrafos', 0, 2);
  opcion('alinear', ['justificado', 'izquierda'] as const);
  opcion('separador', ['asteriscos', 'linea', 'espacio', 'flor', 'rombos', 'puntos', 'imagen'] as const);
  if (typeof e.separadorImagen === 'string') t.separadorImagen = e.separadorImagen;
  opcion('tituloEstilo', ['centrado', 'izquierda', 'numero-grande', 'linea'] as const);
  if (typeof e.tituloMayusculas === 'boolean') t.tituloMayusculas = e.tituloMayusculas;
  numero('tituloTamano', 1, 3);
  numero('tituloEspacio', 0, 12);
  opcion('capitular', ['ninguna', 'letra'] as const);
  if (typeof e.primeraLinea === 'boolean') t.primeraLinea = e.primeraLinea;
  if (typeof e.colorTitulos === 'string' && COLOR.test(e.colorTitulos)) t.colorTitulos = e.colorTitulos;
  if (typeof e.colorAcento === 'string' && COLOR.test(e.colorAcento)) t.colorAcento = e.colorAcento;
  return t;
}

/** Divide «Capítulo 3: El gremio» en etiqueta («Capítulo 3»), separador y nombre («El gremio»). */
export function partesTitulo(titulo: string): { etiqueta: string; sep: string; nombre: string } | null {
  const m = titulo.match(/^((?:cap[ií]tulo|chapter|parte|libro|acto|interludio|ep[ií]logo|pr[oó]logo)\s+[\wIVXLCDM]+|\d+|[IVXLCDM]+)(\s*[.:–—-]\s*|\s+)(.+)$/i);
  return m ? { etiqueta: m[1], sep: m[2], nombre: m[3] } : null;
}

export interface Tipografia {
  raya: boolean;
  comillas: 'latinas' | 'inglesas' | 'sin-cambio';
  suspensivos: boolean;
}

/** Tamaños de corte habituales (milímetros). */
export const TAMANOS_IMPRESION: { id: string; nombre: string; ancho: number; alto: number }[] = [
  { id: '5x8', nombre: '12,7 × 20,32 cm (5 × 8 in)', ancho: 127, alto: 203.2 },
  { id: '5.25x8', nombre: '13,34 × 20,32 cm (5,25 × 8 in)', ancho: 133.35, alto: 203.2 },
  { id: '5.5x8.5', nombre: '13,97 × 21,59 cm (5,5 × 8,5 in)', ancho: 139.7, alto: 215.9 },
  { id: '6x9', nombre: '15,24 × 22,86 cm (6 × 9 in)', ancho: 152.4, alto: 228.6 },
  { id: 'a5', nombre: 'A5 · 14,8 × 21 cm', ancho: 148, alto: 210 },
  { id: 'b6', nombre: 'B6 japonés (tankōbon) · 12,8 × 18,2 cm', ancho: 128, alto: 182 },
  { id: 'a6', nombre: 'A6 (bunkobon) · 10,5 × 14,8 cm', ancho: 105, alto: 148 },
];

export interface Impresion {
  tamano: string;
  /** Medidas de corte en mm (se copian del tamaño elegido o son libres). */
  ancho: number;
  alto: number;
  /** ninguno · uniforme (3 mm por lado: IngramSpark, Lulu) · kdp (3,175 mm solo arriba, abajo y exterior). */
  sangrado: 'ninguno' | 'uniforme' | 'kdp';
  margenSuperior: number;
  margenInferior: number;
  margenExterior: number;
  /** 0 = automático según el número de páginas (tabla de KDP). */
  margenInterior: number;
  cuerpo: number;
  cabeceras: boolean;
  folios: boolean;
  capituloEnImpar: boolean;
  division: boolean;
  incluirPortada: boolean;
  ilustracionesASangre: boolean;
  /** Convertir el PDF de imprenta a PDF/X-1a:2001 (CMYK); necesita Ghostscript instalado. */
  pdfx?: boolean;
  /** Marcas de corte para imprentas tradicionales (KDP e IngramSpark las rechazan). */
  marcasCorte?: boolean;
}

export const IMPRESION_PREDETERMINADA: Impresion = {
  tamano: '5.5x8.5',
  ancho: 139.7,
  alto: 215.9,
  sangrado: 'ninguno',
  margenSuperior: 18,
  margenInferior: 18,
  margenExterior: 14,
  margenInterior: 0,
  cuerpo: 10.5,
  cabeceras: true,
  folios: true,
  capituloEnImpar: true,
  division: true,
  incluirPortada: false,
  ilustracionesASangre: false,
};

export interface Libro {
  formato: 'obi-studio';
  version: 1;
  metadatos: Metadatos;
  secciones: Seccion[];
  recursos: Recurso[];
  tema: Tema;
  tipografia: Tipografia;
  /** Ajustes del PDF de impresión (opcional en proyectos antiguos). */
  impresion?: Impresion;
  /** Dirección del texto: horizontal (predeterminada) o vertical japonesa (tategaki), de derecha a izquierda. */
  escritura?: 'horizontal' | 'vertical';
  /** Fuentes propias del usuario; el tema las cita como «propia-<id>». */
  fuentesPropias?: FuentePropia[];
  /** Reducir y recomprimir las imágenes al exportar el EPUB (el proyecto y el PDF conservan las originales). */
  optimizarImagenes?: boolean;
  /** Versiones guardadas con nombre (ver src/versiones.ts). No salen en el EPUB. */
  versiones?: Version[];
  /** Imágenes que solo usan las versiones guardadas, por huella. */
  recursosVersiones?: (Recurso & { huella: string })[];
}

/** Instantánea con nombre del libro. */
export interface Version {
  id: string;
  nombre: string;
  /** Fecha ISO 8601. */
  fecha: string;
  palabras: number;
  /** JSON del libro sin versiones; las imágenes van sin bytes y con su huella. */
  libro: string;
}

export function esVertical(libro: Pick<Libro, 'escritura'>): boolean {
  return libro.escritura === 'vertical';
}

export function ajustesImpresion(libro: Libro): Impresion {
  return { ...IMPRESION_PREDETERMINADA, ...(libro.impresion ?? {}) };
}

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
      mismasMarcas(prev.marcas, i.marcas) &&
      mismosComentarios(prev.comentarios, i.comentarios)
    ) {
      prev.texto += i.texto;
      continue;
    }
    salida.push(
      i.tipo === 'texto'
        ? { ...i, marcas: i.marcas?.length ? [...i.marcas].sort() : undefined, comentarios: i.comentarios?.length ? [...new Set(i.comentarios)].sort() : undefined }
        : i,
    );
  }
  for (const i of salida) {
    if (i.tipo !== 'texto') continue;
    if (!i.marcas) delete i.marcas;
    if (!i.comentarios) delete i.comentarios;
  }
  return salida;
}

export function mismosComentarios(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((m, k) => m === sb[k]);
}

export function mismasMarcas(a: Marca[] = [], b: Marca[] = []): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((m, k) => m === sb[k]);
}
