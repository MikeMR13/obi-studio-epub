// Dónde empiezan los capítulos cuando el documento tiene títulos h1 y h2.

const CAPITULO = /^(cap[ií]tulo|cap\.|chapter|ch\.|pr[oó]logo|prologue|ep[ií]logo|epilogue|interludio|interlude|intermedio|extra|especial|historia corta|side ?story|afterword|palabras del autor|第.{1,6}[章話]|序章|終章|プロローグ|エピローグ|\d+\s*[.:)\-–—]|[IVXLC]+\s*[.:)\-–—])/i;
/** Capítulos numerados (sin prólogo, epílogo ni extras, que también pueden ser h1 junto a partes). */
const NUMERADO = /^(cap[ií]tulo|cap\.|chapter|ch\.|第.{1,6}[章話]|\d+\s*[.:)\-–—]|[IVXLC]+\s*[.:)\-–—])/i;
const PARTE = /^(volumen|vol\.|tomo|parte|part\b|libro|book|arco|arc\b|temporada|第.{1,6}[部巻])/i;

/**
 * Corte de capítulos que parece correcto según los textos de los títulos:
 * - «h2» si los h2 son los capítulos («Capítulo 1»…) y los h1 no, si los h1 son partes o volúmenes,
 *   o si solo hay un h1 (el título del libro o de la parte) y varios h2;
 * - «h1» en los demás casos (h1 = capítulos, h2 = escenas o apartados dentro del capítulo).
 */
export function corteSugerido(h1: string[], h2: string[]): 'h1' | 'h2' {
  const limpios = (l: string[]) => l.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const a = limpios(h1);
  const b = limpios(h2);
  if (b.length < 2) return 'h1';
  const parte = (l: string[], re: RegExp) => (l.length ? l.filter((t) => re.test(t)).length / l.length : 0);
  const capH1 = parte(a, NUMERADO);
  const capH2 = parte(b, CAPITULO);
  // Los h2 parecen capítulos y los h1 no son capítulos numerados (si lo son, los h2 son apartados: «Interludio»…).
  if (capH2 >= 0.5 && capH1 < 0.5) return 'h2';
  if (a.length <= 1) return 'h2';
  if (a.some((t) => PARTE.test(t)) && capH1 < 0.5 && b.length > a.length) return 'h2';
  return 'h1';
}
