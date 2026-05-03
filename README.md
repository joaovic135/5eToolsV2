# 5etools (fork local)

Site estático com ferramentas para D&D 5e. Para desenvolver ou usar localmente, serve os ficheiros por HTTP (abrir o `index.html` diretamente no disco costuma falhar por políticas do browser e por caminhos relativos).

## Requisitos

- **Node.js** 24 ou superior (ver `engines` em `package.json`)
- Opcional: espelho completo da pasta **`img/`** (mapas, ícones, etc.) — sem isso, muitas imagens não carregam; neste fork o `.gitignore` permite versionar só `img/adventure/HotDQ/`

## Instalação

Na raiz do projeto:

```bash
npm install
```

## Executar o projeto (recomendado)

O repositório já inclui um script com `http-server` (cache desligada e CORS ativo):

```bash
npm run serve:dev
```

Abre no browser:

- **http://127.0.0.1:5050/** — página inicial (`index.html`)
- **http://127.0.0.1:5050/adventure.html** — aventuras (ex.: HotDQ)
- **http://127.0.0.1:5050/book.html** — livros

Para parar o servidor: `Ctrl+C` no terminal.

### HTTPS local (opcional)

```bash
npm run serve:dev:tls
```

Usa a porta **5051** e certificados em `certs-dev-only/` (apenas para desenvolvimento).

## Alternativa sem Node

Se só quiseres servir ficheiros estáticos:

```bash
# Python 3
python -m http.server 5050
```

Abre **http://127.0.0.1:5050/** . Nota: não replica as flags `--cors` do `serve:dev`; para a maioria das páginas basta.

## Build completo (opcional)

Para gerar dados/CSS/service worker como no fluxo upstream (demorado, só necessário se alterares SCSS, geradores ou quiseres `sw.js` de produção):

```bash
npm run build
```

Para o dia a dia a ler conteúdo e testar JS/HTML, **`npm run serve:dev`** após `npm install` é suficiente.

## Testes e lint (mantenedores)

```bash
npm test
npm run lint
```

## Mapas custom (HotDQ)

URLs `file:///` em `data/adventure/adventure-hotdq.json` ou em `js/render-map.js` **não funcionam** se o site for servido por `http://localhost` — o browser bloqueia mistura de origens. Usa ficheiros sob `img/adventure/HotDQ/` e `href` do tipo `internal`, ou mantém tudo em `file://` (menos prático).

## Licença

MIT — ver `package.json` e histórico upstream.
