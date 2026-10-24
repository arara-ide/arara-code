## Código: sem comentários e sem duplicação (obrigatório)

- Não escreva comentários no código (`//`, `/* */`, `#`, `<!-- -->`, JSDoc, docstrings). Nomes, tipos e estrutura devem explicar o código. Ao editar um trecho, não acrescente comentário.
- Se uma explicação for necessária (motivo de uma decisão, pegadinha de plataforma, contexto histórico), registre em `ac-docs/docs/36-notas-de-codigo.md`, na seção do repo, citando arquivo e símbolo. Nunca deixe a explicação no repositório.
- Exceções: avisos de licença e copyright exigidos, o cabeçalho de justificativa dos patches em `patches/code/` e diretivas com efeito técnico (shebang, `@ts-expect-error`, `eslint-disable`, pragmas).
- Não repita código. Antes de escrever uma função, procure uma equivalente e reutilize; lógica que aparece em mais de um lugar vira uma função compartilhada.

## Internacionalização e localização — obrigatório

- Toda interface deve oferecer português (`pt-BR`/`pt`), inglês (`en`) e espanhol (`es`), com mensagens em arquivos de tradução estruturados. Toda alteração futura em texto visível exige atualizar os três catálogos na mesma mudança, inclusive títulos, comandos, configurações, validações, notificações, estados vazios e nomes acessíveis.
- Não misture idiomas, concatene fragmentos traduzidos nem traduza identificadores, comandos, caminhos, marcas, conteúdo do usuário ou contratos de ferramentas. Use mensagens completas com parâmetros; preserve os mesmos parâmetros e chaves nos três idiomas e trate plurais quando necessário.
- Datas, horas, números, percentuais e moedas seguem o locale efetivo com `Intl`; moeda, fuso e valores dos dados não mudam com o idioma. Não fixe `pt-BR` em formatadores da interface.
- Verifique paridade de chaves/parâmetros, fallback e variantes regionais, além dos testes/builds pertinentes. Catálogo incompleto ou texto ainda fixo deve ser informado como pendência, nunca declarado traduzido.
- No core, preserve o padrão nativo `localize`/`localize2` do Code-OSS e os pacotes de idioma. Mensagens próprias do Arara precisam de catálogos complementares versionados nos três idiomas, integrados ao preparo/build. Mudanças do upstream continuam somente em `patches/code/`; não introduza lógica privada no core.

- Catálogos e validação: `locales/{en,pt,es}.json`; gere `patches/code/0032-arara-localization.patch` com `node scripts/generate-localization.cjs` e verifique com `node scripts/tests/localization.cjs`. O build exige o patch atualizado.

# AGENTS.md — repo `arara-code` (build e branding da IDE)

Este arquivo vai na raiz do repo `arara-code`. Leia também o AGENTS.md geral.

## O que este repo é

Scripts que transformam o VSCodium (submódulo em `upstream/vscodium`, tag fixa) no Arara Code. **Não há código de IA aqui.** Estrutura e fluxo em `ac-docs/docs/03-organizacao-git.md` (workspace de planejamento).

## Propriedade intelectual: o mínimo possível aqui

Este repo é **open source**: todo patch fica público. Quanto menos lógica na IDE e mais no `arara-ai` (fechado), melhor.

- Antes de criar ou crescer um patch, prove que a API de extensão (inclusive proposed) não resolve.
- Quando o patch for inevitável, ele só abre o ponto de extensão: um item de menu, uma context key, um gancho que chama um comando `arara.*`. Regras de negócio, heurísticas, textos de produto, parsers de CLIs e tudo que faz a IA funcionar ficam na extensão. Exemplo: no `0015-ide-update` o patch só desenha o botão e reinicia; quem decide se há versão nova e para onde o botão leva é a `arara-ai`.
- Nunca colocar no patch nomes de modelos, prompts, URLs internas ou detalhes do `ac-services`.

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
- Antes de concluir alterações em patches, execute `node scripts/tests/patches.cjs` e `node scripts/tests/localization.cjs`. Preserve LF nos `.patch` conforme `.gitattributes`; não ajuste a contagem de linhas de um hunk sem conferir o arquivo realmente aplicado pelo Git.

