# Ranca Fundo

Remove o fundo de imagens e gera um PNG transparente. A IA roda no próprio navegador, sem internet.

## Como usar

1. Clique duas vezes em `iniciar.bat` (é preciso ter o [Node.js](https://nodejs.org) instalado).
2. O navegador abre em `http://localhost:8080`.
3. Envie, arraste ou cole (Ctrl+V) uma imagem e clique em **Baixar PNG**.

Abrir o `index.html` direto (duplo clique) não funciona: o navegador bloqueia o carregamento do
modelo de IA em páginas `file://`. Use o `iniciar.bat` ou o link publicado.

**Publicado em:** <https://vitorportela.github.io/ranca-fundo/>

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
| `poster.js` | Pôster em várias folhas e geração do PDF |
| `upscale.js`, `vendor/upscale/` | Ampliação (Lanczos e IA Real-ESRGAN, licença BSD-3) |
| `sw.js`, `manifest.webmanifest` | App instalável e funcionamento offline |
| `server.js`, `iniciar.bat` | Servidor local sem dependências |
| `vendor/background-removal.js` | Biblioteca `@imgly/background-removal` 1.7.0 empacotada |
| `vendor/imgly-data/` | Modelo e arquivos WASM (offline) |

## Licença

AGPL-3.0 (veja `LICENSE`), a mesma licença da biblioteca `@imgly/background-removal` que este projeto inclui.
O código-fonte completo fica público neste repositório, como a AGPL exige. Para usar a biblioteca num produto
comercial de código fechado, é preciso uma licença comercial da IMG.LY.
