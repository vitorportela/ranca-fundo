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
- **Lápis mágico**: basta um risco em cima; o app pega a parte com a cor principal do risco, ligada a ele.
  Se o risco raspar numa área de outra cor (ex.: no preto ao lado do cinza), essa outra cor fica.
  O **Alcance** controla o quanto ele se espalha. Ele para nas bordas (onde a cor muda de repente),
  e, se for pegar mais de 40% da imagem, pergunta antes.
- Os dois podem **Tirar** ou **Trazer de volta** o que a IA tirou por engano.
- O que vai sair aparece **pintado de vermelho com listras** (dá para desligar em "Mostrar em vermelho o que vai sair").
- Desfazer (Ctrl+Z) e Refazer; zoom com a roda do mouse ou com dois dedos.

Os retoques ficam guardados por cima do recorte: mudar a borda ou a qualidade não apaga o que foi riscado.
Eles valem para o PNG, o pôster, o foto card e o sticker.

## Pôster em várias folhas

**Imprimir como pôster** divide a imagem em várias folhas (A4, A3, Carta ou Ofício) e gera um PDF para
imprimir em tamanho grande, seja um pôster ou um boneco de papelão em tamanho real.

- Dá para começar pela tela inicial (**Outras funções → Criar pôster**), que abre a página do pôster para escolher
  a foto, ou pelo botão dentro do editor, depois de tirar o fundo.
- **Trocar imagem** muda a foto sem sair da página e mantém as configurações. Com a página aberta, arrastar ou
  colar (Ctrl+V) uma imagem também troca a foto do pôster.
- Dá para usar a imagem **sem fundo** ou **com o fundo original**. Se a foto ainda não passou pela IA, o botão
  **Remover o fundo** dentro da página do pôster faz o recorte; a opção "Sem fundo" libera quando terminar.

**Tamanho final:**

- **Medida real (cm)**: digite a altura (ou a largura) que a figura deve ter, por exemplo 170 cm para uma pessoa
  em tamanho real. A medida vale só para a parte que aparece (da cabeça aos pés), não para a folha nem para o fundo
  transparente. Com o fundo original, a pessoa é medida pelo recorte da IA e o fundo da foto aumenta junto
  (se a pessoa ocupa metade da foto, 170 cm de pessoa viram 340 cm de foto).
- **Nº de folhas**: quantas folhas de largura ou de altura (aceita decimais, como 3,5).

**Montagem das folhas:**

- **Grade**: folhas alinhadas em linhas e colunas, com código A1, A2, B1…
- **Encaixe livre**: as folhas não precisam ficar alinhadas. O app divide a figura em faixas; cada faixa usa folhas
  em pé ou deitadas e começa onde a figura começa naquela altura, escolhendo a combinação com menos folhas.
  As folhas são numeradas (1, 2, 3…) de cima para baixo. Na grade aparece quantas folhas o encaixe livre economizaria.
  - **Uma folha só para a cabeça**: a primeira folha pega o alto da figura inteiro, centralizado, para o rosto não
    ficar dividido.
  - Na prévia, toque numa folha para selecionar e arraste para mover (ela gruda na borda das vizinhas).
    **Girar folha**, **Pôr folha**, **Tirar folha** e **Arrumar sozinho** (volta ao cálculo automático).
    No computador, as setas movem 1 mm (com Shift, 10 mm) e Delete tira a folha.
  - O que ficar sem folha aparece em vermelho.
  - No PDF todas as páginas saem em pé; a folha deitada vai girada dentro da página.
  - Na margem de cada folha aparece o nome das vizinhas, e um tracejado mostra onde a borda delas encaixa.

- Folhas que ficariam vazias (só fundo transparente) não são impressas.
- Cada folha sai com marcas de corte e, se quiser, uma faixa de sobreposição para colar.
- A primeira página é um mapa de montagem com as instruções.
- **Folhas do PDF** (aba acima da prévia) mostra cada página como vai sair da impressora: papel, margem, marcas e
  textos. Toque numa página para ver grande e passar uma por uma. Depois de gerar, **Abrir PDF** (no computador) abre o
  arquivo de verdade no leitor do navegador.

