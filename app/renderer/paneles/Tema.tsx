import { useEffect, useRef, useState } from 'react';
import type { Tema, Tipografia } from '../../../src/model';
import { FUENTES, TEMA_PREDETERMINADO, validarTema } from '../../../src/model';
import { FuentesPropias } from './FuentesPropias';
import { TEMAS } from '../../../src/temas';
import type { Estado } from '../api';
import { api, urlRecurso } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

interface Props {
  estado: Estado;
  version: number;
  onTema: (c: Partial<Tema>) => void;
  onGaleria: (id: string) => void;
  onTipografia: (c: Partial<Tipografia>) => void;
  onAplicarTipografia: () => void;
  onEstado: (e: Estado) => void;
}

const SEPARADORES: { id: Tema['separador']; nombre: string }[] = [
  { id: 'asteriscos', nombre: '* * *' },
  { id: 'flor', nombre: '❦ Flor' },
  { id: 'rombos', nombre: '◇ ◆ ◇ Rombos' },
  { id: 'puntos', nombre: '· · · Puntos' },
  { id: 'linea', nombre: t('Línea') },
  { id: 'espacio', nombre: t('Espacio en blanco') },
  { id: 'imagen', nombre: t('Imagen propia…') },
];

const ESTILOS_TITULO: { id: Tema['tituloEstilo']; nombre: string }[] = [
  { id: 'centrado', nombre: t('Centrado') },
  { id: 'numero-grande', nombre: t('Número arriba y título grande') },
  { id: 'izquierda', nombre: t('A la izquierda') },
  { id: 'linea', nombre: t('A la izquierda con línea') },
];

