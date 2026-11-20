import { useEffect, useState } from 'react';
import { Accesibilidad } from './Accesibilidad';
import type { Metadatos, Seccion, Tema, Tipografia, RolCredito } from '../../../src/model';
import { ROLES, TIPOS_SECCION } from '../../../src/model';
import type { Estado, Resultado } from '../api';
import { urlRecurso } from '../api';
import { locale, t } from '../i18n';

export type Pestana = 'seccion' | 'libro' | 'tema' | 'impresion' | 'comentarios' | 'validacion';

interface Props {
  estado: Estado;
  seccion?: Seccion;
  pestana: Pestana;
  onPestana: (p: Pestana) => void;
  onSeccion: (cambios: Partial<Seccion>) => void;
  onMetadatos: (cambios: Partial<Metadatos>) => void;
  onTema: (cambios: Partial<Tema>) => void;
  onTipografia: (cambios: Partial<Tipografia>) => void;
  onAplicarTipografia: (todo: boolean) => void;
  validacion?: Resultado | null;
  validando: boolean;
  onValidar: () => void;
  onIrA: (seccion: string) => void;
  panelImpresion: React.ReactNode;
  panelTema: React.ReactNode;
  panelComentarios: React.ReactNode;
  onImagenCabecera: (archivo: File | null) => void;
  onEscritura: (v: 'horizontal' | 'vertical') => void;
  onOptimizar: (activo: boolean) => void;
  version: number;
}

/** Campo de texto que guarda al salir (o tras una pausa), no en cada tecla. */
function Texto(p: { etiqueta: string; valor?: string | number; onGuardar: (v: string) => void; area?: boolean; ayuda?: string; tipo?: string; marcador?: string }) {
  const [v, setV] = useState(String(p.valor ?? ''));
  useEffect(() => setV(String(p.valor ?? '')), [p.valor]);
  const guardar = () => v !== String(p.valor ?? '') && p.onGuardar(v);
  return (
    <label className="campo">
      <span>{p.etiqueta}</span>
      {p.area ? (
        <textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} onBlur={guardar} placeholder={p.marcador} />
      ) : (
        <input type={p.tipo ?? 'text'} value={v} onChange={(e) => setV(e.target.value)} onBlur={guardar} onKeyDown={(e) => e.key === 'Enter' && guardar()} placeholder={p.marcador} />
      )}
      {p.ayuda && <small>{p.ayuda}</small>}
    </label>
  );
}

