# Changelog

Tudo que muda para quem usa o Arara Code. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Padrão de versão e escrita: `ac-docs/agents/release/AGENTS.md`.

## [Não lançado]

## [1.135.06790] - 2026-10-09

Versão de teste, só para Linux (x64).

### Novidades
- ChatGPT: integração com assistente ChatGPT via automação web / extensão de navegador.
- Terminal: atalhos `Ctrl+Shift+'` e `Ctrl+Shift+`` configurados para criar um novo terminal.

### Melhorias
- Interface: ajuste de espaçamento e alinhamento no título da janela.
- Chat: aprimoramentos na edição e restauração de mensagens no fluxo do chat.

## [1.135.06782] - 2026-10-09

Versão de teste, só para Linux (x64).

### Novidades
- Git History: extensão `donjayamanne.githistory` vem embutida na IDE por padrão para consultar histórico de commits, arquivos e linhas.
- Chat: botão de desfazer (ícone ao lado da mensagem do usuário) permite restaurar o projeto para o estado exato antes do pedido.
- Chat: mensagens antigas são carregadas sob demanda ao chegar no topo do painel ("Carregar mais mensagens").

### Melhorias
- Chat: botão "Compactar conversa" agora pode ser usado a partir de 3 mensagens, resumindo as antigas e mantendo as 2 mais recentes no contexto.

## [1.135.06780] - 2026-10-09

Versão de teste, só para Linux (x64).

### Novidades
- Atualização: quando sai versão nova, aparece o botão "Atualizar" no topo da janela, que abre a página de download.
- Atualização: instalou o `.deb` novo com a IDE aberta? Ela percebe e reinicia sozinha em 10 s, sem perder arquivos não salvos. Dá para adiar.
- Codex, Claude Code, Antigravity e Kiro: no topo do painel, ao lado do nome, quanto você já gastou do limite da conta (janela de 5h, ou a que a sua conta tiver; no Kiro, os créditos usados do total). O mesmo aparece com uma barra no seletor de modelos.
- Kiro: o seletor de modelos mostra o custo de cada modelo em créditos (1x, 2x, 0.5x…).
- Antigravity: modelos com raciocínio aparecem marcados como "Thinking" no seletor.
- Chat: dá para editar uma mensagem na fila (lápis ao lado do X). Ela continua na mesma posição.
- Chat: "Compactar conversa" no topo do painel resume as mensagens antigas e mantém as 5 últimas, na mesma conversa. Funciona na Arara, Codex, Claude Code, Antigravity e Kiro.

### Melhorias
- Codex, Claude Code, Antigravity e Kiro: nomes de modelo mais legíveis no seletor (ex.: "Claude Opus 5.5" em vez de "claude-opus-5.5").
- Chat: a conversa não desce mais sozinha enquanto você lê mensagens anteriores durante uma resposta.
- Chat: botões da fila de mensagens maiores e mais fáceis de clicar.

### Correções
- Atualização: o botão "Atualizar" não aparece mais quando você já está na versão mais nova.

## [1.135.06777] - 2026-10-09

Versão de teste, só para Linux (x64).

### Novidades
- Kiro: quarto assistente no painel direito, ao lado de Codex, Claude Code e Antigravity, usando o Kiro CLI (`kiro-cli`) instalado e logado na máquina. Mesma interface de chat: mensagens em tempo real, cartões de ferramentas (ler, editar, buscar, comandos), histórico de conversas, continuar a conversa, parar, escolher o modelo (com o custo em créditos), Ctrl+L e transferir conversa entre assistentes.
- Kiro: permissões "Acesso total", "Pedir aprovação no chat" (cada comando/edição aparece com Aceitar/Recusar) e "Somente leitura".
- Source Control: ícone de IA no canto da caixa de mensagem de commit gera uma mensagem curta no padrão `feat:`/`fix:`/`chore:`…, seguindo o estilo dos últimos commits do repositório. Funciona com um ou vários repositórios. Precisa estar conectado.

### Melhorias
- Chat: só dá para transferir a conversa entre assistentes quando a IA não está gerando resposta.

## [1.135.06755] - 2026-10-08

Versão de teste, só para Linux (x64).

### Novidades
- Chat: botão direito em um ou vários arquivos no Explorer → "Adicionar ao chat" coloca os arquivos como referência no chat, igual ao Ctrl+L.
- Chat: botão direito no editor → "Adicionar seleção ao chat" menciona as linhas selecionadas (sem seleção, "Adicionar ao chat" coloca o arquivo).
- Menus: itens de IA mostram uma estrelinha à esquerda.

## [1.135.06753] - 2026-10-08

Versão de teste, só para Linux (x64).

### Novidades
- Terminal: botão com ícone de IA na barra do terminal (entre dividir e novo terminal). Descreva o que você quer e a Arara escreve o comando e cola no terminal, sem executar — você revisa e aperta Enter. Precisa estar conectado.
- Terminal: o campo de pedido guarda um histórico dos últimos pedidos, para reaproveitar.
- Terminal: a IA usa como contexto as últimas linhas do terminal, o diretório atual e os arquivos e pastas de onde você está, e pode olhar outras pastas para montar o comando certo.
- Autocomplete: opção para desligar o aviso que convida a orientar as sugestões.

### Melhorias
- Secondary Side Bar: o botão de fechar (X) aparece sempre ao lado do maximizar, mesmo com a barra de atividades no topo.
- Terminal: enquanto a Arara escreve o comando, o terminal escurece e fica travado para execução até terminar.
- Login: a mensagem "conectado como…" some sozinha depois de alguns segundos, em vez de ficar na tela.

## [1.135.06736] - 2026-10-07

Versão de teste, só para Linux (x64).

### Novidades
- Autocomplete: clicar em "Autocomplete" na barra de status abre um menu para habilitar, desabilitar ou orientar as sugestões.
- Autocomplete: "Orientar sugestões" recebe em poucas palavras o que você está construindo. Vale por 30 min, só naquele projeto. 10 min depois de abrir o projeto, uma notificação lembra dessa opção.
- Chat: a IA sabe a linha onde você está e as últimas 10 abas abertas.
- Chat: aparece "Thinking..." quando a IA fica um tempo sem responder.

### Melhorias
- Chat: o que o Codex faz pelo terminal aparece como "Ler arquivo", "Buscar no projeto" ou "Editando arquivo…".
- Chat: as ações do Antigravity aparecem em português.
- Chat: comandos de terminal mostram um ícone em vez do título.
- Chat: enquanto uma ação roda, o rótulo mostra o que ela está fazendo ("Lendo arquivo…").

### Correções
- Chat: colar texto no campo de mensagem funciona sempre.
- Chat: no Codex, as ações da segunda mensagem em diante não se misturam mais com as anteriores.
- DevTools não abre na versão instalada, nem quando uma extensão pede.

## [1.135.06709] - 2026-10-07

Versão de teste, só para Linux (x64). Baseada no VS Code 1.135.

### Novidades
- Chat Arara na barra lateral direita, com agente que lê e edita arquivos do projeto.
- Codex, Claude Code e Antigravity no mesmo chat. Dá para passar a conversa de um para outro.
- Ctrl+L manda o trecho selecionado para o assistente que está aberto. Clicar na referência abre o arquivo no trecho certo.
- Fila de mensagens: dá para mandar a próxima enquanto o assistente ainda responde.
- Autocomplete com IA. Também sugere correções perto de erros ou do que você acabou de editar. Tab aceita, Esc recusa.
- Tab para importar: corrige o import que falta sem chamar a IA.
- Tela de configurações própria (conta e conversas).
- Entrar com a conta Arara pelo navegador.
- Desinstalador: `arara-code-uninstall`.

### Melhorias
- Toda vez que abre, o chat começa numa conversa nova.
- O chat avisa quando há arquivos não salvos. Ctrl+S salva todos.
- Tema padrão Dark 2026.
- Busca de comandos (Ctrl+Shift+P) centralizada.
- Pergunta curta, em português, ao abrir uma pasta pela primeira vez.

### Removido
- Atalho e comando do DevTools na versão instalada.
- Página de boas-vindas.
