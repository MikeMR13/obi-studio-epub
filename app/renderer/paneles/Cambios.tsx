import { diferenciaPalabras, textoBloques } from '../../../src/diferencias';
import type { CambioPropuesto, Seccion } from '../../../src/model';
import { api, type Estado } from '../api';
import { aviso, confirmar } from '../dialogos';
import { locale, t } from '../i18n';

interface Props {
  estado: Estado;
  seccion?: Seccion;
  onEstado: (e: Estado) => void;
  onIrA: (id: string) => void;
}

const fecha = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
};

function Diferencia({ c }: { c: CambioPropuesto }) {
  if (c.titulo)
    return (
      <p className="diferencia">
        {t('Título:')} <del>{c.titulo.antes || '(sin título)'}</del> <ins>{c.titulo.despues || t('(sin título)')}</ins>
      </p>
    );
  const notas = (c.notas ?? []).map((n) => n.contenido.map((i) => (i.tipo === 'texto' ? i.texto : '')).join('')).join(' / ');
  return (
    <>
      <p className="diferencia">
        {diferenciaPalabras(textoBloques(c.antes), textoBloques(c.despues)).map((t, k) =>
          t.tipo === 'igual' ? <span key={k}>{t.texto}</span> : t.tipo === 'borrado' ? <del key={k}>{t.texto}</del> : <ins key={k}>{t.texto}</ins>,
        )}
      </p>
      {notas && <p className="ayuda">{t('Nota: {0}', { 0: notas })}</p>}
    </>
  );
}

/** Cambios propuestos (control de cambios) de la sección, para aceptar o rechazar. */
export function Cambios({ estado, seccion, onEstado, onIrA }: Props) {
  const lista = seccion?.cambios ?? [];
  const otras = estado.libro.secciones.filter((s) => s.id !== seccion?.id && s.cambios?.length);

  const intentar = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const todos = (aceptar: boolean) =>
    intentar(async () => {
      if (!seccion) return;
      if (!aceptar && !(await confirmar(t('Rechazar todos'), t('¿Rechazar los {0} cambios de esta sección?', { 0: lista.length }), t('Rechazar todos'), true))) return;
      const r = await api.resolverTodos(aceptar, seccion.id);
      onEstado(r.estado);
      if (r.fallos.length) aviso(r.fallos.join(' '), 'error');
    });

  if (!lista.length && !otras.length) return null;
  return (
    <section className="panel-cambios" aria-label={t('Cambios propuestos')}>
      <h3>{t('Cambios propuestos')}{lista.length ? ` (${lista.length})` : ''}</h3>
      {lista.length > 0 && (
        <div className="fila-botones">
          <button onClick={() => todos(true)}>{t('Aceptar todos')}</button>
          <button onClick={() => todos(false)}>{t('Rechazar todos')}</button>
        </div>
      )}
      <ul className="lista-comentarios">
        {lista.map((c) => (
          <li key={c.id} className="cambio">
            <div className="cabecera-comentario">
              <strong>{c.autor}</strong>
              <span>{fecha(c.fecha)}</span>
            </div>
            <Diferencia c={c} />
            <div className="acciones-comentario">
              <button className="principal" onClick={() => intentar(async () => onEstado(await api.resolverCambio(seccion!.id, c.id, true)))}>{t('Aceptar')}</button>
              <button onClick={() => intentar(async () => onEstado(await api.resolverCambio(seccion!.id, c.id, false)))}>{t('Rechazar')}</button>
              {c.antes.length > 0 && (
                <button
                  className="enlace"
                  onClick={() => window.dispatchEvent(new CustomEvent('obi:seleccionar', { detail: { bloque: c.posicion, texto: textoBloques(c.antes.slice(0, 1)).slice(0, 40) } }))}
                >
                  {t('Ver en el texto')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {otras.length > 0 && (
        <p className="ayuda">
          {t('También hay cambios en:')}{' '}
          {otras.map((s, k) => (
            <span key={s.id}>
              {k > 0 && ', '}
              <button className="enlace" onClick={() => onIrA(s.id)}>
                {s.titulo || t('sección sin título')} ({s.cambios!.length})
              </button>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
