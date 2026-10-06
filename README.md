# Arara Code

IDE baseada em Code-OSS, construída em cima dos scripts do [VSCodium](https://github.com/VSCodium/vscodium).
Este repo não contém código do VS Code: só o VSCodium como submódulo (tag fixa), patches, branding e scripts.

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

Para criar/alterar um patch: edite em `.work/vscodium/vscode`, teste com `scripts/dev.sh` e rode `scripts/new-patch.sh NNNN-nome arquivo…`. Detalhes em `AGENTS.md`.

## Build de release (Linux)

```bash
git submodule update --init
scripts/build.sh                 # ~15 min, ~10 GB em .work/, pico ~13 GB de RAM
scripts/build.sh --skip-source   # rebuild reusando o vscode/ já clonado
scripts/prepare.sh               # só clone + patches + branding + npm ci (o que o dev.sh usa)
```

Saída: `.work/vscodium/VSCode-linux-x64/bin/arara-code`.

Para não travar a máquina, limite a memória:

```bash
systemd-run --user --scope -p MemoryHigh=12G -p MemoryMax=13G nice -n 10 scripts/build.sh --skip-source
```

Requisitos: os mesmos do VSCodium (`upstream/vscodium/docs/howto-build.md`) + `rsync`, `rsvg-convert`, ImageMagick.
