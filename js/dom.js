/**
 * Helpers de consulta ao DOM compartilhados pelos controladores de página.
 * Mantém a aplicação em JavaScript nativo e compatível com hospedagem estática.
 */
export const $ = (selector, root = document) => root.querySelector(selector);

export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
