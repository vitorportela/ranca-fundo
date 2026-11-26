// Páginas do app (pôster, foto cards, retoque, projetos): cada uma entra no histórico do navegador,
// assim o "voltar" do celular (ou do navegador) fecha a página em vez de sair do app.
(function () {
  'use strict';

  const stack = [];   // páginas abertas, a de cima por último: { name, onBack }
  let skip = 0;       // popstate causados pelo próprio app (ao fechar pelo botão)
  let pending = 0, timer = 0;

  // onBack(): chamado quando a pessoa aperta "voltar". Devolva false para não fechar.
  function push(name, onBack) {
    stack.push({ name, onBack });
    try { history.pushState({ ranca: name }, ''); } catch { /* sem histórico */ }
  }

  // A página foi fechada pelo app: tira do histórico também (junta vários fechamentos seguidos).
  function pop(name) {
    let i = -1;
    for (let j = stack.length - 1; j >= 0; j--) if (stack[j].name === name) { i = j; break; }
    if (i < 0) return;
    pending += stack.length - i;
    stack.splice(i);
    if (!timer) {
      timer = setTimeout(() => {
        const n = pending;
        pending = 0; timer = 0;
        if (!n) return;
        skip++;
        history.go(-n);
      }, 0);
    }
  }

  window.addEventListener('popstate', () => {
    if (skip > 0) { skip--; return; }
    const top = stack.pop();
    if (!top) return;
    if (top.onBack() === false) push(top.name, top.onBack); // não pôde fechar agora
  });

  const isOpen = (name) => stack.some((s) => s.name === name);
  // página de cima (o Esc e os atalhos de teclado valem só para ela)
  const top = () => (stack.length ? stack[stack.length - 1].name : '');
  window.RancaNav = { push, pop, isOpen, top };
})();
