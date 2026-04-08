#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/server';
import { createServerRuntime } from './server/index.js';

async function main(): Promise<void> {
  const runtime = createServerRuntime();
  const transport = new StdioServerTransport();
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.error(`Received ${signal}, shutting down kmp-api-lookup-mcp...`);
    await runtime.close();
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT').finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM').finally(() => process.exit(0));
  });

  await runtime.server.connect(transport);
  console.error('kmp-api-lookup-mcp server running on stdio');
}

await main().catch((error: unknown) => {
  console.error('Fatal error while starting kmp-api-lookup-mcp:', error);
  process.exit(1);
});