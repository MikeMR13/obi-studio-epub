import { useEffect, useRef, useState } from 'react';
import type { Tema, Tipografia } from '../../../src/model';
import { FUENTES, TEMA_PREDETERMINADO, validarTema } from '../../../src/model';
import { TEMAS } from '../../../src/temas';
import type { Estado } from '../api';
import { api, urlRecurso } from '../api';
import { aviso } from '../dialogos';

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
  { id: 'linea', nombre: 'Línea' },
  { id: 'espacio', nombre: 'Espacio en blanco' },
  { id: 'imagen', nombre: 'Imagen propia…' },
];

const ESTILOS_TITULO: { id: Tema['tituloEstilo']; nombre: string }[] = [
  { id: 'centrado', nombre: 'Centrado' },
  { id: 'numero-grande', nombre: 'Número arriba y título grande' },
  { id: 'izquierda', nombre: 'A la izquierda' },
  { id: 'linea', nombre: 'A la izquierda con línea' },
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
    const t = setTimeout(() => api.muestraTema(modo).then((r) => vivo && setUrl(r.url)).catch(() => undefined), 150);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [modo, version]);
  return (
    <div className="muestra-viva">
      <div className="conmutador" role="radiogroup" aria-label="Muestra">
        <button role="radio" aria-checked={modo === 'lector'} className={modo === 'lector' ? 'activo' : ''} onClick={() => setModo('lector')}>
          Lector
        </button>
        <button role="radio" aria-checked={modo === 'pagina'} className={modo === 'pagina' ? 'activo' : ''} onClick={() => setModo('pagina')}>
          Página impresa
        </button>
      </div>
      <div ref={marco} className={`marco-muestra ${modo}`} style={{ ['--escala' as string]: escala } as React.CSSProperties}>{url && <iframe key={url} src={url} title="Muestra del tema" sandbox="allow-same-origin allow-scripts" />}</div>
    </div>
  );
}

