/* Eltes — documentation behaviour */
(function () {
  'use strict';

  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const $ = (sel, root = document) => root.querySelector(sel);

  function copy(text) {
    const ok = () => window.EltesSite && window.EltesSite.toast('Copied to clipboard');
    const fail = () => window.EltesSite && window.EltesSite.toast('Copy failed — select the text manually', 'triangle-alert');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(ok, fail);
      return;
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      ok();
    } catch (e) {
      fail();
    }
  }

  /* let wide tables scroll instead of clipping */
  document.querySelectorAll('.doc-table').forEach((table) => {
    if (table.parentElement.classList.contains('table-scroll')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  /* copy buttons on code blocks */
  $$('.doc-code .cpy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pre = btn.closest('.doc-code').querySelector('pre');
      copy(pre.innerText);
      btn.classList.add('copied');
      btn.innerHTML = '<span>Copied</span>';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<span>Copy</span>';
      }, 1500);
    });
  });

  /* sidebar filter — narrows nav links and sections together */
  const search = $('#docsSearch');
  const navLinks = $$('#docsNav a');
  const filterSections = $$('.doc section[id]');
  navLinks.forEach((a) => {
    a.dataset.text = a.textContent.trim().toLowerCase();
  });
  filterSections.forEach((s) => {
    s.dataset.text = s.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
  });
  let none = $('#docsNoResults');
  if (!none) {
    none = document.createElement('div');
    none.id = 'docsNoResults';
    none.className = 'docs-none';
    none.hidden = true;
    none.innerHTML = '<strong>No sections match that filter.</strong><span>Try “keys”, “CORS”, “models”, “accounts” or “tools”. Press Escape to clear.</span>';
    const article = $('.doc');
    if (article) article.appendChild(none);
  }
  const applyFilter = (raw) => {
    const q = raw.trim().toLowerCase();
    let visible = 0;
    navLinks.forEach((a) => {
      const hit = !q || a.dataset.text.includes(q);
      a.classList.toggle('hidden-by-search', !hit);
      if (hit) visible++;
    });
    filterSections.forEach((s) => {
      s.classList.toggle('hidden-by-search', !!q && !s.dataset.text.includes(q));
    });
    if (none) none.hidden = !q || visible > 0;
  };
  if (search) {
    search.addEventListener('input', () => applyFilter(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        search.value = '';
        applyFilter('');
        search.blur();
      }
    });
  }

  /* "/" focuses the filter */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.metaKey || e.ctrlKey) return;
    if (e.key === '/' && search) {
      e.preventDefault();
      search.focus();
    }
  });

  /* scrollspy */
  const sections = $$('.doc section[id]');
  const tocLinks = $$('.toc a');
  const navMap = new Map();
  navLinks.forEach((a) => {
    const id = (a.getAttribute('href') || '').replace('#', '');
    if (id) navMap.set(id, a);
  });
  const tocMap = new Map();
  tocLinks.forEach((a) => {
    const id = (a.getAttribute('href') || '').replace('#', '');
    if (id) tocMap.set(id, a);
  });

  function setActive(id) {
    navLinks.forEach((a) => a.classList.remove('active'));
    tocLinks.forEach((a) => a.classList.remove('active'));
    const n = navMap.get(id);
    if (n) n.classList.add('active');
    const t = tocMap.get(id);
    if (t) t.classList.add('active');
  }

  if ('IntersectionObserver' in window && sections.length) {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
    );
    sections.forEach((s) => io.observe(s));
  }

  /* keep section anchors working with the fixed nav */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 92;
    window.scrollTo({ top, behavior: 'smooth' });
    history.replaceState(null, '', '#' + id);
    setActive(id);
  });
})();
