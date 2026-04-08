# Publishing to npm

This package is published from GitHub Actions using npm trusted publishing, following the same tag-driven flow as `svg2vector-mcp`.

## One-Time Setup

1. Create and verify an npm account.
2. Make sure the package name `kmp-api-lookup-mcp` is available to your npm account or scope.
3. Configure npm trusted publishing for the GitHub repository `SuLG-ik/kmp-api-lookup-mcp` and the workflow file `.github/workflows/publish.yml`.

The workflow is intentionally set up without `NPM_TOKEN`. It expects npm trusted publishing via GitHub OIDC.

## Release Flow

1. Update `version` in `package.json`.
2. Commit and push the version change to `main`.
3. Create a matching Git tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. Wait for the `Publish Package` GitHub Actions workflow to finish.
5. Verify the published version on npm.

## What the Workflow Does

On every pushed tag matching `v*`, GitHub Actions:

1. checks out the repository
2. installs dependencies with `npm ci`
3. runs `npm publish --provenance`

The publish lifecycle is protected by npm scripts:

- `prepublishOnly` runs `npm run typecheck && npm test && npm run build`

That means a GitHub publish will fail before upload if type checking, tests, or the build step fail.

## Version and Tag Rules

- The Git tag must match `package.json` version.
- Example: package version `0.1.1` must be published with tag `v0.1.1`.

## Troubleshooting

### Publish fails with auth or permission errors

- Verify trusted publishing is configured in npm for this repository.
- Verify the GitHub workflow has `id-token: write` permission.

### Publish fails because the version already exists

- Bump the version in `package.json`.
- Create a new matching tag and push it.

### Publish fails because `dist/` is missing

- Check the workflow logs for the `prepublishOnly` step.
- Fix the build locally with `npm run build`.

## Local Dry Run

You can verify the package contents locally without publishing:

```bash
npm publish --dry-run
```