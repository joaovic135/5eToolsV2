---
description: Pack Forgotten Adventures (top-down) → mapeamento para o bestiário e DMV 5etools
---

# /fa-topdown-bestiary — Pack FA top-down + cruzamento com o bestiário

Usa o fluxo já implementado no repo: script `tools/generate-fa-token-map.mjs`, dados em `data/hdq/fa-token-map.json`, imagens em `img/hdq/fa-tokens/`. No DMV (`js/render-map.js`) o mapa FA **fundido** com o FREE (`free-creature-token-map.json` + `img/hdq/free-tokens/`): **FA prevalece** na mesma criatura. Listagem usa badge **TD** quando há top-down (FA ou FREE).

Atua como **operador**: corre comandos, confirma ficheiros gerados, e só pede ao utilizador o que faltar (caminho do pack).

## 1. Recolher o caminho do pack

Se a mensagem **não** trouxer o caminho absoluto da pasta raiz do pack (ex.: `C:\Users\...\FA_Tokens` ou `FA_Tokens` extraído), pergunta uma vez.

**Importante:** o script só indexa **`Creatures/`** e **`Adversaries/`** (ignora `Adventurers/`, `NPCs/`, etc.).

## 2. Gerar o mapa nome → ficheiro

Na raiz do repo 5etools:

```bash
node tools/generate-fa-token-map.mjs "<CAMINHO_ABSOLUTO_DA_PASTA_FA_Tokens>"
```

Isto re-lê todos os `data/bestiary/bestiary-*.json`, cruza com os `.png` (etc.) do pack, e grava **`data/hdq/fa-token-map.json`** (`map`: chave = nome normalizado como no bestiário, valor = path relativo a `img/`, ex. `hdq/fa-tokens/Creatures/...`).

- Se o utilizador atualizar o pack FA, **volta a correr** o mesmo comando com o novo caminho.

## 3. Copiar imagens para o site

O JSON aponta para ficheiros sob **`img/hdq/fa-tokens/`**. É preciso copiar do pack **mantendo a estrutura** de pastas:

- Origem: `<FA_Tokens>/Creatures` e `<FA_Tokens>/Adversaries`
- Destino: `img/hdq/fa-tokens/Creatures` e `img/hdq/fa-tokens/Adversaries`

Exemplo (Git Bash; ajustar origem):

```bash
mkdir -p img/hdq/fa-tokens
cp -r "<FA_Tokens>/Creatures" img/hdq/fa-tokens/
cp -r "<FA_Tokens>/Adversaries" img/hdq/fa-tokens/
```

No Windows PowerShell podes usar `Copy-Item -Recurse` em alternativa. O volume é grande (~centenas de MB); não commits por defeito se o repositório não quiser binários.

## 4. Pack FREE (opcional)

Para pastas `FREE_Creature_Tokens_*` em `Pictures/Tokens`, vê o comando [`/free-creature-tokens`](free-creature-tokens.md). O DMV carrega **ambos** os JSON; colisão: **FA ganha**.

## 5. O que **não** é preciso reimplementar

- **Listagem DMV:** badge **TD** quando o mapa fundido tem entrada para o nome normalizado.
- **Add token:** `confirm` top-down vs bestiário quando há arte em `fa-tokens` ou `free-tokens`.
- **Nomes:** normalização partilhada (`RenderMap._normalizeDmvFaCreatureName`).

Só altera `render-map.js` se estiveres a **corrigir bugs** ou a **estender** o contrato (ex.: novo formato JSON).

## 6. Verificação

- `data/hdq/fa-token-map.json` existe e `map` tem entradas (ex.: `"adult blue dragon"`).
- Um PNG referenciado existe em `img/hdq/fa-tokens/...` (testar URL via `Renderer.get().getMediaUrl("img", "<path sem img/>")` no devtools ou carregar no DMV).
- Servidor estático a servir `img/` e `data/` na raiz do projeto.

## 7. Resposta ao utilizador

Resumo em **português**: caminho usado, número de criaturas mapeadas (chaves em `map`), confirmação de cópia para `img/hdq/fa-tokens/`, como testar (DMV → Add Token → criatura com badge **TD** se top-down existir), e lembrete de voltar a correr o gerador quando o pack FA mudar.
