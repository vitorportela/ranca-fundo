# Ranca Fundo

Remove o fundo de imagens e gera um PNG transparente. A IA roda no próprio navegador, sem internet.

## Como usar

1. Clique duas vezes em `iniciar.bat` (é preciso ter o [Node.js](https://nodejs.org) instalado).
2. O navegador abre em `http://localhost:8080`.
3. Envie, arraste ou cole (Ctrl+V) uma imagem e clique em **Baixar PNG**.

Abrir o `index.html` direto (duplo clique) não funciona: o navegador bloqueia o carregamento do
modelo de IA em páginas `file://`. Use o `iniciar.bat` ou o link publicado.

**Publicado em:** <https://vitorportela.github.io/ranca-fundo/>

## Retocar com lápis

Quando a IA tira demais ou de menos, use **Retocar com lápis** no editor:

- **Lápis**: pinta exatamente por onde passa.
- **Lápis mágico**: basta um risco em cima; o app pega a parte de cor parecida ligada ao risco.
  O **Alcance** controla o quanto ele se espalha.
- Os dois podem **Tirar** ou **Trazer de volta** o que a IA tirou por engano.
- Desfazer (Ctrl+Z) e Refazer; zoom com a roda do mouse ou com dois dedos.

Os retoques ficam guardados por cima do recorte: mudar a borda ou a qualidade não apaga o que foi riscado.
Eles valem para o PNG, o pôster e o foto card.

## Pôster em várias folhas

**Imprimir como pôster** divide a imagem em várias folhas (A4, A3, Carta ou Ofício) e gera um PDF para
imprimir em tamanho grande, seja um pôster ou um boneco de papelão em tamanho real.

- Dá para começar pela tela inicial (**Outras funções → Criar pôster**), que abre a janela do pôster para escolher
  a foto, ou pelo botão dentro do editor, depois de tirar o fundo.
- **Trocar imagem** muda a foto sem fechar a janela e mantém as configurações. Com a janela aberta, arrastar ou
  colar (Ctrl+V) uma imagem também troca a foto do pôster.
- Dá para usar a imagem **sem fundo** ou **com o fundo original**. Se a foto ainda não passou pela IA, o botão
  **Remover o fundo** dentro da janela do pôster faz o recorte; a opção "Sem fundo" libera quando terminar.

- Escolha quantas folhas de largura ou de altura (aceita decimais, como 3,5).
- Folhas que ficariam vazias (só fundo transparente) não são impressas.
- Cada folha sai com um código (A1, A2, B1…), marcas de corte e, se quiser, uma faixa de sobreposição para colar.
- A primeira página é um mapa de montagem com as instruções.

- Ao ampliar, a foto passa por um filtro Lanczos, mais nítido que o redimensionamento do navegador.
- Se a foto for pequena para o tamanho escolhido (menos de 150 dpi), aparece a opção **Melhorar nitidez com IA**:
  o modelo Real-ESRGAN (`realesr-general-x4v3`, ~5 MB, `upscale.js`) recria os detalhes ao ampliar 4×.
  É mais lento (no computador, segundos por folha; no celular, mais) e pode ser cancelado.
  Depois do primeiro uso, funciona offline.

Imprima em **tamanho real (100%)**, sem "ajustar à página".

## Foto cards

**Outras funções → Criar foto card** (ou **Colocar num foto card**, no editor) monta uma folha A4 com 9 photocards
de 5,5 × 8,5 cm, com frente e verso, e gera um PDF de 2 páginas (`cards.js`).

- Toque num card para escolher a foto. Escolhendo várias de uma vez, elas vão para os próximos cards vazios.
  Arrastar ou colar uma imagem com a janela aberta também funciona.
- Arraste para posicionar; zoom pelo slider, pela roda do mouse ou com dois dedos; **Girar** gira 90°.
  **Usar esta foto nos 9 cards** repete a foto (e o ajuste) em todos.
- Verso: **Uma foto por card**, **Espelho da frente** (a foto da frente invertida, como se atravessasse o card)
  ou **Igual em todos**. Na aba "Verso", a prévia mostra a folha virada: o card 1 fica à direita.
- A foto passa 2 mm da linha de corte (sangria), para um pequeno desvio da impressora não deixar borda branca.
  A linha tracejada da prévia é o corte, com cantos arredondados de 3 mm (use um cortador de cantos).
- Marcas de conferência: uma grade 3×3 (quadrados de 2 mm) em dois cantos da frente e um ponto atrás de cada
  uma no verso. Contra a luz, o ponto deve cair no quadrado do meio.

**Alinhar frente e verso:** cada impressora desloca o verso um pouco. **Baixar folha de teste** gera réguas
milimetradas na frente e cruzes vermelhas no verso. Contra a luz, leia onde as cruzes cortam as réguas e digite
os valores em **Ajuste do verso** (fica salvo no aparelho). **Virar a folha pela** escolhe borda maior ou menor,
conforme a impressora.

## Usar no celular

O site é um app instalável (PWA). Ele precisa estar hospedado em HTTPS. Depois do primeiro uso, funciona sem internet.

**Publicar (escolha uma opção):**

- **Netlify (mais fácil):** entre em <https://app.netlify.com/drop> e arraste a pasta inteira do projeto.
  O arquivo `_headers` já configura tudo.
- **GitHub Pages:** num terminal, dentro desta pasta:
  ```
  git init && git add . && git commit -m "Ranca Fundo"
  gh repo create ranca-fundo --public --source . --push
  gh api -X POST repos/{owner}/ranca-fundo/pages -f "source[branch]=main" -f "source[path]=/"
  ```
  O site fica em `https://SEU-USUARIO.github.io/ranca-fundo/` (pode levar uns minutos).
  O GitHub Pages não deixa configurar cabeçalhos, mas o `sw.js` resolve isso sozinho.

**No celular:**

1. Abra o link **com internet** e processe uma foto. Na primeira vez ele baixa o modelo (~45 MB).
2. Instale o app: no **Android**, abra no Chrome e toque no botão **Instalar como app** da tela de abertura
   (ou ⋮ → *Instalar app*). No **iPhone**, abra no Safari e toque em Compartilhar → *Adicionar à Tela de Início*.
3. A partir daí funciona offline. **Salvar / Compartilhar** manda a imagem para a galeria ou para o WhatsApp.

No celular o padrão é a qualidade *Rápida*. Se o recorte ficar ruim, troque para *Alta*
(baixa mais ~88 MB e é mais lenta). Fotos acima de 12 megapixels são reduzidas automaticamente para não travar o aparelho.

## Como funciona

Modelo de IA ISNet rodando via ONNX Runtime Web (WebAssembly ou WebGPU), direto no aparelho.
*Alta* usa `isnet_fp16` (~88 MB) e *Rápida* usa `isnet_quint8` (~44 MB). O slider **Borda** (`edges.js`)
ajusta a suavidade do recorte sem rodar a IA de novo.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html`, `style.css`, `app.js` | Interface |
| `edges.js` | Ajuste de suavidade da borda |
| `retouch.js` | Retoque com lápis e lápis mágico |
| `poster.js` | Pôster em várias folhas e geração do PDF |
| `cards.js` | Foto cards (9 por folha, frente e verso) |
| `upscale.js`, `vendor/upscale/` | Ampliação (Lanczos e IA Real-ESRGAN, licença BSD-3) |
| `sw.js`, `manifest.webmanifest` | App instalável e funcionamento offline |
| `server.js`, `iniciar.bat` | Servidor local sem dependências |
| `vendor/background-removal.js` | Biblioteca `@imgly/background-removal` 1.7.0 empacotada |
| `vendor/imgly-data/` | Modelo e arquivos WASM (offline) |

## Licença

AGPL-3.0 (veja `LICENSE`), a mesma licença da biblioteca `@imgly/background-removal` que este projeto inclui.
O código-fonte completo fica público neste repositório, como a AGPL exige. Para usar a biblioteca num produto
comercial de código fechado, é preciso uma licença comercial da IMG.LY.
