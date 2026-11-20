import { useEffect, useState } from 'react';
import { api, type Estado } from '../api';
import { aviso, confirmar } from '../dialogos';
import { t } from '../i18n';
import { guardarRevisor, nombreRevisor } from './Comentarios';

type EstadoColaboracion = { activa: boolean; codigo?: string; enlaces: string[]; personas: { nombre: string; color: string; seccion: string }[] };

interface Props {
  onCerrar: () => void;
  onEstado: (e: Estado) => void;
}

/** Activar la colaboración en tiempo real en la red local y ver quién está conectado. */
export function Colaborar({ onCerrar, onEstado }: Props) {
  const [c, setC] = useState<EstadoColaboracion>();
  const [nombre, setNombre] = useState(nombreRevisor());
  const [libro, setLibro] = useState<Estado['libro']>();

  useEffect(() => {
    const leer = () => api.colaboracion().then(setC).catch(() => undefined);
    void leer();
    api.estado().then((e) => setLibro(e.libro)).catch(() => undefined);
    const reloj = window.setInterval(leer, 2000);
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => {
      window.clearInterval(reloj);
      window.removeEventListener('keydown', tecla);
    };
  }, [onCerrar]);

  const activar = async () => {
    try {
      guardarRevisor(nombre.trim());
      const r = await api.iniciarColaboracion();
      setC(r);
      onEstado(r.estado);
    } catch (e) {
      aviso((e as Error).message, 'error');
    }
  };

  const detener = async () => {
    if (!(await confirmar(t('Terminar la colaboración'), t('Las personas conectadas dejarán de poder escribir. Todo lo escrito ya está en el libro.'), t('Terminar')))) return;
    const r = await api.detenerColaboracion();
    setC(r);
    onEstado(r.estado);
  };

  const copiar = (enlace: string) =>
    navigator.clipboard.writeText(enlace).then(
      () => aviso(t('Enlace copiado.')),
      () => aviso(t('No se pudo copiar: selecciona el enlace y cópialo a mano.'), 'error'),
    );

  const seccion = (id: string) => libro?.secciones.find((s) => s.id === id)?.titulo || t('sección sin título');

  return (
    <div className="fondo-dialogo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialogo panel-plugins" role="dialog" aria-modal="true" aria-labelledby="titulo-colaborar">
        <div className="cabecera-plugins">
          <h2 id="titulo-colaborar">{t('Colaborar en la red local')}</h2>
          <button className="cerrar" onClick={onCerrar} aria-label={t('Cerrar')}>✕</button>
        </div>
        <p className="ayuda">
          {t('Otras personas de tu misma red (casa, oficina) pueden escribir a la vez que tú desde su navegador, sin instalar nada. Ven el texto de las secciones y los cursores de los demás; no ven tus archivos ni pueden exportar.')}
        </p>
        {!c?.activa ? (
          <form className="fila-buscar" onSubmit={(e) => { e.preventDefault(); void activar(); }}>
            <input aria-label={t('Tu nombre')} placeholder={t('Tu nombre')} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <button className="principal" type="submit">{t('Empezar a colaborar')}</button>
          </form>
        ) : (
          <>
            <p className="ok">{t('Colaboración activa. Comparte este enlace con quien quieras invitar:')}</p>
            {c.enlaces.map((e) => (
              <div key={e} className="fila-buscar">
                <code className="url-catalogo enlace-invitacion">{e}</code>
                <button onClick={() => copiar(e)}>{t('Copiar')}</button>
              </div>
            ))}
            <p className="ayuda">{t('Cualquiera con el enlace puede editar el texto mientras la colaboración esté activa. Cada vez que la inicias, el código cambia.')}</p>
            <h3 className="titulo-catalogo">{t('Conectados ({0})', { 0: c.personas.length })}</h3>
            <ul className="personas">
              {c.personas.map((p, k) => (
                <li key={k}>
                  <span className="punto-persona" style={{ background: p.color }} /> {p.nombre} <small>· {seccion(p.seccion)}</small>
                </li>
              ))}
            </ul>
            <div className="botones-dialogo">
              <button className="peligro" onClick={detener}>{t('Terminar la colaboración')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
