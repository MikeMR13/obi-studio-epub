// Esquema del editor visual: solo admite lo que el modelo del libro sabe guardar.

import { Mark, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import { ESTILOS_PARRAFO } from '../../../src/model';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    obi: {
      setEstilo: (estilo: string) => ReturnType;
      toggleVersalitas: () => ReturnType;
      setIdioma: (lang: string | null) => ReturnType;
      insertarRuby: (base: string, lectura: string) => ReturnType;
      insertarNota: (id: string) => ReturnType;
      insertarImagen: (attrs: { recurso: string; alt: string }) => ReturnType;
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
  renderHTML: ({ node }) => ['ruby', { 'data-obi': '1', title: 'Doble clic para editar la furigana' }, node.attrs.base, ['rt', {}, node.attrs.lectura]],
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
  renderHTML: ({ node }) => ['sup', { 'data-nota': node.attrs.id, class: 'llamada-nota', title: 'Nota al pie' }, '✱'],
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
    ['figcaption', {}, node.attrs.decorativa ? 'Imagen decorativa' : node.attrs.alt ? `Descripción: ${node.attrs.alt}` : '⚠ Falta la descripción (clic para añadirla)'],
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
    return ['div', { 'data-crudo': '1', class: 'bloque-crudo', title: 'Este bloque se edita en la pestaña Código' }, `⟨${tipo}⟩ ${resumen || '(sin texto)'}`];
  },
});

export function extensiones() {
  return [
    StarterKit.configure({
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
    Idioma,
    Ruby,
    NotaRef,
    ImagenObi,
    Crudo,
  ];
}
