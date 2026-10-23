# AGENTS.md — repo `arara-code` (build e branding da IDE)

Este arquivo vai na raiz do repo `arara-code`. Leia também o AGENTS.md geral.

## O que este repo é

Scripts que transformam o VSCodium (submódulo em `upstream/vscodium`, tag fixa) no Arara Code. **Não há código de IA aqui.** Estrutura e fluxo em `ac-docs/docs/03-organizacao-git.md` (workspace de planejamento).

## O que você pode mexer

- `patches/code/*.patch` — mudanças no Code-OSS.
- `patches/vscodium/*.patch` — mudanças nos scripts do VSCodium (evitar).
- `branding/` — `product.overlay.json`, ícones.
- `extensions.lock.json` — versão + sha256 do `.vsix` do `arara-ai`.
- `scripts/`, `.github/workflows/`.

## O que você NÃO mexe

- Nada dentro de `vscode/` ou `upstream/vscodium/` é commitado. Editou lá? Gere o patch com `scripts/new-patch.sh NNNN-nome arquivo…`.
- Não aponte o submódulo para um commit solto; só tags de release do VSCodium.
- Não adicione `extensionsGallery` do Visual Studio Marketplace (viola os termos). Só Open VSX.

## Regras para patches

- Nome: `NNNN-descricao-curta.patch`, ordem importa.
- Cabeçalho obrigatório: o que faz, por que não dá pra fazer via extensão, arquivos do upstream que toca.
- Um patch = um assunto. Mantenha o diff mínimo; não reformatar código do upstream.
- Patch que lida com processos, caminhos ou rede precisa de revisão de segurança.

## Comandos

```bash
scripts/dev.sh                       # modo dev: abre a IDE com ../arara-ai em ~7 s (use isto no dia a dia)
scripts/prepare.sh                   # clone + patches + branding + npm ci, sem compilar
scripts/build.sh                     # build de release (~15 min, ~10 GB, pico ~13 GB de RAM)
scripts/build.sh --skip-source       # reusa vscode/ existente
scripts/new-patch.sh 0003-xyz src/vs/…/arquivo.ts   # gera/atualiza patch a partir de .work/vscodium/vscode
```

Fluxo para mudar o core: edite em `.work/vscodium/vscode`, teste com `scripts/dev.sh`, rode `scripts/new-patch.sh`, confira o cabeçalho do patch e depois `scripts/prepare.sh --skip-source` para provar que ele aplica do zero. `bump-upstream.sh` ainda não existe (trocar a tag do submódulo à mão numa branch `upstream/<versão>`).

## Pronto quando

- `scripts/build.sh` termina sem `.rej` e o binário abre com nome/ícone do Arara, chat no painel direito e Open VSX funcionando.
- CI verde nas 3 plataformas.
