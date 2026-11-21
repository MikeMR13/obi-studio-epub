// Esquema del editor visual: solo admite lo que el modelo del libro sabe guardar.

import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { ESTILOS_PARRAFO, VARIANTES_RECUADRO } from '../../../src/model.js';
import { t } from '../i18n.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    obi: {
      setEstilo: (estilo: string) => ReturnType;
      toggleVersalitas: () => ReturnType;
      setIdioma: (lang: string | null) => ReturnType;
      insertarRuby: (base: string, lectura: string) => ReturnType;
      insertarNota: (id: string) => ReturnType;
      insertarImagen: (attrs: { recurso: string; alt: string }) => ReturnType;
      insertarRecuadro: (variante: string) => ReturnType;
      insertarSaltoPagina: () => ReturnType;
    };
  }
}

export const ParrafoObi = Paragraph.extend({
  addAttributes() {
    return {
      estilo: {
        default: 'cuerpo',
        parseHTML: (el) => ESTILOS_PARRAFO.find((e) => el.classList.contains(e.id))?.id ?? 'cuerpo',
        renderHTML: (a) => (a.estilo && a.estilo !== 'cuerpo' ? { class: a.estilo } : {}),
      },
      // Espacio propio del párrafo (el del original); no pasa al párrafo nuevo al pulsar Intro.
      espacioAntes: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => (el.dataset.antes ? Number(el.dataset.antes) : null),
        renderHTML: (a) => (a.espacioAntes != null ? { 'data-antes': a.espacioAntes, style: `margin-top: ${a.espacioAntes}em` } : {}),
      },
      // Estilo de párrafo propio (Tema.estilosParrafo); se pinta como clase ep-<id>.
      clase: {
        default: null,
        keepOnSplit: true,
        parseHTML: (el) => [...el.classList].find((c) => c.startsWith('ep-'))?.slice(3) ?? null,
        renderHTML: (a) => (a.clase ? { class: `ep-${a.clase}` } : {}),
      },
      espacioDespues: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => (el.dataset.despues ? Number(el.dataset.despues) : null),
        renderHTML: (a) => (a.espacioDespues != null ? { 'data-despues': a.espacioDespues, style: `margin-bottom: ${a.espacioDespues}em` } : {}),
      },
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setEstilo:
        (estilo: string) =>
        ({ commands, editor }: any) => {
          if (!editor.isActive('paragraph')) commands.setParagraph();
          return commands.updateAttributes('paragraph', { estilo });
        },
    } as any;
  },
  addKeyboardShortcuts() {
    const atajos: Record<string, () => boolean> = {};
    ESTILOS_PARRAFO.forEach((e, k) => {
      atajos[`Mod-Alt-${k}`] = () => this.editor.commands.setEstilo(e.id);
    });
    return atajos;
  },
});

export const Versalitas = Mark.create({
  name: 'versalitas',
  parseHTML: () => [{ tag: 'span.vs' }],
  renderHTML: () => ['span', { class: 'vs' }, 0],
  addCommands() {
    return { toggleVersalitas: () => ({ commands }: any) => commands.toggleMark(this.name) } as any;
  },
});

export const Enfasis = Mark.create({
  name: 'enfasis',
  parseHTML: () => [{ tag: 'span.boten' }],
  renderHTML: () => ['span', { class: 'boten', title: t('Puntos de énfasis (傍点)') }, 0],
});

/** Comentario de revisión: una marca por comentario (pueden solaparse). No sale en el EPUB. */
export const ComentarioMarca = Mark.create({
  name: 'comentario',
  excludes: '',
  inclusive: false,
  addAttributes: () => ({ id: { default: null, parseHTML: (e) => e.getAttribute('data-comentario'), renderHTML: (a) => ({ 'data-comentario': a.id }) } }),
  parseHTML: () => [{ tag: 'span[data-comentario]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', { ...HTMLAttributes, class: 'comentado' }, 0],
});

export const Idioma = Mark.create({
  name: 'idioma',
  addAttributes: () => ({ lang: { default: null } }),
  parseHTML: () => [{ tag: 'span[lang]', getAttrs: (el) => ({ lang: (el as HTMLElement).getAttribute('lang') }) }],
  renderHTML: ({ HTMLAttributes }) => ['span', { lang: HTMLAttributes.lang, class: 'idioma', title: `Idioma: ${HTMLAttributes.lang}` }, 0],
  addCommands() {
    return {
      setIdioma:
        (lang: string | null) =>
        ({ commands }: any) =>
          lang ? commands.setMark(this.name, { lang }) : commands.unsetMark(this.name),
    } as any;
  },
});

export const Ruby = Node.create({
  name: 'ruby',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ base: { default: '' }, lectura: { default: '' } }),
  parseHTML: () => [{ tag: 'ruby[data-obi]' }],
  renderHTML: ({ node }) => ['ruby', { 'data-obi': '1', title: t('Doble clic para editar la furigana') }, node.attrs.base, ['rt', {}, node.attrs.lectura]],
  addCommands() {
    return {
      insertarRuby:
        (base: string, lectura: string) =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name, attrs: { base, lectura } }),
    } as any;
  },
});

