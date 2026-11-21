// Idiomas del corrector ortográfico (sin dependencias de Node: lo usa también la interfaz).

export const IDIOMAS_CORRECTOR: { codigo: string; nombre: string; variantes: string[] }[] = [
  { codigo: 'es', nombre: 'Español', variantes: ['es', 'es-419', 'es-ES', 'es-MX'] },
  { codigo: 'en', nombre: 'Inglés', variantes: ['en-US', 'en-GB', 'en'] },
  { codigo: 'pt', nombre: 'Portugués', variantes: ['pt-BR', 'pt-PT', 'pt'] },
  { codigo: 'fr', nombre: 'Francés', variantes: ['fr', 'fr-FR'] },
  { codigo: 'it', nombre: 'Italiano', variantes: ['it', 'it-IT'] },
  { codigo: 'de', nombre: 'Alemán', variantes: ['de', 'de-DE'] },
  { codigo: 'ca', nombre: 'Catalán', variantes: ['ca', 'ca-ES'] },
];

/** Diccionarios disponibles que corresponden a unos idiomas (los primeros de cada idioma que existan). */
export function diccionariosPara(idiomas: string[], disponibles: string[]): string[] {
  const r: string[] = [];
  for (const i of idiomas) {
    const base = i.toLowerCase().split('-')[0];
    const def = IDIOMAS_CORRECTOR.find((x) => x.codigo === base);
    const candidatos = [i, ...(def?.variantes ?? [])];
    for (const c of candidatos) if (disponibles.includes(c) && !r.includes(c)) r.push(c);
  }
  return r;
}
