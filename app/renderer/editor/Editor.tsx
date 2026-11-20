import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor as TEditor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import type { Bloque, Nota, Seccion, Inline } from '../../../src/model';
import { ESTILOS_PARRAFO, nuevoId, textoPlano } from '../../../src/model';
import { bloquesAPM, pmABloques } from '../../../src/editor-modelo';
import { extensiones } from './extensiones';
import { api } from '../api';
import { aviso, pedirDatos } from '../dialogos';
import { guardarRevisor, nombreRevisor } from '../paneles/Comentarios';

interface Props {
  seccion: Seccion;
  onCambio: (bloques: Bloque[], notas: Nota[]) => void;
  onEstado: (e: { recargar?: boolean }) => void;
  /** Se creó un comentario sobre el texto seleccionado. */
  onComentar: (c: { id: string; texto: string; autor: string; cita: string }) => void;
  /** Escritura vertical japonesa (tategaki). */
  vertical?: boolean;
  /** Idioma del libro, para la ortografía y la tipografía. */
  idioma?: string;
}

function idsNotas(bloques: Bloque[]): Set<string> {
  const ids = new Set<string>();
  const ver = (l: Inline[]) => l.forEach((i) => i.tipo === 'nota' && ids.add(i.id));
  for (const b of bloques) {
    if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') ver(b.contenido);
    if (b.tipo === 'lista') b.elementos.forEach(ver);
  }
  return ids;
}

