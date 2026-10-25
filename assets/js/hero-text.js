/* Quiet, accessible hero copy rotation; disabled for reduced-motion preferences. */
(() => {
  'use strict';

  const line = document.getElementById('heroRotatingLine');
  if (!line || typeof window.matchMedia !== 'function') return;

  const phrases = ['Keep your flow.', 'Build with focus.', 'Choose freely.'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let index = 0;
  let interval = 0;
  let transition = 0;

  function stop() {
    if (interval) window.clearInterval(interval);
    interval = 0;
  }

  function rotate() {
    if (document.hidden) return;
    line.classList.add('is-changing');
    transition = window.setTimeout(() => {
      index = (index + 1) % phrases.length;
      line.textContent = phrases[index];
      line.classList.remove('is-changing');
      transition = 0;
    }, 190);
  }

  function start() {
    if (!interval && !document.hidden && !reduceMotion.matches) {
      interval = window.setInterval(rotate, 4200);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  const onMotionChange = (event) => {
    if (event.matches) {
      stop();
      if (transition) window.clearTimeout(transition);
      transition = 0;
      index = 0;
      line.textContent = phrases[0];
      line.classList.remove('is-changing');
    } else start();
  };
  if (typeof reduceMotion.addEventListener === 'function') reduceMotion.addEventListener('change', onMotionChange);
  else if (typeof reduceMotion.addListener === 'function') reduceMotion.addListener(onMotionChange);
  start();
})();
