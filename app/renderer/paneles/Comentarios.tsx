import { useState } from 'react';
import type { Bloque, Comentario, Inline, Seccion } from '../../../src/model';
import { confirmar, pedirDatos } from '../dialogos';
import { locale, t } from '../i18n';

interface Props {
  seccion?: Seccion;
  onSeccion: (cambios: Partial<Seccion>) => void;
}

/** Texto anclado a cada comentario en los bloques de la sección. */
export function textosComentados(bloques: Bloque[]): Map<string, string> {
  const m = new Map<string, string>();
  const ver = (l: Inline[]) => {
    for (const i of l) if (i.tipo === 'texto') for (const id of i.comentarios ?? []) m.set(id, (m.get(id) ?? '') + i.texto);
  };
  for (const b of bloques) {
    if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') ver(b.contenido);
    if (b.tipo === 'lista') b.elementos.forEach(ver);
    if (b.tipo === 'tabla') b.filas.forEach((f) => f.forEach((c) => ver(c.contenido)));
    if (b.tipo === 'recuadro') b.lineas.forEach((l) => ver(l.contenido));
  }
  return m;
}

export function nombreRevisor(): string {
  try {
    return localStorage.getItem('obi.revisor') ?? '';
  } catch {
    return '';
  }
}

export function guardarRevisor(nombre: string) {
  try {
    localStorage.setItem('obi.revisor', nombre);
  } catch {
    // Sin almacenamiento: se vuelve a preguntar.
  }
}

const fecha = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
};

export function Comentarios({ seccion, onSeccion }: Props) {
  const [verResueltos, setVerResueltos] = useState(false);
  if (!seccion) return <p className="ayuda">{t('Elige una sección.')}</p>;
  const lista = seccion.comentarios ?? [];
  const anclas = textosComentados(seccion.bloques);
  const visibles = lista.filter((c) => verResueltos || !c.resuelto);
  const resueltos = lista.filter((c) => c.resuelto).length;

  const cambiar = (id: string, f: (c: Comentario) => Comentario | null) => {
    const nuevos = lista.map((c) => (c.id === id ? f(c) : c)).filter((c): c is Comentario => c !== null);
    onSeccion({ comentarios: nuevos });
  };

  const responder = async (c: Comentario) => {
    const r = await pedirDatos(t('Responder'), [
      { nombre: 'texto', etiqueta: t('Respuesta'), tipo: 'area' },
      { nombre: 'autor', etiqueta: t('Tu nombre'), valor: nombreRevisor() },
    ], t('Responder'));
    if (!r?.texto.trim()) return;
    guardarRevisor(r.autor.trim());
    cambiar(c.id, (x) => ({ ...x, respuestas: [...(x.respuestas ?? []), { autor: r.autor.trim() || t('Anónimo'), fecha: new Date().toISOString(), texto: r.texto.trim() }] }));
  };

  const borrar = async (c: Comentario) => {
    if (!(await confirmar(t('Borrar comentario'), t('¿Borrar el comentario de {0} y sus respuestas?', { 0: c.autor }), t('Borrar'), true))) return;
    window.dispatchEvent(new CustomEvent('obi:quitar-comentario', { detail: { id: c.id } }));
    cambiar(c.id, () => null);
  };

  return (
    <div className="panel-comentarios">
      <h3>{t('Comentarios')}</h3>
      <p className="ayuda">
        {t('Los comentarios no salen en el EPUB ni en el PDF. Viajan en el Word para corrección y vuelven con «Importar correcciones». Para comentar, selecciona texto y pulsa 💬 en la barra del editor.')}
      </p>
      {resueltos > 0 && (
        <label className="casilla">
          <input type="checkbox" checked={verResueltos} onChange={(e) => setVerResueltos(e.target.checked)} />
          Mostrar resueltos ({resueltos})
        </label>
      )}
      {!visibles.length && <p className="vacio">{lista.length ? t('Todos los comentarios están resueltos.') : t('Esta sección no tiene comentarios.')}</p>}
      <ul className="lista-comentarios">
        {visibles.map((c) => {
          const ancla = anclas.get(c.id);
          return (
            <li key={c.id} className={c.resuelto ? 'resuelto' : ''}>
              <div className="cabecera-comentario">
                <strong>{c.autor}</strong>
                <span>{fecha(c.fecha)}</span>
              </div>
              {ancla !== undefined ? (
                <button
                  className="cita-comentario"
                  title={t('Ir al texto comentado')}
                  onClick={() => window.dispatchEvent(new CustomEvent('obi:ir-comentario', { detail: { id: c.id } }))}
                >
                  «{ancla.length > 80 ? ancla.slice(0, 80) + '…' : ancla}»
                </button>
              ) : (
                <p className="cita-comentario perdida">{c.cita ? `«${c.cita}» (` : '('}el texto comentado ya no está)</p>
              )}
              <p className="texto-comentario">{c.texto}</p>
              {(c.respuestas ?? []).map((r, k) => (
                <div key={k} className="respuesta">
                  <strong>{r.autor}</strong> <span>{fecha(r.fecha)}</span>
                  <p>{r.texto}</p>
                </div>
              ))}
              <div className="acciones-comentario">
                <button onClick={() => void responder(c)}>{t('Responder')}</button>
                <button onClick={() => cambiar(c.id, (x) => ({ ...x, resuelto: !x.resuelto || undefined }))}>{c.resuelto ? t('Reabrir') : t('Resolver')}</button>
                <button className="peligro-texto" onClick={() => void borrar(c)}>{t('Borrar')}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