## Comandos

```bash
scripts/dev.sh --no-sandbox          # modo dev: abre a IDE com ../arara-ai em ~7 s (use isto no dia a dia)
scripts/prepare.sh                   # clone + patches + branding + npm ci, sem compilar
scripts/build.sh                     # build de release (~15 min, ~10 GB, pico ~13 GB de RAM)
scripts/build.sh --skip-source       # reusa vscode/ existente
scripts/new-patch.sh 0003-xyz src/vs/…/arquivo.ts   # gera/atualiza patch a partir de .work/vscodium/vscode
```

Fluxo para mudar o core: edite em `.work/vscodium/vscode`, teste com `scripts/dev.sh`, rode `scripts/new-patch.sh`, confira o cabeçalho do patch e depois `scripts/prepare.sh --skip-source` para provar que ele aplica do zero. `bump-upstream.sh` ainda não existe (trocar a tag do submódulo à mão numa branch `upstream/<versão>`).

## Pronto quando

- `scripts/build.sh` termina sem `.rej` e o binário abre com nome/ícone do Arara, chat no painel direito e Open VSX funcionando.
- CI verde nas 3 plataformas.

## Fluxo de branches

Por orientação explícita do usuário em 16/10/2026, este repositório segue a seção **Branches e contribuição** do README. Esta regra substitui a orientação geral antiga de desenvolver somente na `main`.

- `main`: linha estável e padrão do GitHub; promoção por PR.
- `development`: trabalho diário e checkout do notebook.
- `feature/*` e `fix/*`: saem de `development` e voltam para ela.
- `release/*`: preparação opcional, de `development` para `main`.
- `hotfix/*`: sai de `main` e deve ser incorporada em `main` e `development`.
- Não publicar releases a partir de branches de desenvolvimento, apagar branches históricas sem verificar seus commits ou reescrever o histórico. Builds de `development` são entregues exclusivamente como Artifacts, conforme autorização do usuário em 16/10/2026.
- Commit e push continuam dependendo de autorização do usuário. Esta política não altera os fluxos dos repositórios `ac-*`.

## Encerramento e autoria

- Ao concluir trabalho em uma branch temporária, valide, mescle na branch de destino e confirme o merge no remoto. Uma tarefa não está concluída com a feature isolada; se o merge estiver pendente, informe isso ao usuário.
- Após confirmar o merge, remova a branch temporária local e remota, usando `git branch -d` localmente, e atualize as referências com `git fetch --prune`. Preserve branches permanentes, de ambiente e qualquer branch com trabalho ainda não integrado. Habilite a exclusão automática após merge somente com as branches permanentes protegidas contra exclusão. Quando o plano do GitHub não permitir essa proteção, mantenha a exclusão automática desabilitada e remova manualmente apenas branches temporárias já mescladas.
- Nunca atribua autoria ou coautoria a IA em commits ou PRs: sem trailers `Co-authored-by` para assistentes/modelos/serviços e sem assinaturas de IA. Preserve autores humanos, licenças e avisos legítimos; não reescreva histórico publicado para aplicar essa regra.
- CI de produto em `main` e `development`, inclusive execução manual nessas branches. Checkouts de componentes irmãos usam a mesma branch. Em `development`, entregar somente Artifacts com retenção de 14 dias e SHA-256; nunca criar releases, pré-releases, tags ou publicar no registro. Releases e jobs com permissão de escrita continuam restritos à `main`. Exceção de segurança autorizada em 16/10/2026: `security.yml` analisa PRs para `main` e `development` com CodeQL e revisão de dependências, sem executar scripts do PR nem receber segredos de release. Não usar `pull_request_target`. `Security gate` e resultados do CodeQL são requisitos de merge na `main`.