export const NotaRef = Node.create({
  name: 'notaRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ id: { default: '' } }),
  parseHTML: () => [{ tag: 'sup[data-nota]', getAttrs: (el) => ({ id: (el as HTMLElement).dataset.nota }) }],
  renderHTML: ({ node }) => ['sup', { 'data-nota': node.attrs.id, class: 'llamada-nota', title: t('Nota al pie') }, '✱'],
  addCommands() {
    return {
      insertarNota:
        (id: string) =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name, attrs: { id } }),
    } as any;
  },
});

export const ImagenObi = Node.create({
  name: 'imagen',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ recurso: { default: '' }, alt: { default: '' }, decorativa: { default: false }, pie: { default: '' } }),
  parseHTML: () => [{ tag: 'figure[data-recurso]', getAttrs: (el) => ({ recurso: (el as HTMLElement).dataset.recurso }) }],
  renderHTML: ({ node }) => [
    'figure',
    { 'data-recurso': node.attrs.recurso, class: 'imagen-editor' },
    ['img', { src: `/api/recursos/${node.attrs.recurso}`, alt: node.attrs.alt }],
    ['figcaption', {}, node.attrs.decorativa ? t('Imagen decorativa') : node.attrs.alt ? t('Descripción: {0}', { 0: node.attrs.alt }) : t('⚠ Falta la descripción (clic para añadirla)')],
  ],
  addCommands() {
    return {
      insertarImagen:
        (attrs: { recurso: string; alt: string }) =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name, attrs }),
    } as any;
  },
});

export const Crudo = Node.create({
  name: 'crudo',
  group: 'block',
  atom: true,
  addAttributes: () => ({ xhtml: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-crudo]' }],
  renderHTML: ({ node }) => {
    const resumen = String(node.attrs.xhtml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    const tipo = String(node.attrs.xhtml).match(/^<(\w+)/)?.[1] ?? 'XHTML';
    return ['div', { 'data-crudo': '1', class: 'bloque-crudo', title: t('Este bloque se edita en la pestaña Código') }, `⟨${tipo}⟩ ${resumen || t('(sin texto)')}`];
  },
});

/** Alineación de una celda (clase al-centro / al-derecha, como en el EPUB). */
const atributoAlinear = {
  alinear: {
    default: null,
    parseHTML: (el: HTMLElement) => (el.classList.contains('al-centro') ? 'centro' : el.classList.contains('al-derecha') ? 'derecha' : null),
    renderHTML: (a: Record<string, unknown>) => (a.alinear ? { class: `al-${a.alinear}` } : {}),
  },
};

/** Tablas editables: título (caption) como atributo de la tabla y alineación por celda. */
export const TablaObi = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      titulo: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-titulo') ?? '',
        renderHTML: (a: Record<string, unknown>) => (a.titulo ? { 'data-titulo': String(a.titulo) } : {}),
      },
    };
  },
}).configure({ resizable: false, HTMLAttributes: { class: 'tabla' } });
export const CeldaObi = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...atributoAlinear }; } });
export const CeldaEncabezadoObi = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...atributoAlinear }; } });

/** Salto de página dentro de la sección. */
export const SaltoPaginaObi = Node.create({
  name: 'saltoPagina',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-salto-pagina]' }],
  renderHTML: () => ['div', { 'data-salto-pagina': '1', class: 'salto-pagina-editor', title: t('Lo que sigue empieza en una página nueva') }, t('Salto de página')],
  addCommands() {
    return {
      insertarSaltoPagina:
        () =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name }),
    } as any;
  },
});

/** Subtítulos que no salen en el índice de dos niveles. */
export const SubtituloFueraDeIndice = Extension.create({
  name: 'subtituloFueraDeIndice',
  addGlobalAttributes: () => [
    {
      types: ['heading'],
      attributes: {
        fueraDeIndice: {
          default: false,
          parseHTML: (el: HTMLElement) => el.hasAttribute('data-fuera-indice'),
          renderHTML: (a: Record<string, unknown>) => (a.fueraDeIndice ? { 'data-fuera-indice': '1' } : {}),
        },
      },
    },
  ],
});

