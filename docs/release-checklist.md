# Release checklist

Use this checklist to build a reproducible release artifact without calling a live GCP account.

## Validate the checkout

```bash
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
node tests/run.js
node tests/post-tool-use.js
```

## Validate in Docker Desktop

From the plugin root, run:

```bash
docker run --rm --network none -v "$PWD:/plugin:ro" -w /plugin node:20-alpine sh -lc \
  'node tests/run.js && node tests/post-tool-use.js && node -c hooks/session-start.js && node -c hooks/post-tool-use.js && node -e "JSON.parse(require(\"fs\").readFileSync(\".claude-plugin/plugin.json\", \"utf8\")); JSON.parse(require(\"fs\").readFileSync(\".claude-plugin/marketplace.json\", \"utf8\")); console.log(\"manifests passed\")"'
```

## Package and inspect

```bash
mkdir -p dist
zip -qr "dist/gcp-devkit-v1.1.1.zip" . -x '.git/*' 'dist/*' '.DS_Store'
unzip -l "dist/gcp-devkit-v1.1.1.zip"
```

Confirm the archive contains `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/`, `agents/`, `commands/`, and `hooks/`, but not `.git/`, `dist/`, or local credential files.

## Publish

1. Update the version in both manifests and `CHANGELOG.md`.
2. Commit the release changes.
3. Create the Claude Code release tag: `claude plugin tag .`.
4. Push the commit and tag, then create the GitHub release with the ZIP from `dist/` attached.
5. Test marketplace installation in a clean Claude Code profile before announcement.