- Ao ampliar, a foto passa por um filtro Lanczos, mais nítido que o redimensionamento do navegador.
- Se a foto for pequena para o tamanho escolhido (menos de 150 dpi), aparece a opção **Melhorar nitidez com IA**:
  o modelo Real-ESRGAN (`realesr-general-x4v3`, ~5 MB, `upscale.js`) recria os detalhes ao ampliar 4×.
  É mais lento (no computador, segundos por folha; no celular, mais) e pode ser cancelado.
  Depois do primeiro uso, funciona offline.
  Em **Fidelidade à foto**, dá para escolher quanto da IA entra: "Alta fidelidade, baixa resolução"
  (30% IA, 70% ampliação comum) mantém os rostos como na foto; "Equilíbrio fidelidade/resolução" (60%) é o padrão;
  "Baixa fidelidade, alta resolução" usa só a IA, que pode inventar traços em rostos pequenos.

Imprima em **tamanho real (100%)**, sem "ajustar à página".

## Foto cards e bottons

**Outras funções → Foto card e botton** (ou **Colocar num foto card**, no editor) abre a folha A4 (`cards.js`).
No topo, **Folha de** escolhe entre **Foto cards** (9 por folha, 5,5 × 8,5 cm, frente e verso) e **Bottons**.

- Toque num card para escolher a foto. Escolhendo várias de uma vez, elas vão para os próximos vazios.
  Arrastar ou colar uma imagem com a página aberta também funciona.
- Arraste para posicionar; zoom pelo slider, pela roda do mouse ou com dois dedos; **Girar** gira 90°.
  **Usar esta foto nos 9 cards** repete a foto (e o ajuste) em todos; moldura e stickers de cada um ficam.
- Verso: **Uma foto por card**, **Espelho da frente** (a foto e a moldura da frente invertidas, como se
  atravessassem o card) ou **Igual em todos**. Na aba "Verso", a prévia mostra a folha virada: o card 1 fica à direita.
- A foto passa 2 mm da linha de corte (sangria), para um pequeno desvio da impressora não deixar borda branca.
  A linha tracejada da prévia é o corte, com cantos arredondados de 3 mm (use um cortador de cantos).
- Marcas de conferência: uma grade 3×3 (quadrados de 2 mm) na frente e um ponto atrás de cada uma no verso.
  Contra a luz, o ponto deve cair no quadrado do meio.

**Alinhar frente e verso:** cada impressora desloca o verso um pouco. **Baixar folha de teste** gera réguas
milimetradas na frente e cruzes vermelhas no verso. Contra a luz, leia onde as cruzes cortam as réguas e digite
os valores em **Ajuste do verso** (fica salvo no aparelho). **Virar a folha pela** escolhe borda maior ou menor,
conforme a impressora.

### Tela cheia: stickers e moldura

**Tela cheia: stickers e moldura** (abaixo da prévia), ou tocar de novo no card que já está selecionado, abre um
card grande, pensado para o celular (no Android a barra do navegador some). As setas passam de um card para outro,
**Ver verso** troca o lado e o botão de voltar do celular volta para a folha.

- **Foto**: trocar, girar, centralizar e zoom. Arrastar a foto com um dedo; zoom com dois dedos.
- **Stickers**: toque num sticker para colocar no card. Depois, arraste para mover; dois dedos (ou a bolinha
  no canto) mudam o tamanho e giram. A barra de baixo tem **Excluir**, **Duplicar**, **Espelhar**,
  **Para frente** e **Para trás**. **Repetir os stickers deste card em todos** copia os stickers para os outros.
- **Meus stickers**: **Do celular** adiciona qualquer imagem (de preferência PNG sem fundo). No editor, depois de
  tirar o fundo, **Virar sticker** manda a imagem recortada direto para lá. Eles ficam guardados no aparelho.
- **Moldura**: 9 molduras desenhadas pelo app (Lisa, Fina, Dupla, Polaroid, Costura, Bolinhas, Corações, Estrelas,
  Ondinhas), em qualquer cor, e as molduras da pasta. **Usar esta moldura em todos** repete nos outros.
- **Desfazer** (seta no topo, ou Ctrl+Z) desfaz os últimos passos.

