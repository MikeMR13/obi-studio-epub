import { useEffect, useRef, useState } from 'react';
import { api, descargar, type Estado, type RevisionCubierta } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  onCerrar: () => void;
  onEstado: (e: Estado) => void;
}

const PAPELES = [
  { id: 'blanco', nombre: 'Blanco (tinta negra o color estándar)' },
  { id: 'crema', nombre: 'Crema' },
  { id: 'color-premium', nombre: 'Color prémium' },
];

const PREDETERMINADA = { imprenta: 'kdp', papel: 'crema', colorFondo: '#1d2433', colorTexto: '#ffffff', codigoBarras: true };

/** Cubierta de imprenta: contraportada, lomo y portada con el lomo calculado. */
export function Cubierta({ estado, onCerrar, onEstado }: Props) {
  const c = { ...PREDETERMINADA, ...(estado.libro.cubierta ?? {}) } as NonNullable<Estado['libro']['cubierta']>;
  const [revision, setRevision] = useState<RevisionCubierta>();
  const [url, setUrl] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [texto, setTexto] = useState(c.textoContraportada ?? '');
  const subir = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState<'portada' | 'contraportada'>('contraportada');

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const refrescar = (r?: RevisionCubierta) => {
    if (r) setRevision(r);
    else api.revisionCubierta().then(setRevision).catch(() => undefined);
    api
      .visorCubierta()
      .then((v) => setUrl(v.url))
      .catch(() => setUrl(''));
  };
  useEffect(() => refrescar(), []);

  const cambiar = async (cambios: Record<string, unknown>) => {
    try {
      const r = await api.cambiarCubierta(cambios);
      onEstado(r.estado);
      refrescar(r);
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const exportar = async () => {
    setOcupado(t('Creando el PDF de la cubierta…'));
    try {
      await descargar('/api/cubierta/exportar');
      aviso(t('PDF de la cubierta creado.'));
    } catch (e) {
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const subirImagen = async (f: File) => {
    try {
      const r = await api.subirImagen(f);
      onEstado(r.estado);
      await cambiar({ [subiendo]: r.recurso.id });
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const m = revision?.medidas;
  const errores = revision?.avisos.filter((a) => a.gravedad === 'error').length ?? 0;
  const imagenes = estado.libro.recursos.filter((r) => r.tipoMime.startsWith('image/') && r.tipoMime !== 'image/svg+xml');

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins panel-cubierta" role="dialog" aria-modal="true" aria-labelledby="titulo-cubierta">
        <div className="cabecera-plugins">
          <h2 id="titulo-cubierta">{t('Cubierta de imprenta')}</h2>
          <button className="cerrar" onClick={onCerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <div className="cuerpo-cubierta">
          <div className="ajustes-cubierta">
            <label className="campo">
              <span>{t('Imprenta')}</span>
              <select value={c.imprenta} onChange={(e) => cambiar({ imprenta: e.target.value })}>
                <option value="kdp">{t('KDP Print (lomo calculado)')}</option>
                <option value="otra">{t('IngramSpark u otra (lomo de su plantilla)')}</option>
              </select>
            </label>
            {c.imprenta === 'kdp' ? (
              <label className="campo">
                <span>{t('Papel')}</span>
                <select value={c.papel} onChange={(e) => cambiar({ papel: e.target.value })}>
                  {PAPELES.map((p) => (
                    <option key={p.id} value={p.id}>{t(p.nombre)}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="campo">
                <span>{t('Ancho del lomo (mm)')}</span>
                <input type="number" min={0.5} max={120} step={0.01} defaultValue={c.lomoManual ?? ''} onBlur={(e) => cambiar({ lomoManual: e.target.value })} />
                <small>{t('Cópialo de la plantilla de cubierta que genera tu imprenta.')}</small>
              </label>
            )}
            <label className="campo">
              <span>{t('Páginas del interior')}</span>
              <input type="number" min={1} max={3000} defaultValue={c.paginas ?? ''} placeholder={revision?.paginas ? String(revision.paginas) : ''} onBlur={(e) => cambiar({ paginas: e.target.value })} />
              <small>{t('Vacío = las del último PDF de imprenta.')}</small>
            </label>
            <div className="fila-dos">
              <label className="campo">
                <span>{t('Portada')}</span>
                <select value={c.portada ?? ''} onChange={(e) => cambiar({ portada: e.target.value || null })}>
                  <option value="">{t('La del libro')}</option>
                  {imagenes.map((r) => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              </label>
              <label className="campo">
                <span>{t('Contraportada')}</span>
                <select value={c.contraportada ?? ''} onChange={(e) => cambiar({ contraportada: e.target.value || null })}>
                  <option value="">{t('Color de fondo')}</option>
                  {imagenes.map((r) => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="botones-dialogo izquierda">
              <button onClick={() => { setSubiendo('contraportada'); subir.current?.click(); }}>{t('Subir contraportada…')}</button>
              <button onClick={() => { setSubiendo('portada'); subir.current?.click(); }}>{t('Subir portada a 300 ppp…')}</button>
              <input ref={subir} type="file" hidden accept="image/png,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirImagen(f); e.target.value = ''; }} />
            </div>
            <div className="fila-dos">
              <label className="campo color">
                <span>{t('Fondo')}</span>
                <input type="color" value={c.colorFondo} onChange={(e) => cambiar({ colorFondo: e.target.value })} />
              </label>
              <label className="campo color">
                <span>{t('Texto')}</span>
                <input type="color" value={c.colorTexto} onChange={(e) => cambiar({ colorTexto: e.target.value })} />
              </label>
            </div>
            <label className="campo">
              <span>{t('Texto de la contraportada')}</span>
              <textarea rows={5} value={texto} placeholder={estado.libro.metadatos.descripcion || t('Si lo dejas vacío, se usa la sinopsis.')} onChange={(e) => setTexto(e.target.value)} onBlur={() => cambiar({ textoContraportada: texto })} />
            </label>
            <label className="casilla">
              <input type="checkbox" checked={c.codigoBarras} onChange={(e) => cambiar({ codigoBarras: e.target.checked })} />
              {t('Dejar libre la zona del código de barras (KDP la exige)')}
            </label>
            {m && (
              <p className="dato" role="status">
                {t('Cubierta de {0} × {1} mm · lomo de {2} mm', { 0: m.anchoTotal.toFixed(2), 1: m.altoTotal.toFixed(2), 2: m.lomo.toFixed(2) })}
              </p>
            )}
            <ul className="mensajes">
              {revision?.avisos
                .filter((a) => !a.plantilla.startsWith('Cubierta de'))
                .map((a, k) => (
                  <li key={k} className={a.gravedad === 'info' ? 'info' : a.gravedad}>
                    <strong>{a.gravedad === 'error' ? t('Error') : a.gravedad === 'aviso' ? t('Aviso') : t('Nota')}</strong> {t(a.plantilla, a.valores)}
                  </li>
                ))}
            </ul>
            {ocupado && <p className="ayuda" role="status">{ocupado}</p>}
            <div className="botones-dialogo">
              <button className="principal" disabled={!!ocupado || errores > 0} onClick={exportar}>{t('Crear PDF de la cubierta')}</button>
            </div>
          </div>
          <div className="vista-cubierta">
            {url ? <iframe title={t('Vista previa de la cubierta')} src={url} key={url} /> : <p className="ayuda">{t('Indica el número de páginas para ver la cubierta.')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
