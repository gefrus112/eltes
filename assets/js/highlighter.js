/* Small dependency-free code highlighter used by chat code fences. */
(function attachHighlighter(root, factory) {
  const api = factory();
  if (root) root.EltesCodeHighlighter = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis, function createHighlighter() {
  'use strict';

  const KEYWORDS = new Set((
    'const let var function return if else for while await async import from export default new class extends ' +
    'try catch finally throw typeof instanceof this super null undefined true false def elif in not and or None ' +
    'True False lambda with as pass raise select where join order by group limit insert update delete create ' +
    'table index on primary key foreign references begin commit rollback pub fn use mut impl struct enum match ' +
    'switch case break continue do interface type public private static void int string bool float echo cd ' +
    'export set local then fi done of is php namespace trait implements protected final abstract readonly global ' +
    'foreach endforeach endif endfor endwhile include include_once require require_once isset empty unset die exit print yield goto'
  ).split(/\s+/));
  const LANGS = /^(js|javascript|jsx|ts|typescript|tsx|json|py|python|bash|sh|shell|zsh|sql|css|html|xml|go|rs|rust|php|yml|yaml|toml|diff|text)$/i;
  const escapeCode = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function highlight(code, lang) {
    if (!lang || !LANGS.test(lang)) return escapeCode(code);
    const src = escapeCode(code);
    const token = /(\/\/[^\n]*|#(?!\[)[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
    return src.replace(token, (match, comment, string, number, word, offset) => {
      if (comment) return `<span class="tok-com">${comment}</span>`;
      if (string) return `<span class="tok-str">${string}</span>`;
      if (number) return `<span class="tok-num">${number}</span>`;
      if (word) {
        if (word.startsWith('$')) return `<span class="tok-var">${word}</span>`;
        if (KEYWORDS.has(word)) return `<span class="tok-key">${word}</span>`;
        const after = src.slice(offset + word.length, offset + word.length + 2);
        if (/^[A-Z]/.test(word)) return `<span class="tok-tag">${word}</span>`;
        if (after.startsWith('(')) return `<span class="tok-fn">${word}</span>`;
      }
      return match;
    });
  }

  return { highlight, LANGS };
});
