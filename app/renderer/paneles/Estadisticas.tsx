import { useEffect, useMemo } from 'react';
import { AVANCES, TIPOS_SECCION, estadisticasLibro, type Avance, type Seccion } from '../../../src/model';
import type { Estado } from '../api';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  onCerrar: () => void;
  onSeccion: (id: string, cambios: Partial<Seccion>) => void;
  onIrA: (id: string) => void;
}

const num = (n: number) => Math.round(n).toLocaleString();

function duracion(minutos: number): string {
  if (minutos < 1) return t('menos de 1 min');
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return h ? t('{0} h {1} min', { 0: h, 1: m }) : t('{0} min', { 0: m });
}

/** Estadísticas del libro y avance del trabajo por sección. */
export function Estadisticas({ estado, onCerrar, onSeccion, onIrA }: Props) {
  const e = useMemo(() => estadisticasLibro(estado.libro), [estado.libro]);
  useEffect(() => {
    const tecla = (x: KeyboardEvent) => x.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);
  const unidades = e.palabras + e.cjk;
  const maximo = Math.max(1, ...e.secciones.map((s) => s.palabras + s.cjk));
  const pct = (n: number) => (unidades ? Math.round((n / unidades) * 100) : 0);
  const conTexto = e.secciones.filter((s) => s.palabras + s.cjk > 0);

  return (
    <div className="fondo-dialogo" onMouseDown={(x) => x.target === x.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins panel-estadisticas" role="dialog" aria-modal="true" aria-labelledby="titulo-estadisticas">
        <div className="cabecera-plugins">
          <h2 id="titulo-estadisticas">{t('Estadísticas del libro')}</h2>
          <button className="cerrar" onClick={onCerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <dl className="cifras-libro">
          <div>
            <dt>{t('Palabras')}</dt>
            <dd>{num(e.palabras)}</dd>
          </div>
          {e.cjk > 0 && (
            <div>
              <dt>{t('Caracteres japoneses o chinos')}</dt>
              <dd>{num(e.cjk)}</dd>
            </div>
          )}
          <div>
            <dt>{t('Caracteres sin espacios')}</dt>
            <dd>{num(e.caracteres)}</dd>
          </div>
          <div>
            <dt>{t('Tiempo de lectura')}</dt>
            <dd>{duracion(e.minutos)}</dd>
          </div>
          <div>
            <dt>{t('Párrafos')}</dt>
            <dd>{num(e.parrafos)}</dd>
          </div>
          <div>
            <dt>{t('Diálogo')}</dt>
            <dd>{e.parrafos ? `${Math.round((e.dialogos / e.parrafos) * 100)} %` : '—'}</dd>
          </div>
          <div>
            <dt>{t('Notas')}</dt>
            <dd>{num(e.notas)}</dd>
          </div>
          <div>
            <dt>{t('Imágenes')}</dt>
            <dd>{num(e.imagenes)}</dd>
          </div>
        </dl>
        <div className="avance-libro" aria-label={t('Avance del libro')}>
          <div className="barra-avance">
            {(['listo', 'revision', 'borrador'] as const).map((a) => (e.porAvance[a] ? <span key={a} className={`a-${a}`} style={{ width: `${pct(e.porAvance[a])}%` }} /> : null))}
          </div>
          <small>
            {t('Listo: {0} % · En revisión: {1} % · Borrador: {2} % · Sin marcar: {3} %', { 0: pct(e.porAvance.listo), 1: pct(e.porAvance.revision), 2: pct(e.porAvance.borrador), 3: pct(e.porAvance.sin) })}
          </small>
        </div>
        <table className="tabla-estadisticas">
          <thead>
            <tr>
              <th scope="col">{t('Sección')}</th>
              <th scope="col">{t('Palabras')}</th>
              <th scope="col">{t('Lectura')}</th>
              <th scope="col">{t('Avance')}</th>
            </tr>
          </thead>
          <tbody>
            {conTexto.map((s) => (
              <tr key={s.id}>
                <th scope="row">
                  <button className="enlace" onClick={() => onIrA(s.id)}>{s.titulo || t(TIPOS_SECCION.find((x) => x.id === s.tipo)?.nombre ?? '')}</button>
                  <span className="barra-seccion" style={{ width: `${((s.palabras + s.cjk) / maximo) * 100}%` }} />
                </th>
                <td>{num(s.palabras + s.cjk)}</td>
                <td>{duracion(s.minutos)}</td>
                <td>
                  <select
                    aria-label={t('Avance de «{0}»', { 0: s.titulo || '—' })}
                    value={s.avance ?? ''}
                    onChange={(x) => onSeccion(s.id, { avance: (x.target.value || null) as unknown as Avance })}
                  >
                    <option value="">{t('Sin marcar')}</option>
                    {AVANCES.map((a) => (
                      <option key={a.id} value={a.id}>{t(a.nombre)}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ayuda">{t('Tiempo de lectura con 230 palabras por minuto (500 caracteres por minuto en japonés o chino). El avance solo se guarda en el proyecto.')}</p>
      </div>
    </div>
  );
}
