import { McpServer } from '@modelcontextprotocol/server';

import { loadAppConfig } from '../config/index.js';
import { registerTools } from '../tools/index.js';
import { KlibLookupService } from './lookupService.js';

export interface ServerRuntime {
  readonly config: ReturnType<typeof loadAppConfig>;
  readonly service: KlibLookupService;
  readonly server: McpServer;
  close(): Promise<void>;
}

export function createServerRuntime(
  overrides: Partial<ReturnType<typeof loadAppConfig>> = {}
): ServerRuntime {
  const config = loadAppConfig(overrides);
  const service = new KlibLookupService(config);
  const server = new McpServer(
    {
      name: config.serverName,
      version: config.version,
    },
    {
      capabilities: {
        logging: {},
      },
    }
  );

  registerTools(server, service);

  return {
    config,
    service,
    server,
    async close(): Promise<void> {
      await server.close();
      service.close();
    },
  };
}

export function createServer(): McpServer {
  return createServerRuntime().server;
}