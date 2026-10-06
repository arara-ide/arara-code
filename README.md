# Arara Code

IDE baseada em Code-OSS, construída em cima dos scripts do [VSCodium](https://github.com/VSCodium/vscodium).
Este repo não contém código do VS Code: só o VSCodium como submódulo (tag fixa), patches, branding e scripts.

## Build (Linux)

```bash
git submodule update --init
scripts/build.sh                 # ~15 min, ~10 GB em .work/
scripts/build.sh --skip-source   # rebuild reusando o vscode/ já clonado
```

Saída: `.work/vscodium/VSCode-linux-x64/bin/arara-code`.

Requisitos: os mesmos do VSCodium (`upstream/vscodium/docs/howto-build.md`) + `rsync`, `rsvg-convert`, ImageMagick.
