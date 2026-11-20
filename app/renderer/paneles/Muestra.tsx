import { useEffect, useMemo, useState } from 'react';
import { TIPOS_SECCION } from '../../../src/model';
import { descargar, ErrorApi, type Estado } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  onCerrar: () => void;
  onErrores: (datos: unknown) => void;
}

/** Lo anterior al primer capítulo (sin índice) y el primer capítulo. */
function predeterminadas(estado: Estado): string[] {
  const ids: string[] = [];
  for (const s of estado.libro.secciones) {
    if (s.tipo === 'indice') continue;
    ids.push(s.id);
    if (s.tipo === 'capitulo') break;
  }
  return ids;
}

const clave = (estado: Estado) => `obi.muestra.${estado.libro.metadatos.identificador}`;

function leerGuardado(estado: Estado): { secciones?: string[]; enlace?: string } {
  try {
    return JSON.parse(localStorage.getItem(clave(estado)) ?? '{}');
  } catch {
    return {};
  }
}

/** Muestra gratuita: EPUB con las primeras secciones y página web de una sola pieza. */
export function Muestra({ estado, onCerrar, onErrores }: Props) {
  const guardado = useMemo(() => leerGuardado(estado), [estado.libro.metadatos.identificador]);
  const existentes = new Set(estado.libro.secciones.map((s) => s.id));
  const [elegidas, setElegidas] = useState<Set<string>>(
    () => new Set((guardado.secciones?.filter((x) => existentes.has(x)).length ? guardado.secciones : predeterminadas(estado))!.filter((x) => existentes.has(x))),
  );
  const [enlace, setEnlace] = useState(guardado.enlace ?? '');
  const [ocupado, setOcupado] = useState('');

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const ids = estado.libro.secciones.filter((s) => elegidas.has(s.id)).map((s) => s.id);
  useEffect(() => {
    try {
      localStorage.setItem(clave(estado), JSON.stringify({ secciones: ids, enlace }));
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, [ids.join(','), enlace]);

  const enlaceMalo = !!enlace.trim() && !/^https?:\/\/\S+$/i.test(enlace.trim());
  const conTexto = estado.libro.secciones.some((s) => elegidas.has(s.id) && s.tipo !== 'portada');
  const consulta = `secciones=${encodeURIComponent(ids.join(','))}&enlace=${encodeURIComponent(enlace.trim())}`;

  const bajar = async (tipo: 'epub' | 'web') => {
    setOcupado(tipo === 'epub' ? t('Creando el EPUB de muestra…') : t('Creando la página web…'));
    try {
      await descargar(`/api/muestra/${tipo}?${consulta}`);
      aviso(tipo === 'epub' ? t('EPUB de muestra exportado y validado.') : t('Página web de la muestra exportada.'));
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 409) onErrores(e.datos);
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const cambiar = (id: string) =>
    setElegidas((a) => {
      const n = new Set(a);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins panel-muestra" role="dialog" aria-modal="true" aria-labelledby="titulo-muestra">
        <div className="cabecera-plugins">
          <h2 id="titulo-muestra">{t('Muestra gratuita')}</h2>
          <button className="cerrar" onClick={onCerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <p className="ayuda">
          {t('Elige las secciones de la muestra. El EPUB añade una página final con el enlace de compra y lleva su propio identificador; la página web es un único archivo con la portada, la sinopsis y los capítulos.')}
        </p>
        <fieldset className="secciones-muestra">
          <legend>{t('Secciones')}</legend>
          {estado.libro.secciones.map((s) => {
            const tipo = TIPOS_SECCION.find((x) => x.id === s.tipo)?.nombre ?? s.tipo;
            return (
              <label key={s.id}>
                <input type="checkbox" checked={elegidas.has(s.id)} onChange={() => cambiar(s.id)} />
                <span>{s.titulo || t(tipo)}</span>
                <small>{t(tipo)}</small>
              </label>
            );
          })}
        </fieldset>
        <label className="campo">
          <span>{t('Enlace de compra')}</span>
          <input type="url" value={enlace} placeholder="https://" onChange={(e) => setEnlace(e.target.value)} aria-invalid={enlaceMalo} />
          {enlaceMalo && <small className="error-campo">{t('Escribe una dirección que empiece por http:// o https://')}</small>}
        </label>
        {ocupado && <p className="ayuda" role="status">{ocupado}</p>}
        <div className="botones-dialogo">
          <button disabled={!conTexto || enlaceMalo || !!ocupado} onClick={() => bajar('web')}>{t('Exportar página web')}</button>
          <button className="principal" disabled={!conTexto || enlaceMalo || !!ocupado} onClick={() => bajar('epub')}>{t('Exportar EPUB de muestra')}</button>
        </div>
        {!conTexto && <p className="ayuda">{t('Elige al menos una sección con texto.')}</p>}
      </div>
    </div>
  );
}
