# zTerm

English | [简体中文](./README.zh-CN.md)

zTerm is an open-source Electron terminal with optional AI assistance and SSH/Jumpserver connections.

## Highlights

- Local PTY, direct SSH (host fingerprint confirmation, in-place tab reconnect), and Jumpserver assets
- Terminal search (`Cmd/Ctrl+F`) and terminal output export
- Host list export as OpenSSH config (never includes passwords or key material)
- Persistent workspace and AI chat history, restorable after restart
- Chat / Agent AI modes with terminal context; Agent defaults to read mode with built-in directory, file, text, system, process and socket tools. Read/write mode automatically executes commands within the existing safety policy; dangerous commands remain blocked.

## Development

```bash
npm ci
cp .env.example .env
npm run dev
```

Configure the provider URL, model and API key in the app settings. Agent uses a pinned Pi SDK and requires native tool calling. Commands use a restricted shell grammar; interpreters, command substitution and unrecognized commands are rejected. Configure SSH hosts and Jumpserver instances in the app; no server or credential is bundled.

Built-in read tools use the bound local, SSH or Jumpserver terminal without installing zTerm components remotely. File reads and searches are bounded; text search currently covers one file or a directory's immediate files. Socket queries use an existing ss or lsof on the target. Missing capabilities and permission limits are reported. Read mode hides and rejects model-generated shell commands, while retaining the execution implementation for read/write mode. Switching back to read mode revokes commands that have not yet been sent.

## Packaging

The release helper follows the same four-stage workflow used by the project:

```bash
./deploy.sh release       # version, release commit, tag, and push (main only)
./deploy.sh build         # verify and package the current host (macOS by default on Mac)
./deploy.sh publish       # upload builds/ to the matching GitHub Release
./deploy.sh all           # release → build → publish
```

For a local platform override, use `./deploy.sh build mac`, `win`, or `linux`. Publishing only targets GitHub Releases; no credentials or third-party storage settings are bundled.

## Branches and CI

`main` is stable, `dev` is the integration branch, and short-lived `dev/<topic>` or `feature/<topic>` branches hold focused work. CI checks types, tests, production dependencies and code builds. Tagged releases require macOS signing and notarization, and Windows signing with a configured publisher identity. Missing release credentials fail the workflow before publication.

## License

MIT
