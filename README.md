# Arara Code

Editor de código com IA, feito a partir do [VSCodium](https://github.com/VSCodium/vscodium).
Este repositório não guarda o código do VS Code. Ele tem só o VSCodium (como submódulo, em versão fixa), os patches, a marca e os scripts de build.

## Instalar

**Linux (Ubuntu/Debian, x64):** baixe o `.deb` da [última release](https://github.com/arara-ide/arara-code/releases/latest) e rode:

```bash
sudo apt install ./arara-code_*_amd64.deb
```

O Arara Code aparece no menu de aplicativos. No terminal, abra com `arara-code`.

**Linux sem instalar (AppImage):**

```bash
chmod +x AraraCode-linux-x64-*.AppImage
./AraraCode-linux-x64-*.AppImage
```

Se der erro de FUSE, abra com `APPIMAGE_EXTRACT_AND_RUN=1 ./AraraCode-linux-x64-<versão>.AppImage`.

**Linux sem instalar (.tar.gz):**

```bash
mkdir -p ~/arara-code && tar -xzf arara-code-linux-x64-*.tar.gz -C ~/arara-code
~/arara-code/bin/arara-code
```

**Windows:** use `AraraCodeSetup-x64-<versão>.exe`. O ZIP serve para uso portátil. Se você usava o antigo UserSetup, feche o Arara Code, desinstale a versão antiga nas Configurações do Windows (seus dados ficam guardados) e depois rode o instalador novo.

**macOS:** baixe o DMG do seu processador: `darwin-arm64` para Apple Silicon (M1, M2…) ou `darwin-x64` para Intel.

Para entrar na conta e usar a IA, o backend precisa estar rodando. Nesta fase de testes ele fica em `localhost:7010` (veja abaixo).

### O que já vem instalado

- **Git History:** histórico de commits, arquivos e linhas. Para ver uma linha, use **Git: View Line History**.
- **Prettier:** formatador padrão de JavaScript e TypeScript (incluindo JSX e TSX). Um `.prettierrc` no projeto tem prioridade.
- **vscode-icons:** tema de ícones ativado por padrão.

Salvar (`Ctrl+S`) não formata o arquivo. Se quiser isso, ative `editor.formatOnSave` nas configurações.

As versões dessas extensões ficam fixas em `extensions.lock.json`. Os padrões ficam no `arara-ai/package.json` e podem ser trocados no seu `settings.json`.

### Atualizar

O botão **Atualizar** aparece quando a versão nova já foi baixada e conferida. O que acontece depende de como você instalou:

- **`.deb`:** abre um terminal com `sudo apt install`. Depois a IDE reinicia sozinha. Você pode adiar.
- **AppImage:** mostra o arquivo novo. Feche a IDE, troque o arquivo antigo pelo novo (mesmo nome e lugar) e abra de novo.
- **`.tar.gz`:** mostra o arquivo novo para você trocar a pasta.
- **Windows instalado:** abre o instalador.
- **Windows portátil:** mostra o ZIP novo. Troque a pasta e mantenha a pasta `data`.
- **Microsoft Store:** abre a página do app na Store.
- **macOS:** depois que você confirma, a IDE fecha, troca o app em Aplicativos e abre de novo.

Suas configurações e conversas continuam lá.

### Desinstalar

```bash
arara-code-uninstall          # remove o programa e mantém suas configurações
arara-code-uninstall --all    # remove tudo, inclusive configurações e conversas
```

Ou: `sudo apt remove arara-code`. Na versão `.tar.gz`: `~/arara-code/bin/arara-code-uninstall`.

## Rodar em modo dev

Deixe as pastas lado a lado em `~/Documents/gabs/`: `arara-code`, `arara-ai`, `ac-services` e `ac-web`.

```bash
cd ~/Documents/gabs/arara-code
git submodule update --init
scripts/dev.sh                            # abre a IDE com a extensão ../arara-ai
scripts/dev.sh ~/algum-projeto            # já abre numa pasta
scripts/dev.sh --reset                    # começa com perfil limpo
scripts/dev.sh --no-sandbox --production  # usa as APIs de produção
```

A primeira vez leva uns 10 minutos e ocupa cerca de 9 GB em `.work/`. Depois disso, abre em uns 7 segundos.

O perfil de dev fica em `.work/dev-profile` e não mexe no seu VS Code. Mudou algo na `arara-ai`? Rode `npm run build` nela e use **Developer: Reload Window** (`Ctrl+R`), ou rode `scripts/dev.sh` de novo.

### Testar o login

Em outros terminais (mais detalhes em `ac-docs/docs/09-rodar-local.md`):

```bash
mongod --dbpath ~/.local/arara-mongo --bind_ip 127.0.0.1 &
(cd ../ac-services && npm run start:dev)   # porta 7010
(cd ../ac-web && npm run dev)              # porta 7210
```

Na IDE, clique em **Arara: entrar** na barra de status. O navegador abre, você autoriza e volta para a IDE.

## Build de release (Linux)

```bash
git submodule update --init
scripts/build.sh                 # ~25 min, ~10 GB; gera dist/*.deb e dist/*.tar.gz
scripts/build.sh --skip-source   # reaproveita o código já baixado
scripts/prepare.sh               # só prepara o código (o que o dev.sh usa)
```

Para não travar o computador, limite a memória em 12 GB:

```bash
systemd-run --user --unit=arara-build --collect -p MemoryHigh=11G -p MemoryMax=12G -p MemorySwapMax=0 \
  -p Nice=10 --working-directory="$PWD" -E HOME="$HOME" -E PATH="$PATH" \
  bash -c 'scripts/build.sh --skip-source > /tmp/arara-build.log 2>&1'
```

Precisa dos mesmos requisitos do VSCodium (`upstream/vscodium/docs/howto-build.md`), mais `rsync`, `rsvg-convert`, ImageMagick, `curl`, `jq` e `unzip`. Como publicar uma versão: `ac-docs/agents/release/AGENTS.md`.

## Patches

| Patch | O que faz |
|---|---|
| `0001-no-welcome-page` | Tira a página de boas-vindas |
| `0002-start-screen-shortcuts` | Tela inicial com atalhos (abrir pasta, recentes, chat Arara, entrar…) |
| `0003-default-settings-keybindings` | Configurações e atalhos padrão. Lista em `src/vs/workbench/common/arara.defaults.ts` |
| `0015-ide-update` | Botão "Atualizar" no topo e reinício automático após atualizar |

Para criar ou mudar um patch: edite em `.work/vscodium/vscode`, teste com `scripts/dev.sh` e rode `scripts/new-patch.sh NNNN-nome arquivo…`. Detalhes em `AGENTS.md`.

## Branches

- `main`: versão estável, que vai para os usuários.
- `development`: trabalho do dia a dia.
- `feature/<assunto>` e `fix/<assunto>`: saem de `development` e voltam para ela.
- `hotfix/<assunto>`: correção urgente. Sai de `main` e volta para `main` e `development`.

Use Conventional Commits. Apague a branch temporária depois do merge. Não cite IA como autora ou coautora de commits e PRs.

## Builds e releases

- **`main`:** gera e publica as releases de Linux, Windows e macOS. Cada plataforma publica sozinha, então uma falha não trava as outras.
- **`development`:** gera pacotes de teste em **Actions → Artifacts**. Eles duram 14 dias, não viram release e não chegam aos usuários.

Baixar um build de development:

```sh
gh run list -R arara-ide/arara-code --workflow build.yml --branch development --status success
gh run download <RUN_ID> -R arara-ide/arara-code -n arara-code-development-linux -D ./build-development
```

## Segurança

Os PRs passam por CodeQL, revisão de dependências e CodeRabbit. Dependabot e detecção de segredos estão ligados. Isso ajuda, mas não garante código sem falhas. Mudanças em instaladores, atualizadores, rede e workflows precisam de revisão humana.

## Avisos legais

### WhatsApp

O Arara Zap e a integração com WhatsApp não são oficiais. Não têm ligação com o WhatsApp nem com a Meta. A conexão usa o WhatsApp Web (via Baileys), não a API oficial.

O uso é por sua conta e risco. Você é responsável por seguir os termos do WhatsApp e a lei, e pelas mensagens enviadas com a sua conta. Não use para spam, assédio ou vigilância. O WhatsApp pode restringir ou banir sua conta, e não há garantia de recuperar conta, mensagens ou dados.

### Integrações de IA

O Arara é independente. Citar Codex, ChatGPT, OpenAI, Claude, Anthropic, Antigravity, Google, Kiro, AWS ou OpenCode não quer dizer parceria, apoio ou autorização dessas empresas. As marcas são dos seus donos.

Uma integração funcionar não quer dizer que o provedor permite aquele uso. Ter assinatura paga ou usar só a sua conta também não garante isso. Antes de conectar um serviço, leia os termos dele. Se for proibido, não use.

Não use o Arara para burlar login, pagamento, limites, bloqueios ou regras de segurança. Não compartilhe credenciais. Revise o que a IA faz antes de usar o resultado: ela pode errar ou gerar código inseguro. Você responde pelas contas que conecta e pelos dados que envia.

Termos dos provedores:

- OpenAI: [Termos de Uso](https://openai.com/policies/terms-of-use/), [termos de serviços](https://openai.com/policies/service-terms/), [políticas de uso](https://openai.com/policies/usage-policies/).
- Anthropic: [consumidor](https://www.anthropic.com/legal/consumer-terms), [comercial](https://www.anthropic.com/legal/commercial-terms).
- Google/Antigravity: [Antigravity](https://antigravity.google/terms), [Google](https://policies.google.com/terms).
- Kiro/AWS: [Kiro](https://kiro.dev/downloads/), [AWS Customer Agreement](https://aws.amazon.com/agreement/), [Service Terms](https://aws.amazon.com/service-terms/).
- OpenCode: [termos](https://opencode.ai/legal/terms-of-service), [privacidade](https://opencode.ai/legal/privacy-policy).

### Sem garantias

O software é entregue como está, sem garantia de funcionar, de ficar disponível ou de continuar existindo. Até onde a lei permite, os autores e mantenedores não respondem por perda de dados, bloqueio de contas, custos ou outros danos causados pelo uso. Este aviso não tira direitos que a lei garante e não muda as licenças dos componentes.

Achou algum problema de direitos ou marcas? Avise pelos canais deste repositório, sem publicar senhas ou dados pessoais.
