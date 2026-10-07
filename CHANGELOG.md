# Changelog

Tudo que muda para quem usa o Arara Code. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Padrão de versão e escrita: `ac-docs/agents/release/AGENTS.md`.

## [Não lançado]

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