export function Editor({ seccion, onCambio, onEstado, onComentar, vertical, idioma: idiomaLibro }: Props) {
  const [notas, setNotas] = useState<Nota[]>(seccion.notas);
  const notasRef = useRef(notas);
  notasRef.current = notas;
  const temporizador = useRef<number>(undefined);
  const seccionId = useRef(seccion.id);
  const entradaImagen = useRef<HTMLInputElement>(null);

  const guardar = (editor: TEditor, inmediato = false) => {
    window.clearTimeout(temporizador.current);
    const hacer = () => {
      const bloques = pmABloques(editor.getJSON() as any);
      const usadas = idsNotas(bloques);
      const vivas = notasRef.current.filter((n) => usadas.has(n.id));
      if (vivas.length !== notasRef.current.length) setNotas(vivas);
      onCambio(bloques, vivas);
    };
    if (inmediato) hacer();
    else temporizador.current = window.setTimeout(hacer, 500);
  };

  const editor = useEditor({
    extensions: extensiones(),
    content: bloquesAPM(seccion.bloques) as any,
    editorProps: {
      attributes: { class: 'pagina-editor', spellcheck: 'true', lang: idiomaLibro || 'es', 'aria-label': 'Texto de la sección' },
      handleDoubleClickOn: (_view, _pos, node, nodePos) => {
        if (node.type.name === 'ruby') {
          void editarRuby(nodePos, node.attrs.base, node.attrs.lectura);
          return true;
        }
        return false;
      },
      transformPastedHTML: (html) => html.replace(/<meta[^>]*>/g, '').replace(/<o:p>[\s\S]*?<\/o:p>/g, ''),
    },
    onUpdate: ({ editor }) => guardar(editor),
  });

  // Cambiar de sección: guardar lo pendiente y cargar la nueva.
  useEffect(() => {
    if (!editor) return;
    if (seccionId.current !== seccion.id) {
      seccionId.current = seccion.id;
      editor.commands.setContent(bloquesAPM(seccion.bloques) as any, { emitUpdate: false });
      setNotas(seccion.notas);
    }
  }, [seccion.id, editor]);

  // Cambios externos (código, tipografía): recargar si el contenido difiere.
  useEffect(() => {
    if (!editor || seccionId.current !== seccion.id) return;
    const actual = JSON.stringify(pmABloques(editor.getJSON() as any));
    if (actual !== JSON.stringify(seccion.bloques) && !editor.isFocused) {
      editor.commands.setContent(bloquesAPM(seccion.bloques) as any, { emitUpdate: false });
      setNotas(seccion.notas);
    }
  }, [seccion.bloques]);

  // Notas cambiadas desde fuera (buscar y reemplazar, plugins), salvo si se está escribiendo en una.
  useEffect(() => {
    if (seccionId.current !== seccion.id || document.activeElement?.tagName === 'TEXTAREA') return;
    setNotas(seccion.notas);
  }, [seccion.notas]);

  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  // Comentarios: el panel pide ir al texto comentado o quitar la marca.
  useEffect(() => {
    if (!editor) return;
    const rango = (id: string) => {
      let desde = -1;
      let hasta = -1;
      editor.state.doc.descendants((n, pos) => {
        if (n.isText && n.marks.some((m) => m.type.name === 'comentario' && m.attrs.id === id)) {
          if (desde < 0) desde = pos;
          hasta = pos + n.nodeSize;
        }
      });
      return desde < 0 ? null : { desde, hasta };
    };
    const ir = (e: Event) => {
      const r = rango((e as CustomEvent).detail.id);
      if (!r) return;
      editor.chain().focus().setTextSelection({ from: r.desde, to: r.hasta }).scrollIntoView().run();
    };
    const quitar = (e: Event) => {
      const id = (e as CustomEvent).detail.id;
      const tr = editor.state.tr;
      editor.state.doc.descendants((n, pos) => {
        for (const m of n.marks) if (m.type.name === 'comentario' && m.attrs.id === id) tr.removeMark(pos, pos + n.nodeSize, m);
      });
      if (tr.docChanged) {
        editor.view.dispatch(tr);
        guardar(editor, true);
      }
    };
    const seleccionar = (e: Event) => {
      const { bloque, texto } = (e as CustomEvent).detail as { bloque: number; texto: string };
      const doc = editor.state.doc;
      if (bloque >= doc.childCount) return;
      let inicio = 0;
      for (let k = 0; k < bloque; k++) inicio += doc.child(k).nodeSize;
      // Texto del bloque con la posición de cada carácter en el documento.
      const posiciones: number[] = [];
      let plano = '';
      doc.child(bloque).descendants((n, pos) => {
        if (n.isText) for (let k = 0; k < n.text!.length; k++) {
          plano += n.text![k];
          posiciones.push(inicio + 1 + pos + k);
        }
      });
      const i = plano.toLowerCase().indexOf(texto.toLowerCase());
      if (i < 0) return;
      editor.chain().focus().setTextSelection({ from: posiciones[i], to: posiciones[i + texto.length - 1] + 1 }).scrollIntoView().run();
    };
    window.addEventListener('obi:seleccionar', seleccionar);
    window.addEventListener('obi:ir-comentario', ir);
    window.addEventListener('obi:quitar-comentario', quitar);
    return () => {
      window.removeEventListener('obi:ir-comentario', ir);
      window.removeEventListener('obi:seleccionar', seleccionar);
      window.removeEventListener('obi:quitar-comentario', quitar);
    };
  }, [editor]);

  const estado = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const sel = e.state.selection;
      const nodo = sel instanceof NodeSelection ? sel.node : null;
      return {
        estilo: e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : (e.getAttributes('paragraph').estilo ?? 'cuerpo'),
        negrita: e.isActive('bold'),
        cursiva: e.isActive('italic'),
        subrayado: e.isActive('underline'),
        tachado: e.isActive('strike'),
        versalitas: e.isActive('versalitas'),
        enfasis: e.isActive('enfasis'),
        sup: e.isActive('superscript'),
        sub: e.isActive('subscript'),
        enlace: e.isActive('link'),
        idioma: e.getAttributes('idioma').lang as string | undefined,
        imagen: nodo?.type.name === 'imagen' ? ({ pos: sel.from, ...nodo.attrs } as { pos: number; recurso?: string; alt?: string; decorativa?: boolean; pie?: string }) : null,
        vacio: sel.empty,
      };
    },
  });

  const editarRuby = async (pos: number, base: string, lectura: string) => {
    if (!editor) return;
    const r = await pedirDatos('Editar furigana', [
      { nombre: 'base', etiqueta: 'Texto base', valor: base },
      { nombre: 'lectura', etiqueta: 'Lectura (furigana)', valor: lectura, ayuda: 'Déjala vacía para quitar la furigana.' },
    ]);
    if (!r) return;
    const tr = editor.state.tr;
    const nodo = editor.state.doc.nodeAt(pos);
    if (!nodo) return;
    if (!r.lectura.trim()) tr.replaceWith(pos, pos + nodo.nodeSize, editor.schema.text(r.base || base, nodo.marks));
    else tr.setNodeMarkup(pos, undefined, { base: r.base || base, lectura: r.lectura.trim() });
    editor.view.dispatch(tr);
    editor.commands.focus();
  };

  const furigana = async () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return aviso('Selecciona primero el texto al que quieres poner furigana.', 'error');
    const base = editor.state.doc.textBetween(from, to);
    const r = await pedirDatos('Añadir furigana', [
      { nombre: 'lectura', etiqueta: `Lectura de «${base}»`, ayuda: 'Por ejemplo: かんじ para 漢字.' },
    ]);
    if (!r?.lectura.trim()) return;
    editor.chain().focus().deleteRange({ from, to }).insertarRuby(base, r.lectura.trim()).run();
  };

  const idioma = async () => {
    if (!editor) return;
    if (estado?.idioma) {
      editor.chain().focus().setIdioma(null).run();
      return;
    }
    if (editor.state.selection.empty) return aviso('Selecciona el texto en otro idioma.', 'error');
    const r = await pedirDatos('Texto en otro idioma', [
      { nombre: 'lang', etiqueta: 'Código de idioma', valor: 'ja', ayuda: 'ja = japonés, en = inglés, ko = coreano, zh = chino, fr = francés…' },
    ]);
    if (r?.lang.trim()) editor.chain().focus().setIdioma(r.lang.trim()).run();
  };

  const enlace = async () => {
    if (!editor) return;
    if (estado?.enlace) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    if (editor.state.selection.empty) return aviso('Selecciona el texto del enlace.', 'error');
    const r = await pedirDatos('Añadir enlace', [{ nombre: 'href', etiqueta: 'Dirección', valor: 'https://' }]);
    if (r?.href && /^(https?:|mailto:)/.test(r.href)) editor.chain().focus().setLink({ href: r.href }).run();
  };

  const nota = async () => {
    if (!editor) return;
    const r = await pedirDatos('Nueva nota al pie', [{ nombre: 'texto', etiqueta: 'Texto de la nota', tipo: 'area' }], 'Añadir nota');
    if (!r?.texto.trim()) return;
    const id = nuevoId('n');
    const nueva: Nota = { id, contenido: [{ tipo: 'texto', texto: r.texto.trim() }] };
    notasRef.current = [...notasRef.current, nueva];
    setNotas(notasRef.current);
    editor.chain().focus().insertarNota(id).run();
    guardar(editor, true);
  };

  const comentar = async () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return aviso('Selecciona primero el texto que quieres comentar.', 'error');
    const cita = editor.state.doc.textBetween(from, to, ' ');
    const r = await pedirDatos(
      'Nuevo comentario',
      [
        { nombre: 'texto', etiqueta: `Comentario sobre «${cita.length > 60 ? cita.slice(0, 60) + '…' : cita}»`, tipo: 'area' },
        { nombre: 'autor', etiqueta: 'Tu nombre', valor: nombreRevisor(), ayuda: 'Se recuerda para los siguientes comentarios.' },
      ],
      'Comentar',
    );
    if (!r?.texto.trim()) return;
    guardarRevisor(r.autor.trim());
    const id = nuevoId('c');
    editor.chain().focus().setTextSelection({ from, to }).setMark('comentario', { id }).run();
    guardar(editor, true);
    onComentar({ id, texto: r.texto.trim(), autor: r.autor.trim() || 'Anónimo', cita });
  };

  const imagen = async (archivo: File) => {
    if (!editor) return;
    try {
      const { recurso } = await api.subirImagen(archivo);
      const r = await pedirDatos('Descripción de la imagen', [
        { nombre: 'alt', etiqueta: 'Describe lo que se ve', tipo: 'area', ayuda: 'La leen los lectores de pantalla. Es obligatoria para la accesibilidad.' },
      ]);
      editor.chain().focus().insertarImagen({ recurso: recurso.id, alt: r?.alt.trim() ?? '' }).run();
      onEstado({ recargar: true });
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const cambiarImagen = (attrs: Record<string, unknown>) => {
    if (!editor || !estado?.imagen) return;
    const tr = editor.state.tr.setNodeMarkup(estado.imagen.pos, undefined, { ...estado.imagen, pos: undefined, ...attrs });
    editor.view.dispatch(tr);
  };

  const estiloSelect = (v: string) => {
    if (!editor) return;
    if (v === 'h2' || v === 'h3') editor.chain().focus().setHeading({ level: v === 'h2' ? 2 : 3 }).run();
    else editor.chain().focus().setParagraph().setEstilo(v).run();
  };

  const editarNota = (id: string, texto: string) => {
    const nuevas = notasRef.current.map((n) => {
      if (n.id !== id) return n;
      // Si el texto no cambió se conservan las marcas originales.
      if (textoPlano(n.contenido) === texto) return n;
      const contenido: Inline[] = [];
      texto.split('\n').forEach((l, k) => {
        if (k) contenido.push({ tipo: 'salto' });
        if (l) contenido.push({ tipo: 'texto', texto: l });
      });
      return { ...n, contenido };
    });
    notasRef.current = nuevas;
    setNotas(nuevas);
    if (editor) guardar(editor);
  };

  const ordenNotas = useMemo(() => {
    if (!editor) return notas;
    const orden = [...idsNotas(pmABloques(editor.getJSON() as any))];
    return [...notas].sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id));
  }, [notas, editor, estado]);

  if (!editor || !estado) return null;
  const B = (p: { activo?: boolean; titulo: string; onClick: () => void; children: React.ReactNode; atajo?: string }) => (
    <button
      type="button"
      className={p.activo ? 'activo' : ''}
      title={p.atajo ? `${p.titulo} (${p.atajo})` : p.titulo}
      aria-label={p.titulo}
      aria-pressed={p.activo}
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.onClick}
    >
      {p.children}
    </button>
  );
  const c = () => editor.chain().focus();

  return (
    <div className="editor">
      <div className="barra-editor" role="toolbar" aria-label="Formato">
        <select value={estado.estilo} onChange={(e) => estiloSelect(e.target.value)} aria-label="Estilo de párrafo" title="Estilo de párrafo (Ctrl+Alt+0…7)">
          {ESTILOS_PARRAFO.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
          <option value="h2">Subtítulo</option>
          <option value="h3">Subtítulo menor</option>
        </select>
        <span className="sep" />
        <B titulo="Negrita" atajo="Ctrl+B" activo={estado.negrita} onClick={() => c().toggleBold().run()}><b>N</b></B>
        <B titulo="Cursiva" atajo="Ctrl+I" activo={estado.cursiva} onClick={() => c().toggleItalic().run()}><i>C</i></B>
        <B titulo="Subrayado" atajo="Ctrl+U" activo={estado.subrayado} onClick={() => c().toggleUnderline().run()}><u>S</u></B>
        <B titulo="Tachado" activo={estado.tachado} onClick={() => c().toggleStrike().run()}><s>T</s></B>
        <B titulo="Versalitas" activo={estado.versalitas} onClick={() => c().toggleVersalitas().run()}><span style={{ fontVariant: 'small-caps' }}>Vs</span></B>
        <B titulo="Superíndice" activo={estado.sup} onClick={() => c().toggleSuperscript().run()}>x²</B>
        <B titulo="Subíndice" activo={estado.sub} onClick={() => c().toggleSubscript().run()}>x₂</B>
        <span className="sep" />
        <B titulo="Furigana" onClick={furigana}>ふ</B>
        <B titulo="Puntos de énfasis (傍点)" activo={estado.enfasis} onClick={() => c().toggleMark('enfasis').run()}>傍</B>
        <B titulo={estado.idioma ? `Quitar idioma (${estado.idioma})` : 'Texto en otro idioma'} activo={!!estado.idioma} onClick={idioma}>🌐</B>
        <B titulo={estado.enlace ? 'Quitar enlace' : 'Enlace'} activo={estado.enlace} onClick={enlace}>🔗</B>
        <B titulo="Nota al pie" onClick={nota}>✱</B>
        <B titulo="Comentar" onClick={comentar}>💬</B>
        <span className="sep" />
        <B titulo="Separador de escena" onClick={() => c().setHorizontalRule().run()}>⁂</B>
        <B titulo="Imagen" onClick={() => entradaImagen.current?.click()}>🖼</B>
        <B titulo="Lista" activo={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}>•≡</B>
        <span className="sep" />
        <B titulo="Deshacer" atajo="Ctrl+Z" onClick={() => c().undo().run()}>↶</B>
        <B titulo="Rehacer" atajo="Ctrl+Y" onClick={() => c().redo().run()}>↷</B>
        <input
          ref={entradaImagen}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void imagen(f);
            e.target.value = '';
          }}
        />
      </div>

      {estado.imagen && (
        <div className="panel-imagen-editor">
          <label className="campo">
            <span>Descripción de la imagen</span>
            <textarea
              rows={2}
              value={String(estado.imagen.alt ?? '')}
              disabled={!!estado.imagen.decorativa}
              onChange={(e) => cambiarImagen({ alt: e.target.value })}
            />
          </label>
          <label className="campo">
            <span>Pie de imagen (opcional)</span>
            <input value={String(estado.imagen.pie ?? '')} onChange={(e) => cambiarImagen({ pie: e.target.value })} />
          </label>
          <label className="casilla">
            <input type="checkbox" checked={!!estado.imagen.decorativa} onChange={(e) => cambiarImagen({ decorativa: e.target.checked })} />
            Imagen decorativa (no transmite información)
          </label>
        </div>
      )}

      <div className={vertical ? 'hoja hoja-vertical' : 'hoja'}>
        <div className="pagina-marco">
          {seccion.mostrarTitulo && seccion.titulo && (
            <h1 className="titulo-pagina" title="El título se cambia en el inspector (pestaña Sección)">
              {seccion.titulo}
            </h1>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>

      {ordenNotas.length > 0 && (
        <section className="notas-editor" aria-label="Notas al pie de esta sección">
          <h3>Notas al pie</h3>
          {ordenNotas.map((n, k) => (
            <label key={n.id} className="nota-editor">
              <span className="numero-nota">{k + 1}</span>
              <textarea rows={2} value={textoPlano(n.contenido)} onChange={(e) => editarNota(n.id, e.target.value)} aria-label={`Texto de la nota ${k + 1}`} />
            </label>
          ))}
          <p className="ayuda">Para borrar una nota, borra su ✱ en el texto.</p>
        </section>
      )}
    </div>
  );
}
