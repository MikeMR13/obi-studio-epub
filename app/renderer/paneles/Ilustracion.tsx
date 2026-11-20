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

  const orientacion = recurso?.ancho && recurso?.alto ? (recurso.ancho > recurso.alto ? 'horizontal' : 'vertical') : undefined;
  const baja = recurso?.alto && recurso.alto < 1200 && recurso.ancho && recurso.ancho < 1200;

  return (
    <div className="ilustracion-panel">
      <div className="lienzo-ilustracion">
        {recurso ? (
          <img src={urlRecurso(recurso.id, version)} alt={alt || t('Ilustración sin descripción')} />
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
        {baja && <p className="aviso-texto">{t('⚠ Resolución baja: para una página completa se recomiendan al menos 1200 px de lado.')}</p>}
        {orientacion === 'horizontal' && !esPortada && (
          <p className="aviso-texto">{t('Imagen horizontal: en lectores verticales se verá pequeña. En el PDF de impresión puedes ponerla a doble página (pestaña Sección).')}</p>
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
