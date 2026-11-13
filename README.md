# Haimin DSH Plugin Index

A curated [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
plugin market index in format 1. The index is rebuilt from public npm metadata
every six hours.

## Index URLs

```text
https://cdn.jsdelivr.net/gh/haiminovo/dsh-plugin-index@main/index.json
https://haiminovo.github.io/dsh-plugin-index/index.json
```

Use the jsDelivr URL first. The GitHub Pages URL is a direct mirror. Both return
JSON without a redirect.

Open DSH, then:

1. Plugins
2. Discover
3. Index sources
4. Add the jsDelivr URL above

## How it works

- `plugins.json` is the curated npm package allowlist.
- `build-index.mjs` fetches npm packuments and weekly download counts.
- Only versions that declare `dsh.bundle` are included.
- GitHub Actions rebuilds `index.json` and deploys it to GitHub Pages.
- The current build keeps up to 40 recent compatible versions per package.

## Local build

```bash
npm run build
```

The generated files are:

```text
index.json
_site/index.json
```

No registry credentials are required.
