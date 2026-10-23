# Arara Code

IDE baseada em Code-OSS, construída em cima dos scripts do [VSCodium](https://github.com/VSCodium/vscodium).
Este repo não contém código do VS Code: só o VSCodium como submódulo (tag fixa), patches, branding e scripts.

## Branches e contribuição

A branch estável e padrão é `main`, seguindo a nomenclatura atual do GitHub. O trabalho diário fica em `development`; este é o checkout recomendado no notebook. Branches representam etapas do código, e não ambientes de execução.

| Branch | Origem | Uso e destino |
|---|---|---|
| `main` | — | Código aprovado para distribuição; recebe PRs de `development`, `release/*` ou `hotfix/*`. |
| `development` | `main` | Integração contínua e trabalho diário; recebe funcionalidades e correções. |
| `feature/<assunto>` | `development` | Funcionalidade isolada; PR para `development`. |
| `fix/<assunto>` | `development` | Correção comum; PR para `development`. |
| `release/<versao>` | `development` | Preparação opcional de versão; PR para `main`, seguido de sincronização com `development`. |
| `hotfix/<assunto>` | `main` | Correção urgente de uma versão distribuída; PR para `main` e incorporação também em `development`. |

Somente `main` e `development` são permanentes. Crie as demais quando houver trabalho concreto e remova-as após integrar seus commits. Branches anteriores à adoção deste fluxo são históricas: confira os commits antes de integrar ou excluir.

Para trabalhar no notebook:

```sh
git switch development
git pull --ff-only origin development
# Opcional, para isolar uma tarefa:
git switch -c feature/nome-da-tarefa
```

Trabalho individual pode ser commitado diretamente em `development`. Use Conventional Commits e PRs para promover código a `main`. Após uma promoção ou hotfix, incorpore `main` em `development` por merge, preservando o histórico; não use force push nem mova tags publicadas.

CI de produto executa em `main` e `development`. Releases, tags de distribuição e publicação no registro Docker continuam exclusivas da `main`. Em `development`, os pacotes são disponibilizados somente como **Artifacts do GitHub Actions**, com SHA-256 e retenção de 14 dias; não são releases nem pré-releases e não entram nas consultas dos atualizadores. O workflow de segurança continua analisando PRs destinados a `main` e `development`, além da linha de base em `main`. A `main` é protegida por PR obrigatório e verificações de segurança.

Este repositório é público. Mantenha somente patches, branding e infraestrutura de build aqui. O CI seleciona explicitamente a mesma branch da extensão privada: `development` para testes e `main` para distribuição estável.

## Builds de development

Pushes em `development` executam testes e build. A execução manual também aceita essa branch; o botão **Run workflow** depende da definição com `workflow_dispatch` estar na branch padrão do GitHub. Na aba **Actions**, selecione uma execução bem-sucedida de `development` e baixe o pacote na seção **Artifacts**. É necessário estar conectado ao GitHub e ter acesso de leitura ao repositório. Os arquivos expiram após 14 dias; execute novamente o workflow se precisar de outro pacote. Não há publicação em GitHub Releases, criação de tags ou atualização automática para esses builds.

Os artifacts `arara-code-development-linux` e `arara-code-development-windows` contêm os instaladores/pacotes e `SHA256SUMS`. O build embute `arara-ai` da branch `development`; builds da `main` continuam usando `arara-ai/main`. macOS permanece pausado.

```sh
gh run list -R arara-ide/arara-code --workflow build.yml --branch development --status success
gh run download <RUN_ID> -R arara-ide/arara-code -n arara-code-development-linux -D ./build-development
```

## Conclusão de tarefas e autoria

Uma tarefa em `feature/*`, `feat/*` ou `fix/*` só termina depois de validar e mesclar a branch na branch de destino definida pelo fluxo do repositório. Não deixe trabalho concluído isolado em uma branch: isso dificulta encontrar o código que realmente será distribuído e acumula branches obsoletas.

Após confirmar o merge no remoto, apague a branch temporária no GitHub e localmente (`git branch -d <branch>`) e rode `git fetch --prune`. Habilite a exclusão automática após merge somente com as branches permanentes protegidas contra exclusão. Quando o plano do GitHub não permitir essa proteção, mantenha a exclusão automática desabilitada e remova manualmente apenas branches temporárias já mescladas. Nunca apague uma branch com commits ainda não integrados; informe a pendência ao responsável. Branches permanentes e branches de ambiente são preservadas. Merge de feature encerra a tarefa na linha de desenvolvimento; a promoção para distribuição segue o fluxo de release.

Não cite assistentes, modelos ou serviços de IA como autores ou coautores de commits ou PRs. Não adicione trailers `Co-authored-by` para IA nem assinaturas de ferramentas de IA. A autoria fica com os responsáveis humanos; preserve atribuições humanas legítimas, licenças e avisos de terceiros. Esta regra vale para novos registros e não autoriza reescrever histórico publicado.

## Integração não oficial e responsabilidade pelo uso

O Arara Zap e a integração WhatsApp do Arara Code são projetos independentes, sem afiliação, associação, autorização, patrocínio ou endosso do WhatsApp ou da Meta. A conexão via Baileys usa o WhatsApp Web; não é a API oficial WhatsApp Business Platform. WhatsApp, Meta e demais marcas pertencem aos respectivos titulares.

O uso é por sua conta e risco. Cabe a cada usuário avaliar a adequação da integração, cumprir os termos do WhatsApp, a legislação aplicável e os direitos de terceiros, obter as autorizações necessárias e responder pelas mensagens, dados, comandos e ações executados com sua conta. Os mantenedores não incentivam nem autorizam spam, assédio, vigilância sem consentimento, disparos abusivos ou outras violações desses termos e direitos.

O software é fornecido no estado em que se encontra, sem garantias de funcionamento, disponibilidade, compatibilidade ou continuidade. Mudanças no WhatsApp podem interromper a integração; o uso pode resultar em restrições, suspensão ou banimento da conta. Não há garantia de recuperação da conta, de mensagens ou de dados.

Na máxima extensão permitida pela legislação aplicável e observada a licença de cada componente, autores, contribuidores e mantenedores não assumem responsabilidade por uso indevido, bloqueios de contas, perda de dados, danos diretos ou indiretos, prejuízos ou reclamações decorrentes do uso ou da impossibilidade de uso da integração. Este aviso não exclui responsabilidades que não possam ser afastadas por lei.

Referências de abordagem: [aviso do Baileys](https://github.com/WhiskeySockets/Baileys/blob/master/.github/README.md#disclaimer), [integrações da Evolution API](https://github.com/evolution-foundation/evolution-api#connection-types) e [cláusulas 7 e 8 da licença da Evolution API](https://github.com/evolution-foundation/evolution-api/blob/main/LICENSE). Essas referências não implicam vínculo com esses projetos nem alteram as licenças do Arara.

## Integrações de IA, uso autorizado e aviso de responsabilidade

### Independência, marcas e ausência de endosso

Este é um projeto independente. Referências a Codex, ChatGPT, OpenAI, Claude, Anthropic, Antigravity, Google, Kiro, Amazon, AWS e OpenCode identificam produtos e possíveis formas de interoperabilidade. Não significam afiliação, parceria, representação, certificação, patrocínio, aprovação ou autorização dessas empresas. Nomes, marcas, interfaces, modelos e outros ativos de terceiros pertencem aos respectivos titulares; a licença deste repositório não concede direitos sobre eles.

### Autorização de acesso e termos das plataformas

A disponibilidade de uma integração, um login bem-sucedido, a existência de um CLI, protocolo, SDK ou extensão e o funcionamento técnico de uma conexão não constituem prova de que o provedor autoriza determinada utilização. Cada forma de acesso pode estar sujeita a contratos distintos. Uma permissão para usar um produto, API ou CLI não deve ser interpretada como autorização geral para automatizar sua interface web, extrair conteúdo, redistribuir o serviço ou integrar outro produto.

**Possuir uma assinatura paga, usar apenas a própria conta, não revender acesso e não pretender causar prejuízo não substituem as autorizações necessárias nem afastam, por si só, restrições contratuais ou legais.** Este projeto não declara que toda integração disponível é autorizada pelos provedores, nem oferece parecer ou certificação de conformidade. Não utilize uma modalidade de integração que seja vedada pelos termos aplicáveis à sua conta ou que exija autorização que você não possui.

Antes de conectar um serviço, cabe ao usuário verificar os termos vigentes, as condições do plano, as políticas da organização e as permissões exigidas para o fluxo concreto. Em caso de dúvida, solicite esclarecimento ou autorização ao provedor; diante de proibição ou aviso de descumprimento, interrompa o fluxo afetado. A publicação deste código não altera contratos com terceiros e não vincula seus titulares.

### Finalidade e limites de uso

O projeto destina-se a trabalho autorizado. Não se destina a contornar autenticação, pagamento, cotas, limites de frequência, restrições regionais ou de conta, recusas de segurança, mecanismos de proteção ou decisões de suspensão. Não use múltiplas contas, sessões, provedores ou ferramentas locais para executar uma ação bloqueada ou contornar uma restrição. Não compartilhe credenciais nem forneça acesso à conta de terceiros sem as permissões aplicáveis.

As permissões configuradas no Arara delimitam ações locais; não concedem autorização de um provedor nem direitos sobre sistemas, dados ou conteúdo de terceiros. Assinaturas e pagamentos ao projeto Arara não incluem licenças, créditos ou garantias de acesso a serviços de terceiros, salvo oferta expressa e específica em sentido contrário.

### Contas, custos, conteúdo e supervisão

Cada usuário responde pelas contas que conecta, pelos dados que decide transmitir, pelas permissões que concede e pelo uso que faz dos resultados, na medida de suas obrigações legais e contratuais. Verifique direitos autorais, sigilo, dados pessoais e autorizações da sua organização antes de enviar arquivos, código, mensagens ou conteúdo do terminal. O processamento pelos provedores segue os contratos e políticas de privacidade respectivos.

Revise as ações propostas e os resultados de IA antes de executá-los, publicá-los ou utilizá-los em decisões. Mantenha backups e conceda somente as permissões necessárias. Respostas podem conter erros, código inseguro ou conteúdo que exija revisão de licenças. Limites, cobranças, renovação de assinaturas, avisos, bloqueios e decisões de acesso são administrados pelos respectivos provedores; este projeto não garante reembolso ou recuperação de contas, créditos ou dados por decisões de terceiros.

### Ausência de garantias e limitação de responsabilidade

Na máxima extensão permitida pela legislação aplicável, o software e as integrações são disponibilizados no estado em que se encontram e conforme disponíveis, sem garantias expressas ou implícitas de adequação a uma finalidade, qualidade comercial, não violação de direitos, segurança absoluta, disponibilidade, precisão, compatibilidade ou continuidade. Atualizações de sites, CLIs, políticas ou serviços podem interromper funcionalidades ou exigir alterações e remoção de integrações.

Na mesma extensão, autores, titulares, mantenedores e contribuidores não assumem responsabilidade por danos, perdas ou reclamações decorrentes do uso, mau uso ou impossibilidade de uso do projeto, incluindo perda de dados, lucros ou oportunidades, interrupção de atividades, custos de serviços de terceiros, resultados incorretos, ações automatizadas, acesso indevido decorrente da configuração do usuário e restrições ou encerramento de contas. Essa limitação deve ser interpretada em conjunto com as licenças e os contratos efetivamente aplicáveis, sem excluir obrigações que a lei imponha às próprias pessoas responsáveis pelo projeto.

Este aviso não afasta responsabilidades inderrogáveis, direitos de consumidores ou de terceiros, nem impede autoridades ou titulares de exercerem seus direitos. Não garante imunidade jurídica ao usuário ou aos mantenedores e não transforma uma conduta vedada em autorizada. Não altera a licença de nenhum componente nem substitui eventual contrato específico validamente celebrado.

### Direitos de terceiros e comunicação de problemas

Titulares que identifiquem possível violação podem comunicá-la pelos canais deste repositório, indicando o direito invocado, o componente afetado e os elementos necessários à análise. Não publique credenciais, dados pessoais ou material confidencial em issues públicas. Os mantenedores poderão avaliar o relato e corrigir, restringir ou remover funcionalidades; o recebimento de uma comunicação não constitui reconhecimento de responsabilidade nem promessa de um resultado específico.

### Documentos dos provedores

Consulte os documentos vigentes e aqueles aceitos pela sua conta, inclusive eventuais termos empresariais ou regionais. Esta lista é informativa e não substitui sua leitura:

- OpenAI/Codex/ChatGPT: [Termos de Uso](https://openai.com/policies/terms-of-use/), [termos de serviços](https://openai.com/policies/service-terms/) e [políticas de uso](https://openai.com/policies/usage-policies/).
- Anthropic/Claude: [termos de consumidor](https://www.anthropic.com/legal/consumer-terms) e [termos comerciais](https://www.anthropic.com/legal/commercial-terms).
- Google/Antigravity: [termos adicionais do Antigravity](https://antigravity.google/terms) e [termos do Google](https://policies.google.com/terms).
- Kiro/AWS: [documentos indicados no download do Kiro](https://kiro.dev/downloads/), [AWS Customer Agreement](https://aws.amazon.com/agreement/) e [Service Terms](https://aws.amazon.com/service-terms/).
- OpenCode: [termos de serviço](https://opencode.ai/legal/terms-of-service) e [política de privacidade](https://opencode.ai/legal/privacy-policy). Provedores conectados pelo OpenCode (OpenAI, Anthropic etc.) seguem os próprios termos.

## Instalar

Linux (Ubuntu/Debian, x64). Baixe o `.deb` da [última release](https://github.com/arara-ide/arara-code/releases/latest) e rode:

```bash
sudo apt install ./arara-code_*_amd64.deb
```

Pronto: o Arara Code aparece no menu de aplicativos. No terminal, abra com `arara-code`.

A **Git History** (`donjayamanne.githistory`) vem embutida, com histórico de commits, arquivos e linhas. Para consultar uma linha, use **Git: View Line History**. O build e o modo dev baixam o VSIX do Open VSX, com versão e SHA256 fixados em `extensions.lock.json`.

O **Prettier** (`esbenp.prettier-vscode`) também vem embutido pelo mesmo fluxo. A extensão Arara o define como formatador padrão para JavaScript, JSX (`javascriptreact`), TypeScript e TSX (`typescriptreact`), com `prettier.bracketSameLine: true`, `prettier.trailingComma: "none"`, `prettier.printWidth: 150` e `prettier.experimentalTernaries: true`. Esses defaults ficam em `contributes.configurationDefaults` do `arara-ai/package.json`; podem ser sobrescritos no `settings.json`. Configurações do Prettier no projeto (por exemplo, `.prettierrc`) têm precedência sobre as opções de estilo da IDE.

A formatação ao salvar vem desativada por padrão (`editor.formatOnSave: false`): `Ctrl+S` apenas salva o arquivo. A formatação manual continua disponível; para formatar automaticamente, ative a opção nas configurações do usuário ou do projeto.

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
scripts/dev.sh --no-sandbox --production  # APIs de produção e perfil separado
```

| | Tempo |
|---|---|
| 1ª vez (clone do VS Code + `npm ci` + extensões built-in) | ~10 min, ~9 GB em `.work/` |
| Próximas vezes | **~7 s** até abrir a janela |

O que o `dev.sh` faz: transpila o TypeScript sem typecheck (esbuild), builda a `arara-ai` e abre o Electron apontando para a pasta da extensão (`--extensionDevelopmentPath`). Não minifica nem empacota. O perfil fica isolado em `.work/dev-profile`, então não mexe no seu VS Code.

Com `--production`, API e painel apontam para produção, com perfil em `.work/dev-profile-production` e uma cópia da extensão em `.work/dev-extensions/production/arara-ai`. O manifesto do checkout é preservado. Rode novamente o script para atualizar essa cópia após mudanças. Sem flag, ou com `--local`, usa o modo local. `--reset` limpa o perfil escolhido; `ARARA_DEV_PROFILE` pode substituí-lo. URLs configuradas explicitamente no perfil continuam tendo prioridade sobre os padrões do ambiente.

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

## Revisão e segurança dos PRs

A `main` exige pull request, resolução das conversas de revisão e preservação do histórico (sem force push). A proteção não concede exceção de push direto a administradores ou bots. A configuração inicial permite merge pelo mantenedor único sem exigir a aprovação de uma segunda pessoa; contribuições externas devem ser revisadas pelo mantenedor antes do merge.

O CodeRabbit tem configuração em `.coderabbit.yaml` para resumos e revisão em português. O [GitHub App](https://github.com/apps/coderabbitai) está instalado na organização com acesso a repositórios selecionados; mantenha este público selecionado para receber as revisões. Não autorize acesso aos repositórios privados. O serviço oferece revisão gratuita para projetos open source; confira as condições ao instalar.

Alertas do Dependabot, detecção de segredos e proteção de push com segredos estão habilitados. Análise automática ajuda a detectar vulnerabilidades e alterações suspeitas, mas não certifica ausência de malware, backdoors ou problemas de licença. Alterações em comandos, rede, instaladores, atualizadores e workflows exigem revisão humana cuidadosa.

Os workflows de release não fazem push diretamente na `main`. Prepare mudanças de versão e changelog por PR antes de publicar.

O workflow `PR security` analisa JavaScript/TypeScript e workflows do GitHub Actions com CodeQL (`security-extended`). A revisão de dependências bloqueia dependências novas com vulnerabilidades conhecidas de severidade moderada ou superior. A `main` exige `Security gate` bem-sucedido e resultados do CodeQL sem novos alertas de segurança altos/críticos ou erros que atinjam o bloqueio configurado. Corrija os achados e envie novos commits ao PR para executar novamente.

O workflow usa `pull_request`, permissões mínimas e Actions fixadas por SHA; não instala dependências, não executa scripts do PR e não recebe credenciais de release. PRs de forks podem aguardar autorização do mantenedor para executar Actions. O CodeRabbit comenta e recomenda; a decisão de merge continua com o mantenedor. CodeQL não analisa integralmente shell scripts, arquivos binários ou código contido em patches: essas mudanças precisam de revisão humana.