export function PanelTema({ estado, version, onTema, onGaleria, onTipografia, onAplicarTipografia, onEstado }: Props) {
  const t: Tema = { ...TEMA_PREDETERMINADO, ...estado.libro.tema };
  const tip = estado.libro.tipografia;
  const entradaTema = useRef<HTMLInputElement>(null);
  const entradaOrnamento = useRef<HTMLInputElement>(null);
  const ornamento = estado.libro.recursos.find((r) => r.id === t.separadorImagen);

  const guardarTema = () => {
    const { separadorImagen: _s, ...exportable } = t;
    const blob = new Blob([JSON.stringify({ formato: 'obi-tema', version: 1, tema: exportable }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(t.nombre || 'tema').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}.obitema`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  const cargarTema = async (f: File) => {
    try {
      const datos = JSON.parse(await f.text());
      const tema = validarTema(datos?.tema ?? datos);
      if (!Object.keys(tema).length) throw new Error('El archivo no contiene un tema válido.');
      onTema({ ...tema, nombre: tema.nombre ?? f.name.replace(/\.[^.]+$/, '') });
      aviso(`Tema «${tema.nombre ?? f.name}» cargado.`);
    } catch (e) {
      aviso((e as Error).message.includes('JSON') ? 'El archivo no es un tema de Obi Studio.' : (e as Error).message, 'error');
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

  return (
    <div className="panel-tema">
      <Muestra version={version} />
      <p className="dato">Tema actual: <strong>{t.nombre || 'Personalizado'}</strong></p>

      <details className="seccion-tema" open>
        <summary>Galería de temas</summary>
        <div className="galeria-temas">
          {TEMAS.map((g) => (
            <button key={g.id} className={`tarjeta-tema ${t.nombre === g.nombre ? 'activo' : ''}`} onClick={() => onGaleria(g.id)} title={g.descripcion}>
              <span className="muestra-tarjeta" style={{ color: g.tema.colorTitulos, fontFamily: FUENTES.find((f) => f.id === g.tema.fuenteTitulos)?.familia }}>
                Aa
              </span>
              <strong>{g.nombre}</strong>
              <small>{g.descripcion}</small>
            </button>
          ))}
        </div>
      </details>

      <details className="seccion-tema" open>
        <summary>Letra y párrafos</summary>
        <div className="fila-dos">
          <label className="campo">
            <span>Letra del texto</span>
            <select value={t.fuenteTexto} onChange={(e) => onTema({ fuenteTexto: e.target.value })}>
              {fuentesTexto.map((f) => (
                <option key={f.id} value={f.id}>{f.nombre}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Letra de los títulos</span>
            <select value={t.fuenteTitulos} onChange={(e) => onTema({ fuenteTitulos: e.target.value })}>
              {FUENTES.map((f) => (
                <option key={f.id} value={f.id}>{f.nombre}</option>
              ))}
            </select>
          </label>
        </div>
        <small className="ayuda">Las letras «del lector» no se incrustan: cada lector usa la suya. Las demás van dentro del EPUB (licencia libre OFL).</small>
        <label className="campo">
          <span>Interlineado: {t.interlineado.toFixed(2)}</span>
          <input type="range" min={1.1} max={2} step={0.05} value={t.interlineado} onChange={(e) => onTema({ interlineado: Number(e.target.value) })} />
        </label>
        <label className="campo">
          <span>Sangría: {t.sangria.toFixed(1)} em</span>
          <input type="range" min={0} max={3} step={0.1} value={t.sangria} onChange={(e) => onTema({ sangria: Number(e.target.value) })} />
        </label>
        <label className="campo">
          <span>Espacio entre párrafos: {t.espacioParrafos.toFixed(1)} em</span>
          <input type="range" min={0} max={1.5} step={0.1} value={t.espacioParrafos} onChange={(e) => onTema({ espacioParrafos: Number(e.target.value) })} />
        </label>
        <label className="campo">
          <span>Alineación</span>
          <select value={t.alinear} onChange={(e) => onTema({ alinear: e.target.value as Tema['alinear'] })}>
            <option value="justificado">Justificado</option>
            <option value="izquierda">A la izquierda</option>
          </select>
        </label>
      </details>

      <details className="seccion-tema">
        <summary>Títulos de capítulo</summary>
        <label className="campo">
          <span>Estilo</span>
          <select value={t.tituloEstilo} onChange={(e) => onTema({ tituloEstilo: e.target.value as Tema['tituloEstilo'] })}>
            {ESTILOS_TITULO.map((x) => (
              <option key={x.id} value={x.id}>{x.nombre}</option>
            ))}
          </select>
          {t.tituloEstilo === 'numero-grande' && <small>Separa «Capítulo 3» de «El gremio» si el título tiene esa forma.</small>}
        </label>
        <label className="campo">
          <span>Tamaño: {t.tituloTamano.toFixed(1)} em</span>
          <input type="range" min={1} max={2.6} step={0.1} value={t.tituloTamano} onChange={(e) => onTema({ tituloTamano: Number(e.target.value) })} />
        </label>
        <label className="campo">
          <span>Espacio encima: {t.tituloEspacio.toFixed(1)} em</span>
          <input type="range" min={0} max={10} step={0.5} value={t.tituloEspacio} onChange={(e) => onTema({ tituloEspacio: Number(e.target.value) })} />
        </label>
        <label className="casilla">
          <input type="checkbox" checked={t.tituloMayusculas} onChange={(e) => onTema({ tituloMayusculas: e.target.checked })} />
          Títulos en versalitas
        </label>
        <label className="campo color">
          <span>Color de los títulos</span>
          <input type="color" value={t.colorTitulos} onChange={(e) => onTema({ colorTitulos: e.target.value })} />
        </label>
        <small className="ayuda">La imagen de cabecera de cada capítulo se elige en la pestaña Sección.</small>
      </details>

      <details className="seccion-tema">
        <summary>Inicio de capítulo</summary>
        <label className="casilla">
          <input type="checkbox" checked={t.capitular === 'letra'} onChange={(e) => onTema({ capitular: e.target.checked ? 'letra' : 'ninguna' })} />
          Letra capitular
        </label>
        <label className="casilla">
          <input type="checkbox" checked={t.primeraLinea} onChange={(e) => onTema({ primeraLinea: e.target.checked })} />
          Primera línea en versalitas
        </label>
      </details>

      <details className="seccion-tema">
        <summary>Separador de escena</summary>
        <div className="opciones-separador" role="radiogroup" aria-label="Separador de escena">
          {SEPARADORES.map((x) => (
            <button
              key={x.id}
              role="radio"
              aria-checked={t.separador === x.id}
              className={t.separador === x.id ? 'activo' : ''}
              onClick={() => (x.id === 'imagen' && !ornamento ? entradaOrnamento.current?.click() : onTema({ separador: x.id }))}
            >
              {x.nombre}
            </button>
          ))}
        </div>
        {t.separador === 'imagen' && ornamento && (
          <div className="fila-ornamento">
            <img src={urlRecurso(ornamento.id, version)} alt="Ornamento" />
            <button className="pequeno" onClick={() => entradaOrnamento.current?.click()}>Cambiar imagen…</button>
          </div>
        )}
        <input ref={entradaOrnamento} type="file" hidden accept="image/png,image/svg+xml,image/webp,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirOrnamento(f); e.target.value = ''; }} />
        <label className="campo color">
          <span>Color de acento (separador, capitular, número)</span>
          <input type="color" value={t.colorAcento} onChange={(e) => onTema({ colorAcento: e.target.value })} />
        </label>
      </details>

      <details className="seccion-tema">
        <summary>Tipografía española</summary>
        <label className="casilla">
          <input type="checkbox" checked={tip.raya} onChange={(e) => onTipografia({ raya: e.target.checked })} />
          Raya de diálogo (— en vez de -)
        </label>
        <label className="casilla">
          <input type="checkbox" checked={tip.suspensivos} onChange={(e) => onTipografia({ suspensivos: e.target.checked })} />
          Puntos suspensivos (… en vez de ...)
        </label>
        <label className="campo">
          <span>Comillas</span>
          <select value={tip.comillas} onChange={(e) => onTipografia({ comillas: e.target.value as Tipografia['comillas'] })}>
            <option value="latinas">Latinas « »</option>
            <option value="inglesas">Inglesas “ ”</option>
            <option value="sin-cambio">No cambiar</option>
          </select>
        </label>
        <button onClick={onAplicarTipografia}>Aplicar a todo el libro</button>
      </details>

      <div className="botones-exportar">
        <button onClick={guardarTema} title="Guarda el tema para usarlo en otros libros">Guardar tema…</button>
        <button onClick={() => entradaTema.current?.click()}>Cargar tema…</button>
        <input ref={entradaTema} type="file" hidden accept=".obitema,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void cargarTema(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}
