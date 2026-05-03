---
description: Packs FREE_Creature_Tokens_* + Tarrasque (Pictures/Tokens) → bestiário e DMV
---

# /free-creature-tokens — Pack FREE top-down + cruzamento com o bestiário

Descobre automaticamente todas as pastas `FREE_Creature_Tokens_<número>` e `FREE_Epic_Creatures_Tarrasque` sob uma raiz (tipicamente `Pictures/Tokens`), gera `data/hdq/free-creature-token-map.json`, e serve imagens a partir de `img/hdq/free-tokens/<nome_da_pasta>/...`.

No DMV, o mapa **FREE** funde-se com o **FA** (`fa-token-map.json`): **a mesma criatura usa a arte FA se existir nos dois** (FA prevalece).

Atua como **operador**: corre o script, indica cópia para `img/hdq/free-tokens/`, e aponta para verificação.

## 1. Caminho da raiz

Se faltar, pedir a pasta **pai** que contém `FREE_Creature_Tokens_01`, …, `FREE_Creature_Tokens_68`, e `FREE_Epic_Creatures_Tarrasque` (ex.: `C:\Users\brand\Pictures\Tokens`).

## 2. Gerar o JSON

Na raiz do repo:

```bash
node tools/generate-free-creature-token-map.mjs "<CAMINHO_RAIZ_TOKENS>"
```

Gera **`data/hdq/free-creature-token-map.json`** (`map`: chave normalizada → path tipo `hdq/free-tokens/FREE_Creature_Tokens_12/...`).

## 3. Copiar packs para o site

Para **cada** pasta descoberta, copiar a pasta inteira para `img/hdq/free-tokens/` **com o mesmo nome**:

Exemplo (Git Bash; **na raiz do repo**; ajustar `SRC` se precisares):

O glob tem de ser na pasta **origem**, não no diretório atual — caso contrário o `*` não expande e o `cp` vê um path literal inexistente.

```bash
SRC="/c/Users/brand/Pictures/Tokens"
mkdir -p img/hdq/free-tokens
shopt -s nullglob
for d in "$SRC"/FREE_Creature_Tokens_* "$SRC"/FREE_Epic_Creatures_Tarrasque; do
  [ -d "$d" ] && cp -r "$d" img/hdq/free-tokens/
done
```

**PowerShell** (equivalente):

```powershell
$src = "C:\Users\brand\Pictures\Tokens"
New-Item -ItemType Directory -Force -Path "img\hdq\free-tokens" | Out-Null
Get-ChildItem -Path $src -Directory | Where-Object { $_.Name -match '^FREE_Creature_Tokens_\d+$' -or $_.Name -eq 'FREE_Epic_Creatures_Tarrasque' } | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination "img\hdq\free-tokens\$($_.Name)" -Recurse -Force
}
```

Ou cópia manual pasta a pasta. O volume é grande.

## 4. Relação com o pack FA

- Correr também [`/fa-topdown-bestiary`](fa-topdown-bestiary.md) se usares Forgotten Adventures.
- Colisão de nome: entrada em `fa-token-map.json` **substitui** a do FREE no DMV.

## 5. Verificação

- `data/hdq/free-creature-token-map.json` e `_meta.packsScanned` listam os packs encontrados.
- DMV → Add Token: criaturas mapeadas mostram badge **TD**; ao adicionar, prompt top-down vs bestiário.

## 6. Resposta ao utilizador

Resumo em português: raiz usada, número de packs, entradas em `map`, comando de cópia, nota FA > FREE, como testar.
