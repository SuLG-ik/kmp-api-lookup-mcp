import { describe, expect, it, vi } from 'vitest';

import { registerTools } from '../src/tools/index.js';
import type {
  LookupResponse,
  RebuildResult,
  StatusResponse,
  ToolService,
} from '../src/types.js';

type RegisteredTool = {
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly callback: (args?: unknown) => Promise<Record<string, unknown>>;
};

describe('registerTools', () => {
  it('registers the agreed MCP tool set and returns structured results', async () => {
    const registeredTools: RegisteredTool[] = [];
    const service: ToolService = {
      lookup: vi.fn(async () => ({
        query: 'AVPlayer',
        effectiveKotlinVersion: '2.2.21',
        effectiveTarget: 'ios_simulator_arm64',
        detailLevel: 'compact',
        resultKind: 'class',
        classCard: {
          framework: 'AVFoundation',
          packageName: 'platform.AVFoundation',
          name: 'AVPlayer',
          qualifiedName: 'platform.AVFoundation.AVPlayer',
          detailLevel: 'compact',
          kind: 'class',
          kotlinSignature: 'public open class platform.AVFoundation.AVPlayer : platform.darwin.NSObject',
          extendsType: 'platform.darwin.NSObject',
          implementsTypes: [],
          requiredImports: ['platform.AVFoundation.AVPlayer'],
          constructors: [],
          properties: [],
          methods: [
            {
              name: 'play',
              kotlinSignatures: [
                'public final external fun platform.AVFoundation.AVPlayer.play(): kotlin.Unit',
              ],
              objcSelectors: ['play'],
              requiredImports: ['platform.AVFoundation.play'],
            },
          ],
          classMethods: [],
        },
        memberCard: null,
        alternatives: [],
      }) satisfies LookupResponse),
      getStatus: vi.fn(async () => ({
        ready: true,
        discoveredInstallations: [],
        indexedDatasets: [],
        recordCounts: { datasets: 0, frameworks: 0, symbols: 0 },
        lastRebuildAt: null,
      }) satisfies StatusResponse),
      rebuild: vi.fn(async () => ({
        kotlinVersion: '2.2.21',
        target: 'ios_arm64',
        selectedFrameworks: ['Foundation'],
        rebuiltFrameworks: ['Foundation'],
        skippedFrameworks: [],
        dryRun: false,
        indexedAt: '2026-04-08T00:00:00.000Z',
        totalRecordsWritten: 10,
        reports: [
          {
            framework: 'Foundation',
            action: 'rebuild',
            lineCount: 10,
            symbolCount: 10,
          },
        ],
      }) satisfies RebuildResult),
    };

    const fakeServer = {
      registerTool(
        name: string,
        config: Record<string, unknown>,
        callback: (args?: unknown) => Promise<Record<string, unknown>>
      ) {
        registeredTools.push({ name, config, callback });
        return {};
      },
    };

    registerTools(fakeServer as never, service);

    expect(registeredTools.map((tool) => tool.name)).toEqual([
      'lookup_symbol',
      'rebuild_klib_index',
      'get_klib_index_status',
    ]);

    const lookupTool = registeredTools.find((tool) => tool.name === 'lookup_symbol');

    expect(lookupTool).toBeDefined();

    const result = await lookupTool!.callback({ query: 'AVPlayer' });

    expect(result.structuredContent).toMatchObject({
      query: 'AVPlayer',
      detailLevel: 'compact',
      resultKind: 'class',
    });
    expect(result.content).toMatchObject([
      {
        type: 'text',
      },
    ]);
  });
});