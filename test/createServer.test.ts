import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAppConfig } from '../src/config/index.js';
import { createServerRuntime } from '../src/server/index.js';
import { createTempConfig } from './testUtils.js';

describe('server runtime', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('loads the agreed server defaults', async () => {
    const temp = await createTempConfig();
    cleanup = temp.cleanup;

    expect(loadAppConfig(temp.config)).toMatchObject({
      serverName: 'kmp-api-lookup-mcp',
      version: '0.1.0',
      defaultSearchLimit: 20,
      defaultMatchMode: 'auto',
      defaultIncludeMetaClasses: false,
      defaultIncludeRawSignature: false,
      storageDriver: 'better-sqlite3',
    });
  });

  it('creates a closable MCP server runtime', async () => {
    const temp = await createTempConfig();
    cleanup = temp.cleanup;
    const runtime = createServerRuntime(temp.config);

    expect(runtime.server).toBeDefined();
    expect(runtime.service).toBeDefined();

    await runtime.close();
  });
});