/** Tamaño, color y fondo propios de un fragmento (los del original). */
export const AspectoObi = Mark.create({
  name: 'aspecto',
  addAttributes: () => ({ tamano: { default: null }, color: { default: null }, fondo: { default: null } }),
  parseHTML: () => [
    {
      tag: 'span[data-aspecto]',
      getAttrs: (el) => {
        const d = (el as HTMLElement).dataset;
        return { tamano: d.tamano ? Number(d.tamano) : null, color: d.color || null, fondo: d.fondo || null };
      },
    },
  ],
  renderHTML: ({ mark }) => {
    const a = mark.attrs;
    const estilo = [a.tamano != null ? `font-size: ${a.tamano}em` : '', a.color ? `color: ${a.color}` : '', a.fondo ? `background-color: ${a.fondo}` : ''].filter(Boolean).join('; ');
    return ['span', { 'data-aspecto': '1', 'data-tamano': a.tamano ?? '', 'data-color': a.color ?? '', 'data-fondo': a.fondo ?? '', style: estilo }, 0];
  },
});

// ---------------------------------------------------------------------------
// Recuadros de novela ligera. La cabecera (tipo, título, quitar) y las etiquetas de cada línea
// son controles fuera del texto editable; el texto de cada línea se edita como un párrafo.

function variante(id: string) {
  return VARIANTES_RECUADRO.find((v) => v.id === id) ?? VARIANTES_RECUADRO[0];
}

export const RecuadroObi = Node.create({
  name: 'recuadro',
  group: 'block',
  content: 'lineaRecuadro+',
  defining: true,
  isolating: true,
  draggable: true,
  addAttributes: () => ({ variante: { default: 'sistema' }, titulo: { default: '' } }),
  parseHTML: () => [
    { tag: 'div[data-recuadro]', getAttrs: (el) => ({ variante: (el as HTMLElement).dataset.recuadro, titulo: (el as HTMLElement).dataset.titulo ?? '' }) },
  ],
  renderHTML: ({ node }) => ['div', { 'data-recuadro': node.attrs.variante, 'data-titulo': node.attrs.titulo, class: `recuadro-editor recuadro-${node.attrs.variante}` }, 0],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let actual = node;
      const dom = document.createElement('div');
      const cabecera = document.createElement('div');
      cabecera.className = 'cabecera-recuadro';
      cabecera.contentEditable = 'false';
      const tipo = document.createElement('select');
      tipo.setAttribute('aria-label', t('Tipo de recuadro'));
      for (const v of VARIANTES_RECUADRO) {
        const o = document.createElement('option');
        o.value = v.id;
        o.textContent = t(v.nombre);
        tipo.append(o);
      }
      const titulo = document.createElement('input');
      titulo.className = 'titulo-recuadro';
      const quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.textContent = '✕';
      quitar.title = t('Quitar el recuadro');
      quitar.setAttribute('aria-label', t('Quitar el recuadro'));
      cabecera.append(tipo, titulo, quitar);
      const lineas = document.createElement('div');
      lineas.className = 'lineas-recuadro';
      dom.append(cabecera, lineas);
      const cambiar = (attrs: Record<string, unknown>) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined || !editor.isEditable) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...actual.attrs, ...attrs }));
      };
      tipo.addEventListener('change', () => cambiar({ variante: tipo.value }));
      titulo.addEventListener('input', () => cambiar({ titulo: titulo.value }));
      quitar.addEventListener('click', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos !== undefined) editor.view.dispatch(editor.view.state.tr.delete(pos, pos + actual.nodeSize));
      });
      const pintar = () => {
        const v = variante(String(actual.attrs.variante));
        dom.className = `recuadro-editor recuadro-${v.id}`;
        dom.dataset.recuadro = v.id;
        tipo.value = v.id;
        if (titulo.value !== actual.attrs.titulo) titulo.value = String(actual.attrs.titulo ?? '');
        titulo.placeholder = v.titulo ? t(v.titulo) : t('Sin título');
        titulo.hidden = !v.titulo;
        titulo.setAttribute('aria-label', v.titulo ? t(v.titulo) : t('Título'));
        tipo.disabled = quitar.disabled = titulo.disabled = !editor.isEditable;
      };
      pintar();
      return {
        dom,
        contentDOM: lineas,
        update: (n) => {
          if (n.type !== actual.type) return false;
          actual = n;
          pintar();
          return true;
        },
        stopEvent: (e) => cabecera.contains(e.target as globalThis.Node),
        ignoreMutation: (m) => cabecera.contains(m.target as globalThis.Node),
      };
    };
  },
  addCommands() {
    return {
      insertarRecuadro:
        (v: string) =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name, attrs: { variante: v, titulo: '' }, content: [{ type: 'lineaRecuadro', attrs: { etiqueta: '', lado: 'izq' } }] }),
    } as any;
  },
  addProseMirrorPlugins() {
    // Al volver al texto desde un campo del recuadro (título, etiqueta), el navegador pone el cursor al
    // principio del documento: se coloca donde se hizo clic.
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, e) => {
              const activo = document.activeElement;
              if (!(activo instanceof HTMLInputElement || activo instanceof HTMLSelectElement) || !view.dom.contains(activo)) return false;
              if ((e.target as HTMLElement).closest('.cabecera-recuadro, .controles-linea')) return false;
              const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
              if (!pos) return false;
              e.preventDefault();
              view.focus();
              view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos))));
              return true;
            },
          },
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      // Intro en una línea vacía al final del recuadro: salir a un párrafo nuevo.
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== 'lineaRecuadro' || $from.parent.content.size) return false;
        const recuadro = $from.node(-1);
        if ($from.index(-1) !== recuadro.childCount - 1 || recuadro.childCount < 2) return false;
        const ini = $from.before();
        const finLinea = $from.after();
        const pos = $from.after(-1) - (finLinea - ini);
        const tr = state.tr.delete(ini, finLinea);
        tr.insert(pos, state.schema.nodes.paragraph.create({ estilo: 'cuerpo' }));
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        this.editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});

