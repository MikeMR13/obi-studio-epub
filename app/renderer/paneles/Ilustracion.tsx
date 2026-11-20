import { useEffect, useRef, useState } from 'react';
import type { Imagen, Seccion } from '../../../src/model';
import type { Estado } from '../api';
import { api, urlRecurso } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  seccion: Seccion;
  version: number;
  onBloques: (bloques: Seccion['bloques']) => void;
  onEstado: (e: Estado) => void;
  onPortada: (recurso: string) => void;
}

export function Ilustracion({ estado, seccion, version, onBloques, onEstado, onPortada }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const esPortada = seccion.tipo === 'portada';
  const bloque = seccion.bloques.find((b): b is Imagen => b.tipo === 'imagen');
  const recursoId = bloque?.recurso ?? (esPortada ? estado.libro.metadatos.portada : undefined);
  const recurso = estado.libro.recursos.find((r) => r.id === recursoId);
  const [alt, setAlt] = useState(bloque?.alt ?? '');
  useEffect(() => setAlt(bloque?.alt ?? ''), [bloque?.alt, seccion.id]);

  const elegir = async (archivo: File) => {
    try {
      const { recurso: nuevo, estado: e } = await api.subirImagen(archivo);
      onEstado(e);
      onBloques([{ tipo: 'imagen', recurso: nuevo.id, alt: bloque?.alt ?? '' }]);
      if (esPortada) onPortada(nuevo.id);
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const guardarAlt = () => {
    if (!bloque || alt === bloque.alt) return;
    onBloques(seccion.bloques.map((b) => (b === bloque ? { ...bloque, alt } : b)));
  };

  // ----- Girar y recortar -----
  const procesable = !!recurso && ['image/jpeg', 'image/png', 'image/gif'].includes(recurso.tipoMime);
  const [recortando, setRecortando] = useState(false);
  const [sel, setSel] = useState<{ x: number; y: number; ancho: number; alto: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const imagen = useRef<HTMLImageElement>(null);
  const inicio = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setRecortando(false);
    setSel(null);
  }, [recursoId]);

  const punto = (e: React.PointerEvent) => {
    const r = imagen.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const arrastrar = (e: React.PointerEvent) => {
    if (!inicio.current) return;
    const p = punto(e);
    const a = inicio.current;
    setSel({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), ancho: Math.abs(p.x - a.x), alto: Math.abs(p.y - a.y) });
  };

  const editar = async (op: Parameters<typeof api.editarImagen>[1]) => {
    if (!recurso) return;
    setOcupado(true);
    try {
      onEstado(await api.editarImagen(recurso.id, op));
      setRecortando(false);
      setSel(null);
      aviso(t('Imagen cambiada. La original queda en Versiones.'));
    } catch (e) {
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  const dividir = async () => {
    setOcupado(true);
    try {
      const r = await api.dividirIlustracion(seccion.id);
      onEstado(r.estado);
      aviso(t('Ilustración dividida en dos páginas. La original queda en Versiones.'));
    } catch (e) {
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  const selValida = !!sel && sel.ancho > 0.02 && sel.alto > 0.02;
  const pxSel = sel && recurso?.ancho && recurso.alto ? `${Math.round(sel.ancho * recurso.ancho)}×${Math.round(sel.alto * recurso.alto)} px` : '';

  const orientacion = recurso?.ancho && recurso?.alto ? (recurso.ancho > recurso.alto ? 'horizontal' : 'vertical') : undefined;
  const baja = recurso?.alto && recurso.alto < 1200 && recurso.ancho && recurso.ancho < 1200;

  return (
    <div className="ilustracion-panel">
      <div className="lienzo-ilustracion">
        {recurso ? (
          <div
            className={'marco-recorte' + (recortando ? ' activo' : '')}
            onPointerDown={(e) => {
              if (!recortando) return;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              inicio.current = punto(e);
              setSel(null);
            }}
            onPointerMove={arrastrar}
            onPointerUp={() => (inicio.current = null)}
          >
            <img ref={imagen} src={urlRecurso(recurso.id, version) + `-${recurso.bytes}-${recurso.ancho}`} alt={alt || t('Ilustración sin descripción')} draggable={false} />
            {recortando && sel && (
              <div className="seleccion-recorte" style={{ left: `${sel.x * 100}%`, top: `${sel.y * 100}%`, width: `${sel.ancho * 100}%`, height: `${sel.alto * 100}%` }} />
            )}
          </div>
        ) : (
          <div className="sin-imagen">
            <p>{esPortada ? t('Esta portada aún no tiene imagen.') : t('Esta página de ilustración aún no tiene imagen.')}</p>
          </div>
        )}
      </div>
      <div className="datos-ilustracion">
        <button className="principal" onClick={() => entrada.current?.click()}>
          {recurso ? t('Cambiar imagen…') : t('Elegir imagen…')}
        </button>
        <input
          ref={entrada}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void elegir(f);
            e.target.value = '';
          }}
        />
        {recurso && (
          <p className="dato">
            {recurso.nombre} · {recurso.ancho}×{recurso.alto} px · {orientacion && t(orientacion === 'horizontal' ? 'horizontal' : 'vertical')} · {(recurso.bytes / 1024).toFixed(0)} KB
          </p>
        )}
        {recurso && (
          <div className="herramientas-imagen" role="group" aria-label={t('Editar la imagen')}>
            <button disabled={!procesable || ocupado || recortando} onClick={() => editar({ girar: 270 })} title={t('Girar a la izquierda')} aria-label={t('Girar a la izquierda')}>⟲</button>
            <button disabled={!procesable || ocupado || recortando} onClick={() => editar({ girar: 90 })} title={t('Girar a la derecha')} aria-label={t('Girar a la derecha')}>⟳</button>
            {!recortando ? (
              <button disabled={!procesable || ocupado} onClick={() => setRecortando(true)}>{t('Recortar…')}</button>
            ) : (
              <>
                <button className="principal" disabled={!selValida || ocupado} onClick={() => sel && editar({ recorte: sel })}>{t('Aplicar recorte')}</button>
                <button onClick={() => { setRecortando(false); setSel(null); }}>{t('Cancelar')}</button>
              </>
            )}
          </div>
        )}
        {recortando && <p className="ayuda">{selValida ? t('Recorte de {0}.', { 0: pxSel }) : t('Arrastra sobre la imagen para marcar la zona que quieres conservar.')}</p>}
        {recurso && !procesable && <p className="ayuda">{t('Solo se pueden girar y recortar imágenes JPEG, PNG y GIF.')}</p>}
        {baja && <p className="aviso-texto">{t('⚠ Resolución baja: para una página completa se recomiendan al menos 1200 px de lado.')}</p>}
        {orientacion === 'horizontal' && !esPortada && (
          <>
            <p className="aviso-texto">{t('Imagen horizontal: en lectores verticales se verá pequeña. En el PDF de impresión puedes ponerla a doble página (pestaña Sección).')}</p>
            <button disabled={!procesable || ocupado || recortando} onClick={dividir}>{t('Dividir en dos páginas')}</button>
          </>
        )}
        {bloque && (
          <>
            <label className="campo">
              <span>{t('Descripción de la imagen')} {esPortada ? t('(opcional en la portada)') : ''}</span>
              <textarea rows={4} value={alt} onChange={(e) => setAlt(e.target.value)} onBlur={guardarAlt} disabled={!!bloque.decorativa} placeholder={t('Describe lo que se ve: personajes, acción, ambiente…')} />
            </label>
            {!esPortada && (
              <label className="casilla">
                <input
                  type="checkbox"
                  checked={!!bloque.decorativa}
                  onChange={(e) => onBloques(seccion.bloques.map((b) => (b === bloque ? { ...bloque, decorativa: e.target.checked || undefined } : b)))}
                />
                {t('Imagen decorativa')}
              </label>
            )}
            {!alt.trim() && !bloque.decorativa && !esPortada && <p className="aviso-texto">{t('⚠ Falta la descripción: es necesaria para la accesibilidad.')}</p>}
          </>
        )}
      </div>
    </div>
  );
}
