// Barra de andamento fixa embaixo da tela, por cima de tudo, enquanto algum processo está rodando
// (tirar o fundo, gerar PDF, ampliar com IA…). Cada processo tem um nome; com vários ao mesmo tempo,
// mostra o último que começou.
(function () {
  'use strict';

  const bar = document.createElement('div');
  bar.className = 'gprog';
  bar.hidden = true;
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.innerHTML = '<div class="gprog-row"><span class="gprog-text"></span><span class="gprog-pct"></span></div>' +
    '<div class="gprog-track"><div class="gprog-fill"></div></div>';
  const text = bar.querySelector('.gprog-text');
  const pct = bar.querySelector('.gprog-pct');
  const fill = bar.querySelector('.gprog-fill');
  document.body.appendChild(bar);

  const jobs = new Map(); // nome -> { label, frac }
  let hideTimer = 0;

  function render() {
    const last = [...jobs.values()].pop();
    if (!last) return;
    clearTimeout(hideTimer);
    bar.hidden = false;
    document.body.classList.add('gprog-on');
    text.textContent = last.label || 'Processando…';
    const known = Number.isFinite(last.frac);
    bar.classList.toggle('gprog-indet', !known);
    if (known) {
      const p = Math.round(Math.min(1, Math.max(0, last.frac)) * 100);
      fill.style.width = p + '%';
      pct.textContent = p + '%';
      bar.setAttribute('aria-valuenow', String(p));
    } else {
      fill.style.width = '';
      pct.textContent = '';
      bar.removeAttribute('aria-valuenow');
    }
    bar.setAttribute('aria-valuetext', text.textContent);
  }

  // frac: 0 a 1, ou null quando não dá para saber quanto falta
  function set(name, frac, label) {
    const j = jobs.get(name) || {};
    jobs.delete(name); // vai para o fim: passa a ser o que aparece
    jobs.set(name, { label: label != null ? label : j.label, frac: frac != null ? frac : null });
    render();
  }

  function done(name) {
    if (!jobs.delete(name)) return;
    if (jobs.size) { render(); return; }
    // chega a 100% e some
    fill.style.width = '100%';
    hideTimer = setTimeout(() => {
      bar.hidden = true;
      document.body.classList.remove('gprog-on');
      fill.style.width = '0';
    }, 350);
  }

  window.RancaProgress = { set, done };
})();
