// Página de invitados de la colaboración en tiempo real. La sirve el servidor de colaboración del anfitrión;
// no tiene acceso a la API de Obi Studio: solo al texto de las secciones (salas Yjs) y a la lista de secciones.

import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ESTILOS_PARRAFO, type Inline } from '../../src/model';
import { extensiones } from './editor/extensiones';
import { idiomaInterfaz, t } from './i18n';

const LETRAS = idiomaInterfaz() === 'en' ? { negrita: 'B', cursiva: 'I' } : { negrita: 'N', cursiva: 'C' };
import './estilos.css';

const COLORES = ['#3b6fb6', '#2f8a5b', '#a35bb5', '#c77d1a', '#1f8a8a', '#b5345f'];
const codigo = new URLSearchParams(location.search).get('c') ?? '';

interface Libro {
  titulo: string;
  secciones: { id: string; titulo: string; tipo: string; editable: boolean }[];
}

function nombreGuardado(): string {
  try {
    return localStorage.getItem('obi.revisor') ?? '';
  } catch {
    return '';
  }
}

type SalaInvitado = { doc: Y.Doc; proveedor: WebsocketProvider; notas: Y.Map<string> };

/** Abre la sala de la sección (en un efecto, para que el modo estricto de React no la deje cerrada). */
function EditorInvitado(props: { seccion: string; nombre: string; color: string; onPersonas: (p: { nombre: string; color: string }[]) => void }) {
  const [sala, setSala] = useState<SalaInvitado>();
  useEffect(() => {
    const doc = new Y.Doc();
    const proveedor = new WebsocketProvider(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`, props.seccion, doc, { params: { c: codigo } });
    proveedor.awareness.setLocalStateField('user', { name: props.nombre, color: props.color });
    setSala({ doc, proveedor, notas: doc.getMap<string>('notas') });
    return () => {
      proveedor.destroy();
      doc.destroy();
      setSala(undefined);
    };
  }, [props.seccion, props.nombre, props.color]);
  return sala ? <EditorSala key={sala.doc.guid} sala={sala} {...props} /> : null;
}

function EditorSala({ sala, nombre, color, onPersonas }: { sala: SalaInvitado; seccion: string; nombre: string; color: string; onPersonas: (p: { nombre: string; color: string }[]) => void }) {
  const [conectado, setConectado] = useState(sala.proveedor.wsconnected);
  const [notas, setNotas] = useState<[string, string][]>([]);

  useEffect(() => {
    const estado = ({ status }: { status: string }) => setConectado(status === 'connected');
    const personas = () =>
      onPersonas(
        [...sala.proveedor.awareness.getStates().values()]
          .map((e) => (e as { user?: { name: string; color: string } }).user)
          .filter((u): u is { name: string; color: string } => !!u)
          .map((u) => ({ nombre: u.name, color: u.color })),
      );
    const leerNotas = () =>
      setNotas(
        [...sala.notas.entries()].map(([id, v]) => {
          try {
            return [id, (JSON.parse(v) as Inline[]).map((i) => (i.tipo === 'texto' ? i.texto : i.tipo === 'salto' ? '\n' : '')).join('')];
          } catch {
            return [id, ''];
          }
        }),
      );
    sala.proveedor.on('status', estado);
    sala.proveedor.awareness.on('change', personas);
    sala.notas.observe(leerNotas);
    setConectado(sala.proveedor.wsconnected);
    leerNotas();
    personas();
    return () => {
      sala.proveedor.off('status', estado);
      sala.proveedor.awareness.off('change', personas);
      sala.notas.unobserve(leerNotas);
    };
  }, [sala, onPersonas]);

  const editor = useEditor({
    extensions: [
      ...extensiones({ colaborativo: true }),
      Collaboration.configure({ document: sala.doc, field: 'contenido' }),
      CollaborationCaret.configure({ provider: sala.proveedor, user: { name: nombre, color } }),
    ],
    editorProps: { attributes: { class: 'pagina-editor', spellcheck: 'true', 'aria-label': t('Texto de la sección') } },
  });
  const estado = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      negrita: !!e?.isActive('bold'),
      cursiva: !!e?.isActive('italic'),
      estilo: (e?.getAttributes('paragraph').estilo as string) ?? 'cuerpo',
    }),
  });

  const editarNota = (id: string, texto: string) => {
    const contenido: Inline[] = [];
    texto.split('\n').forEach((l, k) => {
      if (k) contenido.push({ tipo: 'salto' });
      if (l) contenido.push({ tipo: 'texto', texto: l });
    });
    sala.notas.set(id, JSON.stringify(contenido));
  };

  if (!editor) return null;
  const c = () => editor.chain().focus();
  return (
    <div className="editor">
      <div className="barra-editor" role="toolbar" aria-label={t('Formato')}>
        <select value={estado?.estilo} onChange={(e) => c().setParagraph().setEstilo(e.target.value).run()} aria-label={t('Estilo de párrafo')}>
          {ESTILOS_PARRAFO.map((x) => (
            <option key={x.id} value={x.id}>{t(x.nombre)}</option>
          ))}
        </select>
        <button className={estado?.negrita ? 'activo' : ''} title={t('Negrita')} aria-label={t('Negrita')} onClick={() => c().toggleBold().run()}><b>{LETRAS.negrita}</b></button>
        <button className={estado?.cursiva ? 'activo' : ''} title={t('Cursiva')} aria-label={t('Cursiva')} onClick={() => c().toggleItalic().run()}><i>{LETRAS.cursiva}</i></button>
        <span className={`estado-conexion ${conectado ? 'ok' : ''}`}>{conectado ? t('Conectado') : t('Conectando…')}</span>
      </div>
      <div className="hoja">
        <div className="pagina-marco">
          <EditorContent editor={editor} />
        </div>
      </div>
      {notas.length > 0 && (
        <section className="notas-editor" aria-label={t('Notas al pie de esta sección')}>
          <h3>{t('Notas al pie')}</h3>
          {notas.map(([id, texto], k) => (
            <div key={id} className="nota-editor">
              <span className="numero-nota">{k + 1}</span>
              <textarea rows={2} defaultValue={texto} onBlur={(e) => editarNota(id, e.target.value)} aria-label={t('Texto de la nota {0}', { 0: k + 1 })} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Invitado() {
  const [libro, setLibro] = useState<Libro>();
  const [error, setError] = useState('');
  const [nombre, setNombre] = useState(nombreGuardado());
  const [listo, setListo] = useState(false);
  const [actual, setActual] = useState('');
  const [personas, setPersonas] = useState<{ nombre: string; color: string }[]>([]);
  const color = useMemo(() => COLORES[Math.floor(Math.random() * COLORES.length)], []);

  useEffect(() => {
    fetch(`/estado?c=${encodeURIComponent(codigo)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(t('El enlace de invitación no es válido o la colaboración terminó.'));
        const d = (await r.json()) as Libro;
        setLibro(d);
        setActual(d.secciones.find((s) => s.editable)?.id ?? '');
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="cargando">{error}</div>;
  if (!libro) return <div className="cargando">{t('Cargando Obi Studio…')}</div>;
  if (!listo)
    return (
      <div className="inicio">
        <form
          className="inicio-caja"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nombre.trim()) return;
            try {
              localStorage.setItem('obi.revisor', nombre.trim());
            } catch {
              // Se pedirá de nuevo la próxima vez.
            }
            setListo(true);
          }}
        >
          <h1>{libro.titulo}</h1>
          <p>{t('Te invitaron a escribir en este libro con Obi Studio.')}</p>
          <label className="campo">
            <span>{t('Tu nombre')}</span>
            <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <small>{t('Los demás lo verán junto a tu cursor.')}</small>
          </label>
          <button className="principal" type="submit" disabled={!nombre.trim()}>{t('Entrar')}</button>
        </form>
      </div>
    );
  return (
    <div className="app app-invitado">
      <header className="cabecera">
        <span className="marca">Obi Studio</span>
        <strong className="nombre-libro">{libro.titulo}</strong>
        <ul className="personas personas-cabecera" aria-label={t('Personas en esta sección')}>
          {personas.map((p, k) => (
            <li key={k} title={p.nombre}>
              <span className="punto-persona" style={{ background: p.color }} /> {p.nombre}
            </li>
          ))}
        </ul>
      </header>
      <aside className="estructura">
        <h2>{t('Estructura')}</h2>
        <ul className="lista-secciones">
          {libro.secciones
            .filter((s) => s.editable)
            .map((s) => (
              <li key={s.id} className={s.id === actual ? 'actual' : ''}>
                <button onClick={() => setActual(s.id)}>{s.titulo || t('sección sin título')}</button>
              </li>
            ))}
        </ul>
      </aside>
      <main className="centro">{actual && <EditorInvitado key={actual} seccion={actual} nombre={nombre.trim()} color={color} onPersonas={setPersonas} />}</main>
    </div>
  );
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Invitado />
  </StrictMode>,
);
