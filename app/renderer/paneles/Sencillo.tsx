import { useState } from 'react';
import { api, descargar, ErrorApi, urlRecurso, type Estado, type ResumenConversion } from '../api';
import { aviso } from '../dialogos';
import { t } from '../i18n';

interface Props {
  resumen: ResumenConversion;
  estado: Estado;
  onEstado: (e: Estado) => void;
  /** Abrir el libro en el editor completo. */
  onEditor: () => void;
  onInicio: () => void;
}

/** Conversión sencilla: revisar lo esencial y exportar, con el diseño del archivo original. */
export function Sencillo({ resumen, estado, onEstado, onEditor, onInicio }: Props) {
  const m = estado.libro.metadatos;
  const [titulo, setTitulo] = useState(m.titulo);
  const [autor, setAutor] = useState(m.creditos.find((c) => c.rol === 'aut')?.nombre ?? '');
  const [ocupado, setOcupado] = useState('');
  const [errores, setErrores] = useState<string[]>([]);
  const portada = estado.libro.recursos.find((r) => r.id === m.portada);

  const guardarMeta = async () => {
    const creditos = [...m.creditos.filter((c) => c.rol !== 'aut'), ...(autor.trim() ? [{ nombre: autor.trim(), rol: 'aut' as const }] : [])];
    try {
      onEstado(await api.metadatos({ titulo: titulo.trim() || m.titulo, creditos }));
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const exportar = async (ruta: string, texto: string, hecho: string) => {
    setOcupado(texto);
    setErrores([]);
    try {
      await descargar(ruta);
      aviso(hecho);
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 409) {
        const d = e.datos as { mensajes?: { mensaje: string }[] } | undefined;
        setErrores((d?.mensajes ?? []).slice(0, 8).map((x) => x.mensaje));
      }
      aviso((e as Error).message, 'error');
    } finally {
      setOcupado('');
    }
  };

  return (
    <div className="sencillo">
      <div className="caja-sencillo">
        <header>
          <h1>{t('Conversión sencilla')}</h1>
          <button className="enlace" onClick={onInicio}>{t('Volver al inicio')}</button>
        </header>
        <div className="ficha-sencillo">
          {portada ? <img src={urlRecurso(portada.id)} alt={t('Portada')} /> : <div className="sin-portada">{t('Sin portada')}</div>}
          <div className="datos-sencillo">
            <label className="campo">
              <span>{t('Título')}</span>
              <input value={titulo} onChange={(e) => setTitulo(e.target.value)} onBlur={guardarMeta} />
            </label>
            <label className="campo">
              <span>{t('Autor o autora')}</span>
              <input value={autor} onChange={(e) => setAutor(e.target.value)} onBlur={guardarMeta} />
            </label>
            <ul className="resumen-sencillo">
              <li>{t('Secciones de texto: {0}', { 0: resumen.capitulos })}</li>
              <li>{t('Ilustraciones: {0} · imágenes en total: {1}', { 0: resumen.ilustraciones, 1: resumen.imagenes })}</li>
              <li>{t('Notas al pie: {0}', { 0: resumen.notas })}</li>
              {resumen.conservado.length > 0 && <li className="ok">{t('Del diseño original: {0}', { 0: resumen.conservado.join(', ') })}</li>}
            </ul>
          </div>
        </div>
        {resumen.avisos.length > 0 && (
          <details className="avisos-sencillo">
            <summary>{t('Avisos al convertir: {0}', { 0: resumen.avisos.length })}</summary>
            <ul>
              {resumen.avisos.map((a, k) => (
                <li key={k}>{a}</li>
              ))}
            </ul>
          </details>
        )}
        {errores.length > 0 && (
          <ul className="mensajes">
            {errores.map((x, k) => (
              <li key={k} className="error">{x}</li>
            ))}
          </ul>
        )}
        {ocupado && <p className="ayuda" role="status">{ocupado}</p>}
        <div className="botones-sencillo">
          <button className="principal grande" disabled={!!ocupado} onClick={() => exportar('/api/exportar', t('Creando y validando el EPUB…'), t('EPUB creado y validado.'))}>
            {t('Convertir a EPUB')}
          </button>
          <button disabled={!!ocupado} onClick={() => exportar('/api/exportar-kepub', t('Creando el KEPUB…'), t('KEPUB creado.'))}>{t('KEPUB para Kobo')}</button>
          <button disabled={!!ocupado} onClick={() => exportar('/api/exportar-pdf?tipo=digital', t('Compaginando el PDF digital…'), t('PDF digital creado.'))}>{t('PDF digital')}</button>
        </div>
        <p className="pie-sencillo">
          {t('Se conservan el texto, los formatos, las notas y las imágenes del original.')}{' '}
          <button className="enlace" onClick={onEditor}>{t('Abrir en el editor completo')}</button>
        </p>
      </div>
    </div>
  );
}
