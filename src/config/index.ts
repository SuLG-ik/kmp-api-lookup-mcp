import os from 'node:os';
import path from 'node:path';

import type { ServerConfigSummary } from '../types.js';

export interface AppConfig extends ServerConfigSummary {}

export function loadAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const cacheDir = overrides.cacheDir ?? path.join(resolveBaseCacheDir(), 'kmp-api-lookup-mcp');

  return {
    serverName: overrides.serverName ?? 'kmp-api-lookup-mcp',
    version: overrides.version ?? '0.1.0',
    cacheDir,
    dbPath: overrides.dbPath ?? path.join(cacheDir, 'klib-index.sqlite'),
    metadataPath: overrides.metadataPath ?? path.join(cacheDir, 'state.json'),
    konanScanRoot: overrides.konanScanRoot ?? path.join(os.homedir(), '.konan'),
    defaultSearchLimit: overrides.defaultSearchLimit ?? 20,
    defaultMatchMode: overrides.defaultMatchMode ?? 'auto',
    defaultIncludeMetaClasses: overrides.defaultIncludeMetaClasses ?? false,
    defaultIncludeRawSignature: overrides.defaultIncludeRawSignature ?? false,
    storageDriver: overrides.storageDriver ?? 'better-sqlite3',
    freshnessStrategy:
      overrides.freshnessStrategy
      ?? 'version + target + selected frameworks + source directory mtime',
    autoIndexing: overrides.autoIndexing ?? 'manual-error',
    searchTargetFallback: overrides.searchTargetFallback ?? 'all-indexed-targets',
    searchVersionFallback: overrides.searchVersionFallback ?? 'latest-indexed-version',
  };
}

function resolveBaseCacheDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches');
  }

  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  }

  return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
}