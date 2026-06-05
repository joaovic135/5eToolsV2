# 5eToolsV3 — app desktop (Electron)

Shell **Electron** (`electron-vite`) que abre o **site legacy 5etools** (incluindo `adventure.html`, Dynamic Map Viewer, dados em `data/`, etc.) via um **servidor HTTP local** em `127.0.0.1`, sem precisar de `http-server` na LAN.

Também inclui (opcional) shell **React** + **SQLite** para ferramentas — a janela principal padrão é o **mirror legacy**.

## Comandos rápidos

Sempre a partir de `apps/desktop`:

| O que fazer | Comando |
|-------------|---------|
| **Instalar deps + compilar `better-sqlite3` para o Electron** (obrigatório após `npm install` ou ao mudar a versão do Electron) | `npm install` e em seguida `npm run rebuild:native` |
| **Rodar o app em desenvolvimento** (abre o adventure legacy) | `npm run dev` |
| **Só compilar** main/renderer para `out/` | `npm run build` |
| **Pré-visualizar build** (Electron + `out/`) | `npm run preview` |
| **Copiar o mirror 5etools** para `resources-staging/5etools-mirror` (antes do `.exe`) | `npm run pack:mirror` |
| **Gerar instalador/portátil** (mirror + build + electron-builder) | `npm run dist` |
| **Smoke test** do pacote Windows sem instalador (pasta `release/win-unpacked`) | `npm run pack:mirror`, depois `npm run build`, depois `npx electron-builder --dir --win` |
| **Indexar JSON no SQLite** (opcional) | `npm run index:data` |

## Requisitos

- Node.js ≥ 24 (alinhado ao repositório raiz).
- No Windows: **Visual Studio Build Tools** (C++) para compilar `better-sqlite3` para o Electron (`npm run rebuild:native`).
- Para **`npm run dist`**: se o build falhar com symlink / `winCodeSign`, o `package.json` já usa `signAndEditExecutable: false` e `CSC_IDENTITY_AUTO_DISCOVERY=false` no script `dist`. Em alguns PCs ainda pode ser preciso **Modo de desenvolvedor** ou **CMD como administrador** (ver issues do electron-builder).

## Instalação

```bash
cd apps/desktop
npm install
npm run rebuild:native
```

## Uso diário (desenvolvimento)

```bash
npm run dev
```

A app sobe o servidor estático na **raiz do repositório 5etools** (dois níveis acima de `apps/desktop`) e abre **`/adventure.html#hotdq,1`** por padrão.

### Variáveis de ambiente (URL inicial)

| Variável | Exemplo | Efeito |
|----------|---------|--------|
| `FIVETOOLS_ROOT` | `D:\5etools-src` | Raiz do mirror (onde está `adventure.html`). |
| `FIVETOOLS_START_URL` | `http://127.0.0.1:9999/adventure.html#hotdq,1` | URL completa (ignora path/hash abaixo). |
| `FIVETOOLS_START_PATH` | `/adventure.html` | Caminho no servidor local. |
| `FIVETOOLS_START_HASH` | `hotdq,1` ou `#hotdq,1` | Hash da página. |
| `FIVETOOLS_OPEN_REACT_SHELL` | `1` | Abre também a janela React (ferramentas / SQLite). |
| `FIVETOOLS_STATIC_PORT` | `45281` | Porta do servidor HTTP do mirror (por defeito **45281**, estável entre arranques para o `localStorage` — tokens/assets do DMV). |

## Build e executável

1. Copiar o mirror 5etools para `resources-staging/5etools-mirror` (demora se `data/` for grande):

   ```bash
   npm run pack:mirror
   ```

   Opcional: `FIVETOOLS_ROOT` apontando para outra pasta.

2. Compilar o main/renderer e gerar instalador/portátil:

   ```bash
   npm run dist
   ```

   Saída em `release/`. No app **empacotado**, o mirror vem de `resources/5etools-mirror` (`process.resourcesPath`).

3. Smoke test sem instalador:

   ```bash
   npm run pack:mirror
   npm run build
   npx electron-builder --dir --win
   ```

## Comportamento técnico

- **Servidor estático:** `serve-static` + `finalhandler`, só em **127.0.0.1**, porta **fixa por defeito (45281)** para o mesmo `localStorage` entre sessões; se estiver ocupada, usa porta efémera (ver aviso no terminal).
- **Janela principal:** sem `preload` (site legacy puro). **`setWindowOpenHandler`** (e `browser-window-created`) permite popups do DMV / `window.open` com as mesmas `webPreferences` seguras.
- **GPU:** `enable-gpu-rasterization` (+ `CanvasOopRasterization` no Windows).

### Avisos no Windows (dev)

- Se no `npm run dev` aparecer **`Unable to move the cache` / `Gpu Cache Creation failed`**, em geral é cache do Chromium sem permissão; se a janela carregar o site, pode ignorar. Se atrapalhar, tente **CMD/PowerShell como administrador** ou ative o **Modo de desenvolvedor** (Windows).
- Se a porta **5173** estiver ocupada, o Vite do renderer usa outra (ex. **5174**); o Electron continua recebendo a URL certa via `ELECTRON_RENDERER_URL`.

## SQLite e indexação (opcional)

Banco padrão: `apps/desktop/user-data/5etoolsv2.db`.

```bash
npm run index:data
```

Usa `ELECTRON_RUN_AS_NODE=1` para a mesma ABI do `better-sqlite3` que o Electron. Depois de `npm rebuild better-sqlite3` para Node puro, rode de novo `npm run rebuild:native`.

## Shell React / projeção

IPC `desktopApi` continua disponível se você abrir a janela React (`FIVETOOLS_OPEN_REACT_SHELL=1` ou fluxo futuro). Projeção em segundo monitor segue o código React existente.

## Checklist manual (DMV / aventura)

1. **Inicialização:** HotDQ cap. 1 carrega; sumário e conteúdo.
2. **Mapa DM:** Dynamic Viewer; pan/zoom; cliques em regiões; janelas de área.
3. **DMV:** tokens; busca de criaturas no mapa.
4. **Mapas player / popouts** (ex. Greenest): `window.open` / Shift conforme `js/render.js` e `js/render-map.js`.
5. **Imagens:** `img/adventure/...` carregam via host local.

## Estrutura relevante

| Caminho | Função |
|---------|--------|
| `src/main/five-static-server.ts` | HTTP estático do mirror |
| `src/main/index.ts` | Janela legacy, IPC, servidor, projector React |
| `src/main/paths.ts` | `getRepoRoot`, `getMirrorRoot`, `getDbPath` |
| `scripts/pack-mirror.mjs` | Cópia do repo para `resources-staging/5etools-mirror` |
| `scripts/index-data.mjs` | Indexação SQLite (opcional) |

O repositório raiz (`js/`, `data/`, HTML) é o **conteúdo** servido pela app; o fork em `apps/desktop` só adiciona o shell Electron.