**Stickers passando da borda:** em "Impressão frente e verso", marque **Stickers podem passar da borda do card**.
Os cards ficam mais afastados (12 mm em vez de 8) e o sticker pode passar até 5 mm da borda. O que passa ganha uma
borda branca, e uma linha cinza fina contorna o card e o sticker juntos: recorte por ela com tesoura. No verso,
atrás do que passa da borda, fica branco. Com a opção ligada, as marcas de conferência vão para o meio da folha,
entre os cards. Sem ela, a folha fica exatamente como antes.

### Bottons

- **Tamanho** traz os tamanhos comuns (2,5 / 3,2 / 3,8 / 4,4 / 5,8 / 7,6 cm). Cada um tem a **frente** (o que
  aparece no botton) e o **corte** (o círculo maior, que dobra para trás na máquina).
- **Ajuste fino**: digite a frente e o corte em mm para bater com a sua máquina.
- A linha tracejada da prévia é a frente; entre ela e a linha de corte, a imagem dobra para trás. As molduras
  ficam na borda da frente e a cor continua pela parte que dobra.
- O app encaixa quantos couberem no A4, em fileiras alinhadas ou alternadas (ex.: 18 de 3,8 cm, 13 de 4,4 cm,
  8 de 5,8 cm). O PDF tem uma página só, com a linha de corte cinza em volta de cada botton.

### Pasta de enfeites

Coloque stickers em `enfeites/stickers/` e molduras em `enfeites/molduras/` (PNG, WEBP, SVG ou JPG).

- Sticker: de preferência PNG com fundo transparente.
- Moldura PNG: centro transparente, na proporção do card com a sangria (59 × 89 mm, por exemplo 1180 × 1780 px).
  Ela é esticada para cobrir o card até a sangria. No botton, ela cobre o círculo do corte.
- O site lê a lista em `enfeites/lista.json`. O `iniciar.bat` (servidor local) atualiza a lista sozinho;
  para atualizar à mão: `node enfeites/atualizar-lista.js`. Para aparecer no site publicado, envie a pasta e a
  lista atualizada para o GitHub.

### Projeto guardado

Fotos, stickers, molduras e "Meus stickers" ficam guardados no aparelho (IndexedDB), mesmo fechando o app.
**Começar uma folha nova** deixa a folha atual guardada em **Meus projetos** e abre uma vazia.

## Meus projetos

Na tela inicial (**Outras funções → Meus projetos**) ou no botão do topo do pôster e dos foto cards. Lista os pôsteres
e as folhas de foto cards e bottons, com miniatura, tamanho e data. Tocar num projeto continua de onde parou
(a foto, o recorte, as configurações e as folhas mexidas à mão). Dá para **Renomear** e **Excluir**.
Tudo é salvo sozinho, no próprio aparelho (`projects.js` para os pôsteres, `cards.js` para os foto cards).

## Páginas

Pôster, foto cards, retoque e Meus projetos abrem como páginas inteiras (não janelas). A seta no topo volta, e o
"voltar" do celular ou do navegador também (`nav.js`).

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
| `nav.js` | Páginas e o botão "voltar" |
| `projects.js` | Meus projetos (pôsteres guardados e a página de projetos) |
| `poster.js` | Pôster em várias folhas (grade e encaixe livre), visualizador das folhas e geração do PDF |
| `cards.js` | Foto cards (9 por folha, frente e verso), bottons, tela cheia e projeto guardado |
| `deco.js` | Molduras desenhadas e stickers dos foto cards e bottons |
| `enfeites/` | Stickers e molduras da pasta (`lista.json`, `atualizar-lista.js`) |
| `upscale.js`, `vendor/upscale/` | Ampliação (Lanczos e IA Real-ESRGAN, licença BSD-3) |
| `sw.js`, `manifest.webmanifest` | App instalável e funcionamento offline |
| `server.js`, `iniciar.bat` | Servidor local sem dependências |
| `vendor/background-removal.js` | Biblioteca `@imgly/background-removal` 1.7.0 empacotada |
| `vendor/imgly-data/` | Modelo e arquivos WASM (offline) |

## Licença

AGPL-3.0 (veja `LICENSE`), a mesma licença da biblioteca `@imgly/background-removal` que este projeto inclui.
O código-fonte completo fica público neste repositório, como a AGPL exige. Para usar a biblioteca num produto
comercial de código fechado, é preciso uma licença comercial da IMG.LY.