export function Inspector(p: Props) {
  const m = p.estado.libro.metadatos;
  const tm = p.estado.libro.tema;
  const tip = p.estado.libro.tipografia;
  const abiertos = (p.seccion?.comentarios ?? []).filter((c) => !c.resuelto).length + (p.seccion?.cambios?.length ?? 0);
  const pestanas: [Pestana, string][] = [
    ['seccion', t('Sección')],
    ['libro', t('Libro')],
    ['tema', t('Tema')],
    ['impresion', t('Impresión')],
    ['comentarios', t('Revisión')],
    ['validacion', t('Validación')],
  ];
  return (
    <aside className="inspector" aria-label={t('Inspector')}>
      <div className="pestanas" role="tablist">
        {pestanas.map(([id, nombre]) => (
          <button key={id} role="tab" aria-selected={p.pestana === id} className={p.pestana === id ? 'activa' : ''} onClick={() => p.onPestana(id)}>
            {nombre}
            {id === 'validacion' && p.validacion && !p.validacion.valido ? <span className="punto-error" aria-label="con errores" /> : null}
            {id === 'comentarios' && abiertos > 0 ? <span className="contador" aria-label={`${abiertos} pendientes`}>{abiertos}</span> : null}
          </button>
        ))}
      </div>
      <div className="contenido-inspector" role="tabpanel">
        {p.pestana === 'seccion' && p.seccion && (
          <>
            <Texto etiqueta={t('Título')} valor={p.seccion.titulo} onGuardar={(v) => p.onSeccion({ titulo: v })} />
            <label className="campo">
              <span>{t('Tipo de sección')}</span>
              <select value={p.seccion.tipo} onChange={(e) => p.onSeccion({ tipo: e.target.value as Seccion['tipo'] })}>
                {TIPOS_SECCION.map((x) => (
                  <option key={x.id} value={x.id}>{t(x.nombre)}</option>
                ))}
              </select>
              <small>{t('Define la semántica del EPUB (capítulo, prólogo…) y cómo lo anuncian los lectores de pantalla.')}</small>
            </label>
            <label className="casilla">
              <input type="checkbox" checked={p.seccion.mostrarTitulo} onChange={(e) => p.onSeccion({ mostrarTitulo: e.target.checked })} />
              {t('Mostrar el título en la página')}
            </label>
            <label className="casilla">
              <input type="checkbox" checked={p.seccion.enIndice} onChange={(e) => p.onSeccion({ enIndice: e.target.checked })} />
              {t('Incluir en el índice')}
            </label>
            {!['portada', 'ilustracion', 'indice', 'creditos'].includes(p.seccion.tipo) && (
              <div className="campo">
                <span>{t('Imagen de cabecera')}</span>
                {p.seccion.imagenCabecera ? (
                  <div className="fila-ornamento">
                    <img src={urlRecurso(p.seccion.imagenCabecera, p.version)} alt={t('Imagen de cabecera')} />
                    <button className="pequeno" onClick={() => p.onImagenCabecera(null)}>{t('Quitar')}</button>
                  </div>
                ) : (
                  <label className="boton-archivo">
                    {t('Elegir imagen…')}
                    <input type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImagenCabecera(f); e.target.value = ''; }} />
                  </label>
                )}
                <small>{t('Imagen decorativa sobre el título (una viñeta, un emblema…).')}</small>
              </div>
            )}
            {(p.seccion.tipo === 'ilustracion' || p.seccion.tipo === 'portada') && (
              <label className="casilla">
                <input type="checkbox" checked={!!p.seccion.paginaFija} onChange={(e) => p.onSeccion({ paginaFija: e.target.checked || undefined })} />
                {t('Página fija en el EPUB (la imagen ocupa la pantalla entera; Apple Books y Kobo)')}
              </label>
            )}
            {p.seccion.tipo === 'ilustracion' && (
              <label className="casilla">
                <input type="checkbox" checked={!!p.seccion.doblePagina} onChange={(e) => p.onSeccion({ doblePagina: e.target.checked || undefined })} />
                {t('Doble página enfrentada (PDF; y en el EPUB si es página fija)')}
              </label>
            )}
            <p className="dato">{t('{0} palabras · {1} notas', { 0: (p.estado.palabras[p.seccion.id] ?? 0).toLocaleString(locale()), 1: p.seccion.notas.length })}</p>
            <button onClick={() => p.onAplicarTipografia(false)}>{t('Aplicar tipografía a esta sección')}</button>
          </>
        )}

        {p.pestana === 'libro' && (
          <>
            <Texto etiqueta={t('Título')} valor={m.titulo} onGuardar={(v) => p.onMetadatos({ titulo: v })} />
            <Texto etiqueta={t('Subtítulo')} valor={m.subtitulo} onGuardar={(v) => p.onMetadatos({ subtitulo: v })} />
            <fieldset className="grupo">
              <legend>{t('Créditos')}</legend>
              {m.creditos.map((c, k) => (
                <div key={k} className="fila-credito">
                  <input
                    aria-label={t('Nombre')}
                    defaultValue={c.nombre}
                    onBlur={(e) => {
                      const creditos = [...m.creditos];
                      creditos[k] = { ...c, nombre: e.target.value };
                      p.onMetadatos({ creditos: creditos.filter((x) => x.nombre.trim()) });
                    }}
                  />
                  <select
                    aria-label={t('Función')}
                    value={c.rol}
                    onChange={(e) => {
                      const creditos = [...m.creditos];
                      creditos[k] = { ...c, rol: e.target.value as RolCredito };
                      p.onMetadatos({ creditos });
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                  </select>
                  <button aria-label={t('Quitar crédito')} onClick={() => p.onMetadatos({ creditos: m.creditos.filter((_, j) => j !== k) })}>✕</button>
                </div>
              ))}
              <button className="pequeno" onClick={() => p.onMetadatos({ creditos: [...m.creditos, { nombre: t('Nombre'), rol: m.creditos.length ? 'trl' : 'aut' }] })}>
                {t('+ Añadir crédito')}
              </button>
            </fieldset>
            <div className="fila-dos">
              <Texto etiqueta={t('Serie')} valor={m.serie} onGuardar={(v) => p.onMetadatos({ serie: v })} />
              <Texto etiqueta={t('Volumen')} tipo="number" valor={m.volumen} onGuardar={(v) => p.onMetadatos({ volumen: v ? Number(v) : undefined })} />
            </div>
            <label className="campo">
              <span>{t('Idioma')}</span>
              <select value={m.idioma} onChange={(e) => p.onMetadatos({ idioma: e.target.value })}>
                <option value="es">{t('Español')}</option>
                <option value="es-MX">{t('Español (México)')}</option>
                <option value="es-ES">{t('Español (España)')}</option>
                <option value="en">{t('Inglés')}</option>
                <option value="pt-BR">{t('Portugués (Brasil)')}</option>
                <option value="ja">{t('Japonés')}</option>
              </select>
            </label>
            <label className="campo">
              <span>{t('Escritura')}</span>
              <select value={p.estado.libro.escritura ?? 'horizontal'} onChange={(e) => p.onEscritura(e.target.value as 'horizontal' | 'vertical')}>
                <option value="horizontal">{t('Horizontal')}</option>
                <option value="vertical">{t('Vertical japonesa (tategaki), de derecha a izquierda')}</option>
              </select>
              <small>{t('En vertical, los números de una o dos cifras y «!?» se ponen en horizontal automáticamente, y se incrusta Noto Serif JP con solo los caracteres que usa el libro. El editor, la vista previa y el PDF se ven en vertical.')}</small>
            </label>
            <label className="casilla">
              <input type="checkbox" checked={!!p.estado.libro.optimizarImagenes} onChange={(e) => p.onOptimizar(e.target.checked)} />
              {t('Optimizar las imágenes del EPUB')}
            </label>
            <small className="ayuda">{t('Al exportar, las imágenes de más de 4 Mpx se reducen y los PNG grandes sin transparencia pasan a JPEG. El proyecto y el PDF de impresión conservan las originales.')}</small>
            <Texto etiqueta={t('ISBN o identificador')} valor={m.identificador} onGuardar={(v) => p.onMetadatos({ identificador: v })} ayuda={t('Si no tienes ISBN, deja el UUID que se generó.')} />
            <div className="fila-dos">
              <Texto etiqueta={t('Fecha')} tipo="date" valor={m.fecha} onGuardar={(v) => p.onMetadatos({ fecha: v })} />
              <Texto etiqueta={t('Editorial')} valor={m.editorial} onGuardar={(v) => p.onMetadatos({ editorial: v })} />
            </div>
            <Texto etiqueta={t('Sinopsis')} area valor={m.descripcion} onGuardar={(v) => p.onMetadatos({ descripcion: v })} />
            <Texto etiqueta={t('Derechos')} valor={m.derechos} onGuardar={(v) => p.onMetadatos({ derechos: v })} marcador="© 2026 …" />
            <Texto
              etiqueta={t('Resumen de accesibilidad')}
              area
              valor={m.resumenAccesibilidad}
              onGuardar={(v) => p.onMetadatos({ resumenAccesibilidad: v })}
              ayuda={t('Opcional. Si lo dejas vacío, Obi Studio escribe uno automáticamente.')}
            />
          </>
        )}

        {p.pestana === 'tema' && p.panelTema}

        {p.pestana === 'impresion' && p.panelImpresion}

        {p.pestana === 'comentarios' && p.panelComentarios}

        {p.pestana === 'validacion' && (
          <>
            <p className="ayuda">{t('EPUBCheck 5.4 comprueba el libro con las reglas oficiales de EPUB 3.3. Exportar siempre valida antes.')}</p>
            <button className="principal" onClick={p.onValidar} disabled={p.validando}>
              {p.validando ? t('Validando…') : t('Validar ahora')}
            </button>
            {p.validacion && (
              <div className="resultado-validacion">
                {p.validacion.valido ? (
                  <p className="ok">✓ El EPUB es válido{p.validacion.avisos ? ` (${p.validacion.avisos} avisos)` : ''}.</p>
                ) : (
                  <p className="error">{t('✕ {0} errores, {1} avisos.', { 0: p.validacion.errores, 1: p.validacion.avisos })}</p>
                )}
                {!p.validacion.disponible && <p className="error">{t('No se encontró EPUBCheck o Java.')}</p>}
                <ul className="mensajes">
                  {p.validacion.mensajes.map((x, k) => {
                    const s = p.estado.libro.secciones.find((y) => y.id === x.seccion);
                    return (
                      <li key={k} className={x.gravedad}>
                        <strong>{x.gravedad === 'error' ? t('Error') : t('Aviso')}</strong> {x.mensaje}
                        {s && (
                          <button className="enlace" onClick={() => p.onIrA(s.id)}>
                            {t("Ir a «{0}»", { 0: s.titulo || s.tipo })}{x.linea ? t(', línea {0}', { 0: x.linea }) : ''}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <Accesibilidad onIrA={p.onIrA} />
          </>
        )}
      </div>
    </aside>
  );
}
