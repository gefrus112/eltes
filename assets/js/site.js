/* Eltes — shared site behaviour (marketing pages) */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------------------------------- nav --------------------------------- */
  const nav = $('#nav');
  const onScroll = () => {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 12);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const toggle = $('#navToggle');
  const menu = $('#mobileMenu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.innerHTML = window.EltesIcons.icon(open ? 'x' : 'menu', { size: 20 });
    });
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a')) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.innerHTML = window.EltesIcons.icon('menu', { size: 20 });
      }
    });
  }

  /* -------------------------------- reveal -------------------------------- */
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  /* ------------------------------ card glow ------------------------------- */
  $$('.card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    });
  });

  /* --------------------------------- year --------------------------------- */
  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* -------------------------------- toasts -------------------------------- */
  function toast(message, icon = 'check') {
    let stack = $('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${window.EltesIcons.icon(icon, { size: 15 })}<span>${message}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 2400);
  }
  window.EltesSite = { toast };

  /* -------------------------- copy buttons (docs) ------------------------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.dataset.copy;
    const done = () => {
      toast('Copied to clipboard');
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1400);
    };
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      } catch (e) {
        toast('Copy failed — select the text manually', 'triangle-alert');
      }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  });
})();
