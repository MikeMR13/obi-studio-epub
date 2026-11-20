// Revisiones rápidas de ortotipografía: búsquedas con expresión regular y su reemplazo, listas para
// revisar en el panel de buscar (se ve cada caso antes de reemplazar).

export interface Revision {
  id: string;
  nombre: string;
  consulta: string;
  reemplazo: string;
}

export const REVISIONES: Revision[] = [
  { id: 'espacios', nombre: 'Espacios dobles', consulta: ' {2,}', reemplazo: ' ' },
  { id: 'antes-signo', nombre: 'Espacio antes de un signo de puntuación', consulta: ' +([,.;:!?…»)\\]])', reemplazo: '$1' },
  { id: 'despues-signo', nombre: 'Falta espacio después de coma o punto y coma', consulta: '([,;])([A-Za-zÁÉÍÓÚÜÑáéíóúüñ¿¡«])', reemplazo: '$1 $2' },
  { id: 'guion-dialogo', nombre: 'Guion al empezar un diálogo (en lugar de raya)', consulta: '^[-–] ?', reemplazo: '—' },
  { id: 'comillas-rectas', nombre: 'Comillas rectas a latinas', consulta: '"([^"\\n]+)"', reemplazo: '«$1»' },
  { id: 'tres-puntos', nombre: 'Tres puntos a puntos suspensivos', consulta: '\\.{3}', reemplazo: '…' },
  { id: 'apertura-pregunta', nombre: 'Pregunta sin signo de apertura', consulta: '(^|[.!?…»]\\s+|—)([A-ZÁÉÍÓÚÑa-záéíóúñ][^¿?.!\\n]{0,80}\\?)', reemplazo: '$1¿$2' },
];
