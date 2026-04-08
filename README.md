# kmp-api-lookup-mcp

MCP server for fast lookup of Kotlin/Native iOS klib APIs.

The server indexes local Kotlin/Native platform klibs into a persistent SQLite database and exposes a compact MCP API for symbol lookup and index maintenance.

## Current Scope

- TypeScript npm ESM MCP server over stdio
- Persistent SQLite cache in the user cache directory
- Discovery of Kotlin/Native prebuilt installations via `KONAN_HOME`, `~/.konan`, or an explicit path
- Manual index rebuild from `klib dump-metadata-signatures`
- On-demand enrichment from `klib dump-metadata` for full Kotlin signatures, class hierarchy, and imports
- Structured JSON MCP responses with short text summaries

## Implemented Tools

### `lookup_symbol`

Resolve a Kotlin/Native Apple platform class, member, or top-level platform alias/constant into a compact development card.

Input:

```json
{
	"query": "AVPlayer",
	"frameworks": ["AVFoundation"],
	"detail": "compact",
	"queryKind": "auto"
}
```

Behavior:

- A class query like `AVPlayer` returns one class card with:
	- full Kotlin class signature
	- superclass and implemented interfaces
	- all constructors, instance methods, and class methods when `detail` is omitted or set to `compact`, grouped by member name to reduce output size
	- a separate `properties` list in compact mode with explicit `accessors.getter` and `accessors.setter` flags when matching getter/setter methods exist for that property
	- compact mode removes only duplicated property accessor methods; it does not trim unrelated methods from the class surface
	- the full direct member set, ObjC bridge extension members, and `Meta` class members when `detail` is set to `full`
	- `requiredImports` for code generation
- A member query like `AVPlayer.play` or `play` returns a compact grouped card with overload signatures and imports.
- Exact top-level platform aliases and constants like `AVPlayerStatus`, `AVLayerVideoGravity`, or `AVPlayerItemDidPlayToEndTimeNotification` resolve to package-scoped member cards instead of degrading into fuzzy class matches.
- If the query is ambiguous, the tool returns a short alternatives list instead of dumping raw search rows.
- Output intentionally omits noisy fields like DB paths, internal IDs, raw metadata dumps, match stages, and installation paths.
- `detail` defaults to `compact`. Use `"detail": "full"` only when you really need the entire class surface.

### `get_klib_index_status`

Return a compact index summary.

Input:

```json
{}
```

Output includes:

- `ready`
- discovered Kotlin/Native versions and targets
- indexed datasets with counts
- aggregate symbol counts
- `lastRebuildAt`

### `rebuild_klib_index`

Build or refresh the SQLite index from local klibs.

Input:

```json
{
	"kotlinVersion": "2.2.21",
	"target": "ios_simulator_arm64",
	"frameworks": ["Foundation", "UIKit"],
	"force": false,
	"dryRun": false,
	"cleanBefore": true
}
```

Rules:

- `kotlinVersion` and `konanHome` are optional, but you may provide at most one of them.
- If both are omitted, the latest discovered local Kotlin/Native installation is used.
- If `target` is omitted, the server prefers `ios_simulator_arm64`, then `ios_arm64`, then `ios_x64`.
- If `frameworks` is omitted, the rebuild covers all frameworks for the selected target.
- `dryRun=true` computes the rebuild plan without writing to SQLite.
- `force=true` ignores freshness checks.
- `cleanBefore=true` removes existing rows for the affected frameworks before writing fresh records.

## Storage Layout

The server stores data outside the repository.

- SQLite DB: user cache dir + `klib-index.sqlite`
- Service metadata: user cache dir + `state.json`

Typical cache locations:

- macOS: `~/Library/Caches/kmp-api-lookup-mcp/`
- Linux: `${XDG_CACHE_HOME:-~/.cache}/kmp-api-lookup-mcp/`
- Windows: `%LOCALAPPDATA%/kmp-api-lookup-mcp/`

## Discovery Rules

Installations are discovered in this order:

1. Explicit `konanHome` argument when a tool provides it
2. `KONAN_HOME`
3. `~/.konan/kotlin-native-prebuilt-*`

Each installation is validated by checking for:

- `bin/klib`
- `klib/platform/`

## MCP Configuration

### Run From Source

```json
{
	"mcpServers": {
		"kmp-api-lookup": {
			"command": "node",
			"args": ["/absolute/path/to/kmp-api-lookup-mcp/dist/index.js"]
		}
	}
}
```

Optional environment override:

```json
{
	"mcpServers": {
		"kmp-api-lookup": {
			"command": "node",
			"args": ["/absolute/path/to/kmp-api-lookup-mcp/dist/index.js"],
			"env": {
				"KONAN_HOME": "/Users/you/.konan/kotlin-native-prebuilt-macos-aarch64-2.2.21"
			}
		}
	}
}
```

### Run As Installed Binary

```json
{
	"mcpServers": {
		"kmp-api-lookup": {
			"command": "kmp-api-lookup-mcp"
		}
	}
}
```

## Development

### Scripts

- `npm run dev` starts the server from TypeScript sources
- `npm run build` compiles to `dist/`
- `npm start` runs the compiled server
- `npm run typecheck` runs TypeScript type checking
- `npm test` runs Vitest
- `npm run test:watch` starts Vitest in watch mode

### Local Workflow

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Publishing

npm publication is handled by GitHub Actions.

- Push a tag in the form `vX.Y.Z` where `X.Y.Z` matches the `version` in `package.json`.
- The `Publish Package` workflow validates the package and publishes it to npm.
- The npm package must be configured for trusted publishing from the `SuLG-ik/kmp-api-lookup-mcp` GitHub repository.
- See [PUBLISHING.md](./PUBLISHING.md) for the one-time npm setup and the exact release steps.

## Test Coverage

The current test suite covers:

- MCP tool registration
- `dump-metadata-signatures` line parsing
- SQLite storage and search behavior on synthetic fixtures
- server runtime creation

## Project Structure

```text
.
├── src/
│   ├── index.ts
│   ├── config/
│   ├── indexer/
│   ├── server/
│   ├── storage/
│   ├── tools/
│   ├── search-utils.ts
│   └── types.ts
├── test/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── vitest.config.ts
```