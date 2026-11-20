import { useEffect, useRef, useState } from 'react';
import type { Libro } from '../../../src/model';
import { t } from '../i18n';

const DISPOSITIVOS = {
  kindle: { nombre: t('Kindle Paperwhite'), ancho: 412, alto: 550, tinta: true },
  kobo: { nombre: t('Kobo Clara'), ancho: 380, alto: 506, tinta: true },
  telefono: { nombre: t('Teléfono'), ancho: 360, alto: 740, tinta: false },
  tableta: { nombre: t('Tableta'), ancho: 600, alto: 800, tinta: false },
} as const;
type Dispositivo = keyof typeof DISPOSITIVOS;

interface Props {
  libro: Pick<Libro, 'secciones'>;
  seccionId: string;
  version: number;
  onSeccion: (id: string) => void;
}

const CSS_PAGINAS = `
html { height: 100% !important; overflow: hidden !important; }
body { margin: 0 !important; padding: 7vh 7vw !important; box-sizing: border-box !important; height: 100vh !important;
  column-width: 86vw !important; column-gap: 14vw !important; column-fill: auto !important; }
figure img, section.portada img { max-height: 86vh !important; }
`;

export function VistaPrevia({ libro, seccionId, version, onSeccion }: Props) {
  const [disp, setDisp] = useState<Dispositivo>('kindle');
  const [horizontal, setHorizontal] = useState(false);
  const [tamano, setTamano] = useState(100);
  const [pagina, setPagina] = useState(0);
  const [paginas, setPaginas] = useState(1);
  const marco = useRef<HTMLIFrameElement>(null);
  const irAlFinal = useRef(false);
  const d = DISPOSITIVOS[disp];
  const ancho = horizontal ? d.alto : d.ancho;
  const alto = horizontal ? d.ancho : d.alto;
  const indice = libro.secciones.findIndex((s) => s.id === seccionId);

  const medir = () => {
    const doc = marco.current?.contentDocument;
    if (!doc?.documentElement) return;
    const w = doc.documentElement.clientWidth || 1;
    const total = Math.max(1, Math.round(doc.documentElement.scrollWidth / w));
    setPaginas(total);
    const p = irAlFinal.current ? total - 1 : 0;
    irAlFinal.current = false;
    setPagina(p);
    doc.documentElement.scrollLeft = p * w;
  };

  const cargar = () => {
    const doc = marco.current?.contentDocument;
    if (!doc?.head) return;
    const st = doc.createElement('style');
    st.textContent = CSS_PAGINAS + `html { font-size: ${tamano}% !important; }`;
    doc.head.appendChild(st);
    // Los enlaces del índice navegan entre secciones dentro de la vista previa.
    doc.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a');
      const href = a?.getAttribute('href') ?? '';
      const destino = libro.secciones.find((s) => href.startsWith(`${s.id}.xhtml`));
      if (destino) {
        e.preventDefault();
        onSeccion(destino.id);
      }
    });
    const img = Array.from(doc.images);
    Promise.all(img.map((i) => (i.complete ? Promise.resolve() : new Promise((ok) => (i.onload = i.onerror = ok))))).then(() => setTimeout(medir, 30));
  };

  useEffect(() => {
    setPagina(0);
  }, [seccionId]);
  useEffect(() => {
    const doc = marco.current?.contentDocument;
    if (doc?.documentElement) doc.documentElement.scrollLeft = pagina * doc.documentElement.clientWidth;
  }, [pagina]);

  const avanzar = (delta: number) => {
    const p = pagina + delta;
    if (p >= 0 && p < paginas) return setPagina(p);
    const sig = libro.secciones[indice + delta];
    if (!sig) return;
    irAlFinal.current = delta < 0;
    onSeccion(sig.id);
  };

  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') avanzar(1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') avanzar(-1);
    };
    window.addEventListener('keydown', teclas);
    return () => window.removeEventListener('keydown', teclas);
  });

  return (
    <div className="vista-previa">
      <div className="barra-vista">
        <select value={disp} onChange={(e) => setDisp(e.target.value as Dispositivo)} aria-label={t('Dispositivo')}>
          {Object.entries(DISPOSITIVOS).map(([k, v]) => (
            <option key={k} value={k}>{v.nombre}</option>
          ))}
        </select>
        <button onClick={() => setHorizontal(!horizontal)} aria-pressed={horizontal}>{horizontal ? '▭ Horizontal' : '▯ Vertical'}</button>
        <label className="control-tamano">
          {t('Letra')}
          <input type="range" min={70} max={160} step={10} value={tamano} onChange={(e) => setTamano(Number(e.target.value))} aria-label={t('Tamaño de letra')} />
        </label>
      </div>
      <div className="escenario">
        <div className={`dispositivo ${d.tinta ? 'tinta' : ''}`} style={{ width: ancho, height: alto }}>
          <iframe
            key={`${seccionId}-${version}-${tamano}-${disp}-${horizontal}`}
            ref={marco}
            title={t('Vista previa del EPUB')}
            src={`/vista/${seccionId}.xhtml?v=${version}`}
            onLoad={cargar}
            sandbox="allow-same-origin"
          />
        </div>
      </div>
      <div className="pie-vista">
        <button onClick={() => avanzar(-1)} disabled={pagina === 0 && indice <= 0} aria-label={t('Página anterior')}>◀</button>
        <span>
          {t('Sección {0} de {1} · página {2} de {3}', { 0: indice + 1, 1: libro.secciones.length, 2: pagina + 1, 3: paginas })}
        </span>
        <button onClick={() => avanzar(1)} disabled={pagina >= paginas - 1 && indice >= libro.secciones.length - 1} aria-label={t('Página siguiente')}>▶</button>
      </div>
      <p className="ayuda centrado">{t('Es el EPUB real que se exportará. Cada lector pagina un poco distinto.')}</p>
    </div>
  );
}
