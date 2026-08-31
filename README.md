# zTerm

English | [简体中文](./README.zh-CN.md)

zTerm is an open-source Electron terminal with optional AI assistance and SSH/Jumpserver connections.

## Highlights

- Local PTY, direct SSH (host fingerprint confirmation, in-place tab reconnect), and Jumpserver assets
- Terminal search (`Cmd/Ctrl+F`) and terminal output export
- Host list import/export as OpenSSH config (never includes passwords or key material)
- Persistent workspace and AI chat history, restorable after restart
- Chat / Agent AI modes with terminal context, command safety checks, and confirmations

## Development

```bash
npm ci
cp .env.example .env
npm run dev
```

Set `OPENAI_API_KEY` for AI features. Configure SSH hosts and Jumpserver instances in the app; no server or credential is bundled.

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

`main` is stable, `dev` is the integration branch, and short-lived `dev/<topic>` or `feature/<topic>` branches hold focused work. GitHub Actions verifies and packages macOS, Windows, and Linux builds for pushes and pull requests.

## License

MIT
