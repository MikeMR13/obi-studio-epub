import { useEffect, useMemo, useRef, useState } from 'react';
import type { PermisoFuente } from '../../../src/fuentes-propias';
import { api, type Estado, type FamiliaSistemaPublica } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  onCerrar: () => void;
  onEstado: (e: Estado) => void;
}

const LICENCIA: Record<PermisoFuente['tipo'], string> = {
  instalable: 'Se puede incrustar',
  edicion: 'Se puede incrustar (edición)',
  vista: 'Se puede incrustar (vista e impresión)',
  restringida: 'La licencia no permite incrustarla',
  'mapa-de-bits': 'Solo como mapa de bits',
};

function permisoFamilia(caras: { permiso: PermisoFuente }[]): PermisoFuente['tipo'] {
  return caras.find((c) => c.permiso.incrustable)?.permiso.tipo ?? caras[0]?.permiso.tipo ?? 'restringida';
}

const nombreCara = (peso: number, estilo: string) => `${peso}${estilo === 'italic' ? ' ' + t('cursiva') : ''}`;

/** Fuentes propias: subir un .ttf/.otf o elegir una instalada en el sistema. */
export function FuentesPropias({ estado, onCerrar, onEstado }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [sistema, setSistema] = useState<FamiliaSistemaPublica[]>();
  const [filtro, setFiltro] = useState('');
  const [ocupado, setOcupado] = useState('');
  const propias = estado.libro.fuentesPropias ?? [];

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  useEffect(() => {
    api.fuentesSistema().then(setSistema).catch(() => setSistema([]));
  }, []);

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return (sistema ?? []).filter((x) => !f || x.familia.toLowerCase().includes(f)).slice(0, 200);
  }, [sistema, filtro]);

  const anadida = (familia: string, e: Estado) => {
    onEstado(e);
    aviso(t('Fuente «{0}» añadida. Elígela en «Letra del texto» o «Letra de los títulos».', { 0: familia }));
  };

  const subir = async (archivos: FileList) => {
    setOcupado(t('Leyendo la fuente…'));
    try {
      let ultimo;
      for (const a of Array.from(archivos)) ultimo = await api.anadirFuente(a);
      if (ultimo) anadida(ultimo.familia, ultimo.estado);
    } catch (e) {
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const desdeSistema = async (familia: string) => {
    setOcupado(t('Añadiendo «{0}»…', { 0: familia }));
    try {
      const r = await api.anadirFuenteSistema(familia);
      anadida(r.familia, r.estado);
    } catch (e) {
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const quitar = async (id: string) => {
    try {
      onEstado(await api.quitarFuente(id));
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins panel-fuentes" role="dialog" aria-modal="true" aria-labelledby="titulo-fuentes">
        <div className="cabecera-plugins">
          <h2 id="titulo-fuentes">{t('Fuentes propias')}</h2>
          <button className="cerrar" onClick={onCerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <p className="ayuda">
          {t('Se incrusta solo el subconjunto de letras que usa el libro. Obi Studio respeta la licencia de incrustación de la fuente, pero comprueba que también permita libros electrónicos: muchas fuentes comerciales piden una licencia aparte.')}
        </p>

        {propias.length > 0 && (
          <ul className="lista-plugins lista-fuentes" aria-label={t('Fuentes del libro')}>
            {propias.map((f) => (
              <li key={f.id}>
                <div>
                  <strong>{f.familia}</strong>
                  <small>{f.caras.map((c) => nombreCara(c.peso, c.estilo)).join(' · ')}</small>
                </div>
                <button onClick={() => quitar(f.id)}>{t('Quitar')}</button>
              </li>
            ))}
          </ul>
        )}

        <div className="botones-dialogo izquierda">
          <button className="principal" disabled={!!ocupado} onClick={() => entrada.current?.click()}>{t('Subir .ttf u .otf…')}</button>
          <input
            ref={entrada}
            type="file"
            hidden
            multiple
            accept=".ttf,.otf,font/ttf,font/otf"
            onChange={(e) => {
              if (e.target.files?.length) void subir(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <h3>{t('Instaladas en este equipo')}</h3>
        <input type="search" className="buscar-fuente" placeholder={t('Buscar fuente…')} aria-label={t('Buscar fuente')} value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        {!sistema ? (
          <p className="ayuda" role="status">{t('Buscando fuentes instaladas…')}</p>
        ) : !sistema.length ? (
          <p className="ayuda">{t('No se encontraron fuentes .ttf u .otf instaladas.')}</p>
        ) : (
          <ul className="lista-fuentes-sistema">
            {visibles.map((f) => {
              const tipo = permisoFamilia(f.caras);
              const puede = f.caras.some((c) => c.permiso.incrustable);
              const ya = propias.some((p) => p.familia === f.familia);
              return (
                <li key={f.familia}>
                  <div>
                    <strong>{f.familia}</strong>
                    <small className={puede ? '' : 'error'}>
                      {t('{0} estilos', { 0: f.caras.length })} · {t(LICENCIA[tipo])}
                    </small>
                  </div>
                  <button disabled={!puede || ya || !!ocupado} onClick={() => desdeSistema(f.familia)}>{ya ? t('Añadida') : t('Añadir')}</button>
                </li>
              );
            })}
          </ul>
        )}
        {ocupado && <p className="ayuda" role="status">{ocupado}</p>}
      </div>
    </div>
  );
}
