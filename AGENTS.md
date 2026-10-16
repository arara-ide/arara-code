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
- Não publicar a partir de branches de desenvolvimento, apagar branches históricas sem verificar seus commits ou reescrever o histórico.
- Commit e push continuam dependendo de autorização do usuário. Esta política não altera os fluxos dos repositórios `ac-*`.

## Encerramento e autoria

- Ao concluir trabalho em uma branch temporária, valide, mescle na branch de destino e confirme o merge no remoto. Uma tarefa não está concluída com a feature isolada; se o merge estiver pendente, informe isso ao usuário.
- Após confirmar o merge, remova a branch temporária local e remota, usando `git branch -d` localmente, e atualize as referências com `git fetch --prune`. Preserve branches permanentes, de ambiente e qualquer branch com trabalho ainda não integrado. Mantenha a exclusão automática após merge habilitada no GitHub.
- Nunca atribua autoria ou coautoria a IA em commits ou PRs: sem trailers `Co-authored-by` para assistentes/modelos/serviços e sem assinaturas de IA. Preserve autores humanos, licenças e avisos legítimos; não reescreva histórico publicado para aplicar essa regra.
- GitHub Actions somente em `main`, inclusive jobs de workflows manuais/reutilizáveis. Sem gatilhos em PRs, tags ou branches de desenvolvimento. Valide localmente antes do merge.
