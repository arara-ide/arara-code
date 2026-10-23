# Arara Code

IDE baseada em Code-OSS, construída em cima dos scripts do [VSCodium](https://github.com/VSCodium/vscodium).
Este repo não contém código do VS Code: só o VSCodium como submódulo (tag fixa), patches, branding e scripts.

## Instalar

Linux (Ubuntu/Debian, x64). Baixe o `.deb` da [última release](https://github.com/arara-ide/arara-code/releases/latest) e rode:

```bash
sudo apt install ./arara-code_*_amd64.deb
```

Pronto: o Arara Code aparece no menu de aplicativos. No terminal, abra com `arara-code`.

A **Git History** (`donjayamanne.githistory`) vem embutida, com histórico de commits, arquivos e linhas. Para consultar uma linha, use **Git: View Line History**. O build e o modo dev baixam o VSIX do Open VSX, com versão e SHA256 fixados em `extensions.lock.json`.

Para entrar na conta e usar a IA, o backend precisa estar no ar (nesta fase de teste: `localhost:7010`, ver abaixo).

### Atualizar

Quando sai versão nova, aparece o botão **Atualizar** no topo da janela. Ele abre a página da release: baixe o `.deb` novo e rode o mesmo comando. Pode fazer com a IDE aberta: ela percebe o pacote novo e reinicia sozinha em 10 s (dá para adiar). Suas configurações, conversas e arquivos não salvos ficam.

### Desinstalar

```bash
arara-code-uninstall          # remove o programa, mantém suas configurações
arara-code-uninstall --all    # remove tudo, inclusive configurações e conversas
```

Ou: `sudo apt remove arara-code`.

### Sem instalar (.tar.gz)

```bash
mkdir -p ~/arara-code && tar -xzf arara-code-linux-x64-*.tar.gz -C ~/arara-code
~/arara-code/bin/arara-code
```

Para remover, rode `~/arara-code/bin/arara-code-uninstall`.

## Rodar local rapidinho (modo dev)

Pastas lado a lado em `~/Documents/gabs/`: `arara-code`, `arara-ai`, `ac-services`, `ac-web`.

```bash
cd ~/Documents/gabs/arara-code
git submodule update --init
scripts/dev.sh                   # abre a IDE com a extensão ../arara-ai carregada
scripts/dev.sh ~/algum-projeto   # já abre numa pasta
scripts/dev.sh --reset           # perfil limpo (apaga .work/dev-profile)
```

| | Tempo |
|---|---|
| 1ª vez (clone do VS Code + `npm ci` + extensões built-in) | ~10 min, ~9 GB em `.work/` |
| Próximas vezes | **~7 s** até abrir a janela |

O que o `dev.sh` faz: transpila o TypeScript sem typecheck (esbuild), builda a `arara-ai` e abre o Electron apontando para a pasta da extensão (`--extensionDevelopmentPath`). Não minifica nem empacota. O perfil fica isolado em `.work/dev-profile`, então não mexe no seu VS Code.

Mexeu na `arara-ai`? Feche a janela e rode `scripts/dev.sh` de novo, ou use **Developer: Reload Window** (`Ctrl+R`) depois de `npm run build` na extensão.

### Testar o login com o backend

Em outros terminais (detalhes em `ac-docs/docs/09-rodar-local.md`):

```bash
mongod --dbpath ~/.local/arara-mongo --bind_ip 127.0.0.1 &
(cd ../ac-services && npm run start:dev)   # :7010
(cd ../ac-web && npm run dev)              # :7210
```

Na IDE, clique em **Arara: entrar** na barra de status (ou `Ctrl+Shift+P` → *Arara: Entrar*). O navegador abre o ac-web; depois de autorizar, ele volta para um servidor local que a IDE abriu em `127.0.0.1:53682`. Se essa porta estiver ocupada, a IDE tenta 53683…53692 e, por fim, uma porta livre qualquer do sistema. A porta preferida pode ser trocada em `arara.auth.callbackPort`.

## Patches no core

| Patch | O quê |
|---|---|
| `0001-no-welcome-page` | Sem página Welcome: `workbench.startupEditor` = `none`, walkthroughs não abrem ao instalar extensão |
| `0002-start-screen-shortcuts` | Editor vazio vira tela inicial com atalhos clicáveis (abrir pasta, recentes, clonar, comandos, terminal, chat Arara, entrar, tema, atalhos…) |
| `0003-default-settings-keybindings` | Configurações e atalhos padrão do produto (só nativos). Lista em `src/vs/workbench/common/arara.defaults.ts`. Atalhos só em Windows/Linux |
| `0015-ide-update` | Botão "Atualizar" no topo (ao lado do Customize Layout) quando há versão nova, e reinício sozinho quando o `.deb` novo é instalado com a IDE aberta |

Para criar/alterar um patch: edite em `.work/vscodium/vscode`, teste com `scripts/dev.sh` e rode `scripts/new-patch.sh NNNN-nome arquivo…`. Detalhes em `AGENTS.md`.

## Build de release (Linux)

```bash
git submodule update --init
scripts/build.sh                 # ~25 min, ~10 GB em .work/, gera dist/*.deb e dist/*.tar.gz
scripts/build.sh --skip-source   # rebuild reusando o vscode/ já clonado
scripts/prepare.sh               # só clone + patches + branding + npm ci (o que o dev.sh usa)
```

Saída: `.work/vscodium/VSCode-linux-x64/bin/arara-code`.

Para não travar a máquina, limite a memória a 12 GB. Rode como unidade do systemd, assim o build não morre se o terminal fechar:

```bash
systemd-run --user --unit=arara-build --collect -p MemoryHigh=11G -p MemoryMax=12G -p MemorySwapMax=0 \
  -p Nice=10 --working-directory="$PWD" -E HOME="$HOME" -E PATH="$PATH" \
  bash -c 'scripts/build.sh --skip-source > /tmp/arara-build.log 2>&1'
```

Saída em `dist/`: `.deb` e `.tar.gz`. Publicar uma versão: `ac-docs/agents/release/AGENTS.md`.

Requisitos: os mesmos do VSCodium (`upstream/vscodium/docs/howto-build.md`) + `rsync`, `rsvg-convert`, ImageMagick, `curl`, `jq` e `unzip`.
