// Atualiza enfeites/lista.json com as imagens das pastas stickers/ e molduras/.
// O site lê essa lista para mostrar os enfeites (a hospedagem não deixa listar pastas).
// Roda sozinho ao abrir o iniciar.bat. Para rodar à mão: node enfeites/atualizar-lista.js
const fs = require('fs');
const path = require('path');

const EXT = /\.(png|webp|svg|jpe?g|gif)$/i;

function listar(pasta) {
  try {
    return fs.readdirSync(path.join(__dirname, pasta))
      .filter((n) => EXT.test(n) && !n.startsWith('.'))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  } catch { return []; }
}

function atualizar() {
  const lista = { stickers: listar('stickers'), molduras: listar('molduras') };
  const texto = JSON.stringify(lista, null, 2) + '\n';
  const arq = path.join(__dirname, 'lista.json');
  let antes = '';
  try { antes = fs.readFileSync(arq, 'utf8'); } catch { /* ainda não existe */ }
  if (antes !== texto) fs.writeFileSync(arq, texto);
  return lista;
}

module.exports = atualizar;
if (require.main === module) {
  const l = atualizar();
  console.log(`enfeites/lista.json: ${l.stickers.length} stickers, ${l.molduras.length} molduras`);
}