export const LineaRecuadroObi = Node.create({
  name: 'lineaRecuadro',
  content: 'inline*',
  addAttributes: () => ({ etiqueta: { default: '' }, lado: { default: 'izq' } }),
  parseHTML: () => [{ tag: 'p[data-linea]', getAttrs: (el) => ({ etiqueta: (el as HTMLElement).dataset.etiqueta ?? '', lado: (el as HTMLElement).dataset.lado ?? 'izq' }) }],
  renderHTML: ({ node }) => ['p', { 'data-linea': '1', 'data-etiqueta': node.attrs.etiqueta, 'data-lado': node.attrs.lado }, 0],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let actual = node;
      const dom = document.createElement('div');
      dom.className = 'linea-recuadro';
      const controles = document.createElement('span');
      controles.className = 'controles-linea';
      controles.contentEditable = 'false';
      const etiqueta = document.createElement('input');
      etiqueta.className = 'etiqueta-linea';
      const lado = document.createElement('button');
      lado.type = 'button';
      lado.className = 'lado-linea';
      controles.append(etiqueta, lado);
      const texto = document.createElement('p');
      texto.className = 'texto-linea';
      dom.append(controles, texto);
      const cambiar = (attrs: Record<string, unknown>) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined || !editor.isEditable) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...actual.attrs, ...attrs }));
      };
      etiqueta.addEventListener('input', () => cambiar({ etiqueta: etiqueta.value }));
      lado.addEventListener('click', () => cambiar({ lado: actual.attrs.lado === 'der' ? 'izq' : 'der' }));
      const pintar = () => {
        if (etiqueta.value !== actual.attrs.etiqueta) etiqueta.value = String(actual.attrs.etiqueta ?? '');
        dom.dataset.lado = actual.attrs.lado === 'der' ? 'der' : 'izq';
        lado.textContent = actual.attrs.lado === 'der' ? '→' : '←';
        lado.title = actual.attrs.lado === 'der' ? t('Mensaje propio (derecha). Clic para cambiar.') : t('Mensaje ajeno (izquierda). Clic para cambiar.');
        lado.setAttribute('aria-label', lado.title);
        etiqueta.placeholder = t('Dato o quién');
        etiqueta.setAttribute('aria-label', t('Dato o quién escribe'));
        etiqueta.disabled = lado.disabled = !editor.isEditable;
      };
      pintar();
      return {
        dom,
        contentDOM: texto,
        update: (n) => {
          if (n.type !== actual.type) return false;
          actual = n;
          pintar();
          return true;
        },
        stopEvent: (e) => controles.contains(e.target as globalThis.Node),
        ignoreMutation: (m) => controles.contains(m.target as globalThis.Node),
      };
    };
  },
});

/** Extensiones del editor. En modo colaborativo el historial lo lleva Yjs (deshacer solo lo propio). */
export function extensiones(op: { colaborativo?: boolean } = {}) {
  return [
    StarterKit.configure({
      ...(op.colaborativo ? { undoRedo: false } : {}),
      paragraph: false,
      heading: { levels: [2, 3] },
      codeBlock: false,
      code: false,
      blockquote: false,
      link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] },
    }),
    ParrafoObi,
    Superscript,
    Subscript,
    Versalitas,
    Enfasis,
    ComentarioMarca,
    Idioma,
    Ruby,
    NotaRef,
    ImagenObi,
    Crudo,
    RecuadroObi,
    LineaRecuadroObi,
    AspectoObi,
    SaltoPaginaObi,
    SubtituloFueraDeIndice,
    TablaObi,
    TableRow,
    CeldaObi,
    CeldaEncabezadoObi,
  ];
}
