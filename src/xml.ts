export function esc(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escAttr(texto: string): string {
  return esc(texto).replace(/"/g, '&quot;');
}

/** Quita caracteres que XML 1.0 no admite. */
export function limpiarXml(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}
