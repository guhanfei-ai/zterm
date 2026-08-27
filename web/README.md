# zTerm Web

This directory contains the standalone static download page.

## Preview

```bash
python3 preview-server.py
```

Open `http://127.0.0.1:8765`. The preview server serves files only and never proxies or contacts a release service.

## Release configuration

Before loading `script.js`, optionally define `window.ZTERM_MANIFEST_BASE` to a public HTTPS or same-origin directory containing:

- `update-manifest-macos-arm64.json`
- `update-manifest-windows-x64.json`

Without this value the page displays “暂未就绪” and performs no network request. Each manifest should provide version, publication date, SHA-256, and a package URL.
