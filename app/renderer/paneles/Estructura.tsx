import { useState } from 'react';
import type { Seccion } from '../../../src/model';
import { TIPOS_SECCION } from '../../../src/model';
import type { Estado } from '../api';
import { urlRecurso } from '../api';
import { locale, t } from '../i18n';

interface Props {
  estado: Estado;
  actual: string;
  avisosPorSeccion: Record<string, number>;
  onElegir: (id: string) => void;
  onOrdenar: (ids: string[]) => void;
  onAnadir: (tipo: string) => void;
  onEliminar: (s: Seccion) => void;
  onIndice: () => void;
  version: number;
}

const ICONO: Record<string, string> = {
  portada: '▣', ilustracion: '🖼', creditos: '©', indice: '☰', dedicatoria: '♡', prologo: '◇', capitulo: '§',
  interludio: '◈', epilogo: '◆', posfacio: '✎', apendice: '+', otro: '·',
};

export function Estructura({ estado, actual, avisosPorSeccion, onElegir, onOrdenar, onAnadir, onEliminar, onIndice, version }: Props) {
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const { libro } = estado;

  const miniatura = (s: Seccion) => {
    if (s.tipo === 'portada' && libro.metadatos.portada) return libro.metadatos.portada;
    const img = s.bloques.find((b) => b.tipo === 'imagen');
    return img && img.tipo === 'imagen' && (s.tipo === 'ilustracion' || s.tipo === 'portada') ? img.recurso : undefined;
  };

  const soltar = (destino: string) => {
    if (!arrastrando || arrastrando === destino) return;
    const ids = libro.secciones.map((s) => s.id).filter((i) => i !== arrastrando);
    ids.splice(ids.indexOf(destino), 0, arrastrando);
    onOrdenar(ids);
  };

  const mover = (id: string, delta: number) => {
    const ids = libro.secciones.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onOrdenar(ids);
  };

  return (
    <nav className="estructura" aria-label={t('Estructura del libro')}>
      <div className="cabecera-panel">
        <h2>{t('Estructura')}</h2>
        <button className="pequeno boton-indice" onClick={onIndice} title={t('Tabla de contenido: qué sale en el índice y cómo')} aria-label={t('Tabla de contenido')}>☰</button>
        <div className="menu-anadir">
          <button className="principal pequeno" onClick={() => setMenu(!menu)} aria-expanded={menu}>
            {t('+ Sección')}
          </button>
          {menu && (
            <ul className="desplegable" role="menu">
              {TIPOS_SECCION.map((x) => (
                <li key={x.id}>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      onAnadir(x.id);
                    }}
                  >
                    {ICONO[x.id]} {t(x.nombre)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ol className="lista-secciones">
        {libro.secciones.map((s, k) => {
          const mini = miniatura(s);
          const nombreTipo = t(TIPOS_SECCION.find((x) => x.id === s.tipo)?.nombre ?? s.tipo);
          return (
            <li
              key={s.id}
              draggable
              onDragStart={() => setArrastrando(s.id)}
              onDragEnd={() => {
                setArrastrando(null);
                setSobre(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setSobre(s.id);
              }}
              onDrop={() => soltar(s.id)}
              className={[s.id === actual ? 'actual' : '', sobre === s.id && arrastrando !== s.id ? 'sobre' : ''].join(' ')}
            >
              <button className="item-seccion" onClick={() => onElegir(s.id)} aria-current={s.id === actual ? 'page' : undefined}>
                {mini ? <img className="miniatura" src={urlRecurso(mini, version)} alt="" /> : <span className="icono-seccion" aria-hidden>{ICONO[s.tipo]}</span>}
                <span className="texto-seccion">
                  <span className="titulo-seccion">{s.titulo || <em>{nombreTipo}</em>}</span>
                  <span className="detalle-seccion">
                    {nombreTipo}
                    {estado.palabras[s.id] ? ' · ' + t('{0} palabras', { 0: estado.palabras[s.id].toLocaleString(locale()) }) : ''}
                  </span>
                </span>
                {avisosPorSeccion[s.id] ? (
                  <span className="insignia" title={`${avisosPorSeccion[s.id]} problemas`}>
                    {avisosPorSeccion[s.id]}
                  </span>
                ) : null}
              </button>
              <span className="acciones-seccion">
                <button title={t('Subir')} aria-label={t('Subir {0}', { 0: s.titulo || nombreTipo })} disabled={k === 0} onClick={() => mover(s.id, -1)}>↑</button>
                <button title={t('Bajar')} aria-label={t('Bajar {0}', { 0: s.titulo || nombreTipo })} disabled={k === libro.secciones.length - 1} onClick={() => mover(s.id, 1)}>↓</button>
                <button title={t('Eliminar')} aria-label={t('Eliminar {0}', { 0: s.titulo || nombreTipo })} onClick={() => onEliminar(s)}>✕</button>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
