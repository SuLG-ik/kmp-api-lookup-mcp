import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadAppConfig, type AppConfig } from '../src/config/index.js';
import type { DiscoveredInstallation, ParsedSignatureRecord } from '../src/types.js';

export async function createTempConfig(): Promise<{
  config: AppConfig;
  cleanup(): Promise<void>;
}> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'kmp-api-lookup-'));

  return {
    config: loadAppConfig({
      cacheDir: tempDir,
      dbPath: path.join(tempDir, 'klib-index.sqlite'),
      metadataPath: path.join(tempDir, 'state.json'),
      konanScanRoot: path.join(tempDir, '.konan'),
    }),
    cleanup: async (): Promise<void> => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export function createInstallation(
  overrides: Partial<DiscoveredInstallation> = {}
): DiscoveredInstallation {
  const konanHome = overrides.konanHome ?? '/tmp/kotlin-native-prebuilt-macos-aarch64-2.2.21';

  return {
    kotlinVersion: overrides.kotlinVersion ?? '2.2.21',
    konanHome,
    klibBinaryPath: overrides.klibBinaryPath ?? path.join(konanHome, 'bin', 'klib'),
    platformRootPath: overrides.platformRootPath ?? path.join(konanHome, 'klib', 'platform'),
    availableTargets: overrides.availableTargets ?? ['ios_arm64'],
    sources: overrides.sources ?? ['explicit'],
  };
}

export function createParsedRecord(
  overrides: Partial<ParsedSignatureRecord> & {
    framework: string;
    packageName: string;
    memberName: string;
    memberSearchName: string;
    memberKind: ParsedSignatureRecord['memberKind'];
    rawSignature: string;
  }
): ParsedSignatureRecord {
  return {
    className: null,
    declarationForm: 'direct_member',
    objcSelector: null,
    objcSelectorNormalized: null,
    objcSelectorCompact: null,
    isMetaClass: false,
    ...overrides,
  };
}