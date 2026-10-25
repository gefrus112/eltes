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
  const LUA_KEYWORDS = new Set('and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(/\s+/));
  const JAC_KEYWORDS = new Set('ability architype async await by can check disengage else elif entry enum except finally for has if impl import include init let match module node obj object report return spawn try type walker with yield'.split(/\s+/));
  const LANGS = /^(js|javascript|jsx|ts|typescript|tsx|json|py|python|bash|sh|shell|zsh|sql|css|html|xml|go|rs|rust|php|lua|jac|jaclang|yml|yaml|toml|diff|text)$/i;
  const escapeCode = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function highlightLua(src) {
    const token = /--\[(=*)\[([\s\S]*?)\]\1\]|--[^\n]*|\[(=*)\[([\s\S]*?)\]\3\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g;
    return src.replace(token, (match, ...rest) => {
      const offset = rest[rest.length - 2];
      if (match.startsWith('--')) return `<span class="tok-com">${match}</span>`;
      if (match.startsWith('[') || match.startsWith('"') || match.startsWith("'")) return `<span class="tok-str">${match}</span>`;
      if (/^\d/.test(match)) return `<span class="tok-num">${match}</span>`;
      if (LUA_KEYWORDS.has(match)) return `<span class="tok-key">${match}</span>`;
      if (src.slice(offset + match.length).trimStart().startsWith('(')) return `<span class="tok-fn">${match}</span>`;
      return match;
    });
  }

  function highlight(code, lang) {
    if (!lang || !LANGS.test(lang)) return escapeCode(code);
    const src = escapeCode(code);
    if (lang.toLowerCase() === 'lua') return highlightLua(src);
    const token = /(\/\/[^\n]*|#(?!\[)[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
    return src.replace(token, (match, comment, string, number, word, offset) => {
      if (comment) return `<span class="tok-com">${comment}</span>`;
      if (string) return `<span class="tok-str">${string}</span>`;
      if (number) return `<span class="tok-num">${number}</span>`;
      if (word) {
        if (word.startsWith('$')) return `<span class="tok-var">${word}</span>`;
        if (KEYWORDS.has(word) || (/^jac(?:lang)?$/i.test(lang) && JAC_KEYWORDS.has(word))) return `<span class="tok-key">${word}</span>`;
        const after = src.slice(offset + word.length, offset + word.length + 2);
        if (/^[A-Z]/.test(word)) return `<span class="tok-tag">${word}</span>`;
        if (after.startsWith('(')) return `<span class="tok-fn">${word}</span>`;
      }
      return match;
    });
  }

  return { highlight, LANGS };
});
