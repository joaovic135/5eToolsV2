---
description: Adiciona ou atualiza mapa player com POI → imagem de detalhe (5etools)
---

# /addplayermap — Mapa player + clique num POI abre imagem extra

Atua como **implementador** do padrão descrito em `.cursor/rules/5etools-customization.mdc`. Não pedir ao utilizador para editar `render.js` à mão; faz tu o diff mínimo.

## 1. Recolher dados (pergunta o que faltar)

O utilizador pode já ter colado respostas na mensagem. Se faltar algo, pergunta **uma de cada vez** ou num bloco curto:

| Pergunta | Exemplo | Uso |
|----------|---------|-----|
| **Caminho local da imagem de detalhe** | `C:\Users\brand\Downloads\keep.jpg` | Abre ao clicar no POI; copiar para o repo |
| **Número / ID do ponto de interesse** | `070` | Área no mapa (mesmo id que no DM / `mapRegions.area`); normalizar para comparação case-insensitive |
| **Qual mapa** | Fragmento único do ficheiro **player** no JSON (ex. `008-map-1-1-greenest-player`) **e** `mapParent.id` se souber | Localizar entrada em `data/adventure/adventure-*.json` |
| **Qual aventura** | `HotDQ`, `OotA`, … | Ficheiro `data/adventure/adventure-<slug>.json` e pasta `img/adventure/<PastaImg>/` (a pasta do `href.path` no JSON, ex. `HotDQ`) |

**Nome do ficheiro destino:** derivar do mapa ou pedir confirmação (ex. `greenestKeep.jpg`); deve ser único e sem espaços; manter extensão real do ficheiro fonte.

## 2. Copiar a imagem

Executar no terminal (ajustar caminhos):

```bash
node node/add-player-map-copy.mjs --from "<CAMINHO_ABSOLUTO_ORIGEM>" --dest "adventure/<PastaImg>/<nomeDestino>.<ext>"
```

`--dest` é **relativo à pasta `img/`** (não incluir `img/` no início).

## 3. Código

### Já existe viewer para este mapa player (ex.: HotDQ Greenest)

- Se o POI **já tem polígono** em `RenderMap._…_REGIONS_PARENT`: em `onRegionClick` (ou equivalente), para esse `area` igual ao ID pedido, chamar um opener que use  
  `Renderer.get().getMediaUrl("img", "adventure/<PastaImg>/<nomeDestino>.<ext>")`.
- Se o POI **ainda não existe**: copiar pontos do mapa DM em `adventure-*.json` (`mapRegions` do parent) para o array frozen em `render-map.js` e escalar com a função `_scale…` já existente.
- Evitar duplicar janelas: reutilizar o mesmo padrão que `_pOpenHotdqGreenestKeepMap` (novo `_pOpen…` só se o título/tooling da janela for diferente) ou generalizar para `_pOpenDetailMap(evt, { title, href })` **só se** fizer sentido com diff pequeno.

### Mapa player novo (ainda sem bloco dedicado)

Implementar o playbook completo na regra: constantes parent W/H, `REGIONS_PARENT`, `get…PlayerMapData`, `pShow…PlayerViewer`, sub-mapa ou ramos em `onRegionClick`, `_renderImage_is…` / `_renderImage_get…`, faixa de título + `ptAdventureBookMeta`, botão viewer, classe `ve-rd__image-title-inner--before-viewer-btn` se houver título + botão.

## 4. Verificação

- `getMediaUrl` path coincide com o ficheiro em `img/adventure/...`.
- Detecção do player usa **`href.path` + `mapParent.id`**, não só `imageType`.
- Correr `npm run build:css` apenas se alterares `scss`.

## 5. Resposta ao utilizador

Resumo em português: ficheiros tocados, comando de cópia usado, ID do POI, path interno da imagem, como testar na aventura.
