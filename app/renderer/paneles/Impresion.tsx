import { useEffect, useState } from 'react';
import type { Impresion as AjustesImpresion } from '../../../src/model';
import { TAMANOS_IMPRESION, IMPRESION_PREDETERMINADA } from '../../../src/model';
import type { Estado, AvisoImpresion } from '../api';
import { api } from '../api';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  version: number;
  onCambiar: (c: Partial<AjustesImpresion>) => void;
  onExportar: (tipo: 'impresion' | 'digital') => void;
  exportando: boolean;
  onIrA: (seccion: string) => void;
}

function Numero(p: { etiqueta: string; valor: number; min: number; max: number; paso?: number; unidad: string; onGuardar: (v: number) => void; ayuda?: string }) {
  const [v, setV] = useState(String(p.valor));
  useEffect(() => setV(String(p.valor)), [p.valor]);
  const guardar = () => {
    const n = Number(v.replace(',', '.'));
    if (!isNaN(n) && n !== p.valor && n >= p.min && n <= p.max) p.onGuardar(n);
    else setV(String(p.valor));
  };
  return (
    <label className="campo">
      <span>{p.etiqueta}</span>
      <span className="con-unidad">
        <input type="number" min={p.min} max={p.max} step={p.paso ?? 0.5} value={v} onChange={(e) => setV(e.target.value)} onBlur={guardar} onKeyDown={(e) => e.key === 'Enter' && guardar()} />
        <em>{p.unidad}</em>
      </span>
      {p.ayuda && <small>{p.ayuda}</small>}
    </label>
  );
}

const MARGEN_AUTO = (paginas?: number) => {
  const p = paginas ?? 200;
  const pulgadas = p <= 150 ? 0.375 : p <= 300 ? 0.5 : p <= 500 ? 0.625 : p <= 700 ? 0.75 : 0.875;
  return (pulgadas * 25.4).toFixed(1);
};

