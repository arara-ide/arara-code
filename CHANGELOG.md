# Changelog

Tudo que muda para quem usa o Arara Code. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Padrão de versão e escrita: `ac-docs/agents/release/AGENTS.md`.

## [Não lançado]

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