function Muestra({ version }: { version: number }) {
  const [modo, setModo] = useState<'lector' | 'pagina'>('lector');
  const [url, setUrl] = useState('');
  const marco = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(0.4);
  useEffect(() => {
    const medir = () => marco.current && setEscala(Math.min(marco.current.clientWidth / 640, 360 / 900));
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [modo]);
  useEffect(() => {
    let vivo = true;
    const tm = setTimeout(() => api.muestraTema(modo).then((r) => vivo && setUrl(r.url)).catch(() => undefined), 150);
    return () => {
      vivo = false;
      clearTimeout(tm);
    };
  }, [modo, version]);
  return (
    <div className="muestra-viva">
      <div className="conmutador" role="radiogroup" aria-label={t('Muestra')}>
        <button role="radio" aria-checked={modo === 'lector'} className={modo === 'lector' ? 'activo' : ''} onClick={() => setModo('lector')}>
          {t('Lector')}
        </button>
        <button role="radio" aria-checked={modo === 'pagina'} className={modo === 'pagina' ? 'activo' : ''} onClick={() => setModo('pagina')}>
          {t('Página impresa')}
        </button>
      </div>
      <div ref={marco} className={`marco-muestra ${modo}`} style={{ ['--escala' as string]: escala } as React.CSSProperties}>{url && <iframe key={url} src={url} title={t('Muestra del tema')} sandbox="allow-same-origin allow-scripts" />}</div>
    </div>
  );
}

export function PanelTema({ estado, version, onTema, onGaleria, onTipografia, onAplicarTipografia, onEstado }: Props) {
  const tm: Tema = { ...TEMA_PREDETERMINADO, ...estado.libro.tema };
  const tip = estado.libro.tipografia;
  const entradaTema = useRef<HTMLInputElement>(null);
  const entradaOrnamento = useRef<HTMLInputElement>(null);
  const ornamento = estado.libro.recursos.find((r) => r.id === tm.separadorImagen);

  const guardarTema = () => {
    const { separadorImagen: _s, ...exportable } = tm;
    const blob = new Blob([JSON.stringify({ formato: 'obi-tema', version: 1, tema: exportable }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(tm.nombre || 'tema').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}.obitema`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  const cargarTema = async (f: File) => {
    try {
      const datos = JSON.parse(await f.text());
      const tema = validarTema(datos?.tema ?? datos, (estado.libro.fuentesPropias ?? []).map((f) => `propia-${f.id}`));
      if (!Object.keys(tema).length) throw new Error(t('El archivo no contiene un tema válido.'));
      onTema({ ...tema, nombre: tema.nombre ?? f.name.replace(/\.[^.]+$/, '') });
      aviso(t('Tema «{0}» cargado.', { 0: tema.nombre ?? f.name }));
    } catch (e) {
      aviso((e as Error).message.includes('JSON') ? t('El archivo no es un tema de Obi Studio.') : (e as Error).message, 'error');
    }
  };

  const subirOrnamento = async (f: File) => {
    try {
      const r = await api.subirImagen(f);
      onEstado(r.estado);
      onTema({ separador: 'imagen', separadorImagen: r.recurso.id });
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const fuentesTexto = FUENTES.filter((f) => !f.soloTitulos);
  const propias = estado.libro.fuentesPropias ?? [];
  const opcionesPropias = propias.length > 0 && (
    <optgroup label={t('Fuentes propias')}>
      {propias.map((f) => (
        <option key={f.id} value={`propia-${f.id}`}>{f.familia}</option>
      ))}
    </optgroup>
  );
  const [verFuentes, setVerFuentes] = useState(false);

  return (
    <div className="panel-tema">
      <Muestra version={version} />
      <p className="dato">{t('Tema actual:')} <strong>{tm.nombre || 'Personalizado'}</strong></p>

      <details className="seccion-tema" open>
        <summary>{t('Galería de temas')}</summary>
        <div className="galeria-temas">
          {TEMAS.map((g) => (
            <button key={g.id} className={`tarjeta-tema ${tm.nombre === g.nombre ? 'activo' : ''}`} onClick={() => onGaleria(g.id)} title={t(g.descripcion)}>
              <span className="muestra-tarjeta" style={{ color: g.tema.colorTitulos, fontFamily: FUENTES.find((f) => f.id === g.tema.fuenteTitulos)?.familia }}>
                {t('Aa')}
              </span>
              <strong>{t(g.nombre ?? '')}</strong>
              <small>{t(g.descripcion)}</small>
            </button>
          ))}
        </div>
      </details>

      <details className="seccion-tema" open>
        <summary>{t('Letra y párrafos')}</summary>
        <div className="fila-dos">
          <label className="campo">
            <span>{t('Letra del texto')}</span>
            <select value={tm.fuenteTexto} onChange={(e) => onTema({ fuenteTexto: e.target.value })}>
              {fuentesTexto.map((f) => (
                <option key={f.id} value={f.id}>{t(f.nombre)}</option>
              ))}
              {opcionesPropias}
            </select>
          </label>
          <label className="campo">
            <span>{t('Letra de los títulos')}</span>
            <select value={tm.fuenteTitulos} onChange={(e) => onTema({ fuenteTitulos: e.target.value })}>
              {FUENTES.map((f) => (
                <option key={f.id} value={f.id}>{t(f.nombre)}</option>
              ))}
              {opcionesPropias}
            </select>
          </label>
        </div>
        <small className="ayuda">{t('Las letras «del lector» no se incrustan: cada lector usa la suya. Las demás van dentro del EPUB (licencia libre OFL).')}</small>
        <button className="boton-fuentes" onClick={() => setVerFuentes(true)}>{t('Fuentes propias…')}</button>
        {verFuentes && <FuentesPropias estado={estado} onCerrar={() => setVerFuentes(false)} onEstado={onEstado} />}
        <label className="campo">
          <span>{t('Interlineado: {0}', { 0: tm.interlineado.toFixed(2) })}</span>
          <input type="range" min={1.1} max={2} step={0.05} value={tm.interlineado} onChange={(e) => onTema({ interlineado: Number(e.target.value) })} />
        </label>
        <label className="campo">
          <span>{t('Sangría: {0} em', { 0: tm.sangria.toFixed(1) })}</span>
          <input type="range" min={0} max={3} step={0.1} value={tm.sangria} onChange={(e) => onTema({ sangria: Number(e.target.value) })} />
        </label>
        <label className="campo">
          <span>{t('Espacio entre párrafos: {0} em', { 0: tm.espacioParrafos.toFixed(1) })}</span>
          <input type="range" min={0} max={1.5} step={0.1} value={tm.espacioParrafos} onChange={(e) => onTema({ espacioParrafos: Number(e.target.value) })} />
        </label>
        <label className="campo">
          <span>{t('Alineación')}</span>
          <select value={tm.alinear} onChange={(e) => onTema({ alinear: e.target.value as Tema['alinear'] })}>
            <option value="justificado">{t('Justificado')}</option>
            <option value="izquierda">{t('A la izquierda')}</option>
          </select>
        </label>
      </details>

      <details className="seccion-tema">
        <summary>{t('Títulos de capítulo')}</summary>
        <label className="campo">
          <span>{t('Estilo')}</span>
          <select value={tm.tituloEstilo} onChange={(e) => onTema({ tituloEstilo: e.target.value as Tema['tituloEstilo'] })}>
            {ESTILOS_TITULO.map((x) => (
              <option key={x.id} value={x.id}>{t(x.nombre)}</option>
            ))}
          </select>
          {tm.tituloEstilo === 'numero-grande' && <small>{t('Separa «Capítulo 3» de «El gremio» si el título tiene esa forma.')}</small>}
        </label>
        <label className="campo">
          <span>{t('Tamaño: {0} em', { 0: tm.tituloTamano.toFixed(1) })}</span>
          <input type="range" min={1} max={2.6} step={0.1} value={tm.tituloTamano} onChange={(e) => onTema({ tituloTamano: Number(e.target.value) })} />
        </label>
        <label className="campo">
          <span>{t('Espacio encima: {0} em', { 0: tm.tituloEspacio.toFixed(1) })}</span>
          <input type="range" min={0} max={10} step={0.5} value={tm.tituloEspacio} onChange={(e) => onTema({ tituloEspacio: Number(e.target.value) })} />
        </label>
        <label className="casilla">
          <input type="checkbox" checked={tm.tituloMayusculas} onChange={(e) => onTema({ tituloMayusculas: e.target.checked })} />
          {t('Títulos en versalitas')}
        </label>
        <label className="campo color">
          <span>{t('Color de los títulos')}</span>
          <input type="color" value={tm.colorTitulos} onChange={(e) => onTema({ colorTitulos: e.target.value })} />
        </label>
        <small className="ayuda">{t('La imagen de cabecera de cada capítulo se elige en la pestaña Sección.')}</small>
      </details>

      <details className="seccion-tema">
        <summary>{t('Inicio de capítulo')}</summary>
        <label className="casilla">
          <input type="checkbox" checked={tm.capitular === 'letra'} onChange={(e) => onTema({ capitular: e.target.checked ? 'letra' : 'ninguna' })} />
          {t('Letra capitular')}
        </label>
        <label className="casilla">
          <input type="checkbox" checked={tm.primeraLinea} onChange={(e) => onTema({ primeraLinea: e.target.checked })} />
          {t('Primera línea en versalitas')}
        </label>
      </details>

      <details className="seccion-tema">
        <summary>{t('Separador de escena')}</summary>
        <div className="opciones-separador" role="radiogroup" aria-label={t('Separador de escena')}>
          {SEPARADORES.map((x) => (
            <button
              key={x.id}
              role="radio"
              aria-checked={tm.separador === x.id}
              className={tm.separador === x.id ? 'activo' : ''}
              onClick={() => (x.id === 'imagen' && !ornamento ? entradaOrnamento.current?.click() : onTema({ separador: x.id }))}
            >
              {t(x.nombre)}
            </button>
          ))}
        </div>
        {tm.separador === 'imagen' && ornamento && (
          <div className="fila-ornamento">
            <img src={urlRecurso(ornamento.id, version)} alt={t('Ornamento')} />
            <button className="pequeno" onClick={() => entradaOrnamento.current?.click()}>{t('Cambiar imagen…')}</button>
          </div>
        )}
        <input ref={entradaOrnamento} type="file" hidden accept="image/png,image/svg+xml,image/webp,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirOrnamento(f); e.target.value = ''; }} />
        <label className="campo color">
          <span>{t('Color de acento (separador, capitular, número)')}</span>
          <input type="color" value={tm.colorAcento} onChange={(e) => onTema({ colorAcento: e.target.value })} />
        </label>
      </details>

      <details className="seccion-tema">
        <summary>{t('Tipografía española')}</summary>
        <label className="casilla">
          <input type="checkbox" checked={tip.raya} onChange={(e) => onTipografia({ raya: e.target.checked })} />
          {t('Raya de diálogo (— en vez de -)')}
        </label>
        <label className="casilla">
          <input type="checkbox" checked={tip.suspensivos} onChange={(e) => onTipografia({ suspensivos: e.target.checked })} />
          {t('Puntos suspensivos (… en vez de ...)')}
        </label>
        <label className="campo">
          <span>{t('Comillas')}</span>
          <select value={tip.comillas} onChange={(e) => onTipografia({ comillas: e.target.value as Tipografia['comillas'] })}>
            <option value="latinas">{t('Latinas « »')}</option>
            <option value="inglesas">{t('Inglesas “ ”')}</option>
            <option value="sin-cambio">{t('No cambiar')}</option>
          </select>
        </label>
        <button onClick={onAplicarTipografia}>{t('Aplicar a todo el libro')}</button>
      </details>

      <div className="botones-exportar">
        <button onClick={guardarTema} title={t('Guarda el tema para usarlo en otros libros')}>{t('Guardar tema…')}</button>
        <button onClick={() => entradaTema.current?.click()}>{t('Cargar tema…')}</button>
        <input ref={entradaTema} type="file" hidden accept=".obitema,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void cargarTema(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}