export function PanelImpresion({ estado, version, onCambiar, onExportar, exportando, onIrA }: Props) {
  const a: AjustesImpresion = { ...IMPRESION_PREDETERMINADA, ...(estado.libro.impresion ?? {}) };
  const [revision, setRevision] = useState<{ avisos: AvisoImpresion[]; paginas?: number } | null>(null);
  useEffect(() => {
    api.revisionImpresion().then(setRevision).catch(() => undefined);
  }, [version]);

  const casilla = (clave: keyof AjustesImpresion, texto: string) => (
    <label className="casilla">
      <input type="checkbox" checked={!!a[clave]} onChange={(e) => onCambiar({ [clave]: e.target.checked })} />
      {texto}
    </label>
  );

  return (
    <>
      <p className="ayuda">{t('PDF para imprenta (KDP Print, IngramSpark, Lulu) o para leer en pantalla. Sale del mismo libro y del mismo tema que el EPUB.')}</p>
      <label className="campo">
        <span>{t('Tamaño de corte')}</span>
        <select value={a.tamano} onChange={(e) => onCambiar({ tamano: e.target.value })}>
          {TAMANOS_IMPRESION.map((x) => (
            <option key={x.id} value={x.id}>{t(x.nombre)}</option>
          ))}
          <option value="libre" disabled>{t('Personalizado')}</option>
        </select>
      </label>
      <div className="fila-dos">
        <Numero etiqueta={t('Ancho')} valor={a.ancho} min={76} max={216} unidad="mm" onGuardar={(v) => onCambiar({ ancho: v })} />
        <Numero etiqueta={t('Alto')} valor={a.alto} min={101} max={297} unidad="mm" onGuardar={(v) => onCambiar({ alto: v })} />
      </div>
      <label className="campo">
        <span>{t('Sangrado')}</span>
        <select value={a.sangrado} onChange={(e) => onCambiar({ sangrado: e.target.value as AjustesImpresion['sangrado'] })}>
          <option value="ninguno">{t('Sin sangrado')}</option>
          <option value="kdp">{t('KDP Print (3,175 mm arriba, abajo y fuera)')}</option>
          <option value="uniforme">{t('IngramSpark / Lulu (3 mm por lado)')}</option>
        </select>
        <small>{t('Solo hace falta si alguna ilustración llega al borde del papel.')}</small>
      </label>
      {a.sangrado !== 'ninguno' && casilla('ilustracionesASangre', t('Ilustraciones de página completa a sangre'))}
      <label className="casilla">
        <input type="checkbox" checked={!!a.pdfx} disabled={!estado.ghostscript && !a.pdfx} onChange={(e) => onCambiar({ pdfx: e.target.checked })} />
        {t('PDF/X-1a (CMYK) para imprenta offset')}
      </label>
      <small className="ayuda">
        {estado.ghostscript
          ? t('Convierte a CMYK con texto en negro puro, aplana transparencias y añade el perfil de salida. KDP e IngramSpark aceptan el PDF normal.')
          : t('Necesita Ghostscript instalado (gratuito, ghostscript.com). Al instalarlo, reinicia Obi Studio.')}
      </small>
      {casilla('marcasCorte', t('Marcas de corte (solo imprentas tradicionales)'))}
      <fieldset className="grupo">
        <legend>{t('Márgenes')}</legend>
        <div className="fila-dos">
          <Numero etiqueta={t('Superior')} valor={a.margenSuperior} min={5} max={40} unidad="mm" onGuardar={(v) => onCambiar({ margenSuperior: v })} />
          <Numero etiqueta={t('Inferior')} valor={a.margenInferior} min={5} max={40} unidad="mm" onGuardar={(v) => onCambiar({ margenInferior: v })} />
          <Numero etiqueta={t('Exterior')} valor={a.margenExterior} min={5} max={40} unidad="mm" onGuardar={(v) => onCambiar({ margenExterior: v })} />
          <Numero
            etiqueta={t('Interior (0 = auto)')}
            valor={a.margenInterior}
            min={0}
            max={40}
            unidad="mm"
            onGuardar={(v) => onCambiar({ margenInterior: v })}
          />
        </div>
        {a.margenInterior === 0 && (
          <small className="ayuda">
            {t('Automático: {0} mm', { 0: MARGEN_AUTO(revision?.paginas) })} {revision?.paginas ? t('para {0} páginas', { 0: revision.paginas }) : t('(se ajusta al número de páginas al exportar)')}.
          </small>
        )}
      </fieldset>
      <Numero etiqueta={t('Tamaño de letra')} valor={a.cuerpo} min={8} max={14} paso={0.5} unidad="pt" onGuardar={(v) => onCambiar({ cuerpo: v })} />
      <fieldset className="grupo">
        <legend>{t('Página')}</legend>
        {casilla('cabeceras', t('Cabeceras (título del libro y del capítulo)'))}
        {casilla('folios', t('Números de página'))}
        {casilla('capituloEnImpar', t('Capítulos en página impar'))}
        {casilla('division', t('División silábica en español'))}
        {casilla('incluirPortada', t('Incluir la portada (normalmente va aparte)'))}
      </fieldset>

      <div className="botones-exportar">
        <button className="principal" disabled={exportando} onClick={() => onExportar('impresion')}>
          {exportando ? t('Creando PDF…') : t('PDF para imprenta')}
        </button>
        <button disabled={exportando} onClick={() => onExportar('digital')}>{t('PDF digital')}</button>
      </div>

      <div className="revision-impresion">
        <h3>{revision?.paginas ? t('Revisión previa · {0} páginas', { 0: revision.paginas }) : t('Revisión previa')}</h3>
        {revision && !revision.avisos.length && <p className="ok">{t('✓ Sin problemas para imprimir.')}</p>}
        <ul className="mensajes">
          {revision?.avisos.map((x, k) => {
            const s = estado.libro.secciones.find((y) => y.id === x.seccion);
            return (
              <li key={k} className={x.gravedad === 'info' ? 'info' : x.gravedad}>
                <strong>{x.gravedad === 'error' ? t('Error') : x.gravedad === 'aviso' ? t('Aviso') : t('Nota')}</strong> {x.plantilla ? t(x.plantilla, x.valores) : x.mensaje}
                {s && (
                  <button className="enlace" onClick={() => onIrA(s.id)}>
                    {t("Ir a «{0}»", { 0: s.titulo || s.tipo })}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

export function VistaImpresion({ version }: { version: number }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let vivo = true;
    api
      .visorImpresion()
      .then((r) => vivo && setUrl(r.url))
      .catch((e) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [version]);
  return (
    <div className="vista-impresion">
      {error && <p className="error">{error}</p>}
      {url && <iframe key={url} src={url} title={t('Vista previa de impresión')} />}
      <p className="ayuda centrado">{t('Compaginación real del PDF de imprenta (Vivliostyle). Los cambios de texto o de ajustes se reflejan al volver a esta pestaña.')}</p>
    </div>
  );
}
