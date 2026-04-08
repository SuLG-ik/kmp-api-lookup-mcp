import { afterEach, describe, expect, it, vi } from 'vitest';

import { KlibLookupService } from '../src/server/index.js';
import type { IndexedDatasetSummary, SearchResultItem } from '../src/types.js';
import { createTempConfig } from './testUtils.js';

describe('KlibLookupService lookup edge cases', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
  });

  it('resolves exact top-level constants instead of falling back to fuzzy class matches', async () => {
    const temp = await createTempConfig();
    cleanup = temp.cleanup;

    const storage = createStorageMock([
      createIndexedDataset(),
    ], [
      createSearchResult({
        id: 1,
        framework: 'AVFoundation',
        packageName: 'platform.AVFoundation',
        className: null,
        memberName: 'AVPlayerItemDidPlayToEndTimeNotification',
        rawSignature:
          'platform.AVFoundation/AVPlayerItemDidPlayToEndTimeNotification|{}AVPlayerItemDidPlayToEndTimeNotification[100]',
      }),
      createSearchResult({
        id: 2,
        framework: 'AVFoundation',
        packageName: 'platform.AVFoundation',
        className: 'AVPlayerLooper',
        memberName: 'AVPlayerLooper',
        memberKind: 'class',
        declarationForm: 'class',
        matchType: 'fuzzy',
        rawSignature: 'platform.AVFoundation/AVPlayerLooper|null[100]',
      }),
    ]);

    const service = new KlibLookupService(temp.config, storage as never);

    vi.spyOn(service as never, 'getMetadataLines').mockResolvedValue([
      '      // signature: platform.AVFoundation/AVPlayerItemDidPlayToEndTimeNotification|{}AVPlayerItemDidPlayToEndTimeNotification[100]',
      '      public final val AVPlayerItemDidPlayToEndTimeNotification: kotlin/String? /* = platform/Foundation/NSNotificationName^? */',
    ]);

    const result = await service.lookup({
      query: 'AVPlayerItemDidPlayToEndTimeNotification',
      frameworks: ['AVFoundation'],
    });

    expect(result.resultKind).toBe('member');
    expect(result.classCard).toBeNull();
    expect(result.memberCard).toMatchObject({
      detailLevel: 'compact',
      ownerKind: 'package',
      ownerQualifiedName: 'platform.AVFoundation',
      name: 'AVPlayerItemDidPlayToEndTimeNotification',
      kind: 'property',
      accessors: { getter: true, setter: false },
      mutable: false,
    });
  });

  it('falls back to a top-level typealias card when a class-like symbol has no class metadata block', async () => {
    const temp = await createTempConfig();
    cleanup = temp.cleanup;

    const storage = createStorageMock([
      createIndexedDataset(),
    ], [
      createSearchResult({
        id: 1,
        framework: 'AVFoundation',
        packageName: 'platform.AVFoundation',
        className: 'AVPlayerStatus',
        memberName: 'AVPlayerStatus',
        memberKind: 'class',
        declarationForm: 'class',
        rawSignature: 'platform.AVFoundation/AVPlayerStatus|null[100]',
      }),
    ]);

    const service = new KlibLookupService(temp.config, storage as never);

    vi.spyOn(service as never, 'getMetadataLines').mockResolvedValue([
      '      // signature: platform.AVFoundation/AVPlayerStatus|null[100]',
      '      public typealias AVPlayerStatus = platform/darwin/NSInteger^ /* = kotlin/Long /* = platform/darwin/NSInteger^ */ */',
    ]);

    const result = await service.lookup({
      query: 'AVPlayerStatus',
      frameworks: ['AVFoundation'],
    });

    expect(result.resultKind).toBe('member');
    expect(result.classCard).toBeNull();
    expect(result.memberCard).toMatchObject({
      detailLevel: 'compact',
      ownerKind: 'package',
      ownerQualifiedName: 'platform.AVFoundation',
      name: 'AVPlayerStatus',
      kind: 'typealias',
      kotlinSignatures: [
        'public typealias AVPlayerStatus = platform.darwin.NSInteger^ /* = kotlin.Long /* = platform.darwin.NSInteger^ */ */',
      ],
      accessors: null,
      mutable: null,
    });
  });

  it('expands the candidate window for short owner-qualified member queries when the initial results are too noisy', async () => {
    const temp = await createTempConfig();
    cleanup = temp.cleanup;

    const searchSymbols = vi.fn((params: { limit: number }) => {
      if (params.limit <= 20) {
        return [
          createSearchResult({
            id: 1,
            framework: 'AVFAudio',
            packageName: 'platform.AVFAudio',
            className: 'AVAudioSession',
            memberName: 'category',
            objcSelector: 'category',
            rawSignature: 'platform.AVFAudio/AVAudioSession.category|objc:category[100]',
            matchType: 'fts',
          }),
          createSearchResult({
            id: 2,
            framework: 'AVFAudio',
            packageName: 'platform.AVFAudio',
            className: 'AVAudioSession',
            memberName: 'categoryOptions',
            objcSelector: 'categoryOptions',
            rawSignature: 'platform.AVFAudio/AVAudioSession.categoryOptions|objc:categoryOptions[100]',
            matchType: 'fts',
          }),
        ];
      }

      return [
        createSearchResult({
          id: 1,
          framework: 'AVFAudio',
          packageName: 'platform.AVFAudio',
          className: 'AVAudioSession',
          memberName: 'category',
          objcSelector: 'category',
          rawSignature: 'platform.AVFAudio/AVAudioSession.category|objc:category[100]',
          matchType: 'fts',
        }),
        createSearchResult({
          id: 2,
          framework: 'AVFAudio',
          packageName: 'platform.AVFAudio',
          className: 'AVAudioSession',
          memberName: 'categoryOptions',
          objcSelector: 'categoryOptions',
          rawSignature: 'platform.AVFAudio/AVAudioSession.categoryOptions|objc:categoryOptions[100]',
          matchType: 'fts',
        }),
        createSearchResult({
          id: 3,
          framework: 'AVFAudio',
          packageName: 'platform.AVFAudio',
          className: 'AVAudioSession',
          memberName: 'setCategory',
          objcSelector: 'setCategory:error:',
          rawSignature: 'platform.AVFAudio/AVAudioSession.setCategory|objc:setCategory:error:[100]',
          matchType: 'fts',
        }),
      ];
    });

    const storage = {
      listIndexedDatasets: () => [createIndexedDataset({ frameworks: ['AVFAudio'] })],
      searchSymbols,
      close: () => undefined,
    };

    const service = new KlibLookupService(temp.config, storage as never);

    vi.spyOn(service as never, 'getMetadataLines').mockResolvedValue([
      '    public open class platform/AVFAudio/AVAudioSession : platform/darwin/NSObject {',
      '      // signature: platform.AVFAudio/AVAudioSession.setCategory|objc:setCategory:error:[100]',
      '      public open external fun setCategory(category: kotlin/String? /* = platform/AVFAudio/AVAudioSessionCategory^? */, error: kotlinx/cinterop/CPointer<kotlinx/cinterop/ObjCObjectVar<platform/Foundation/NSError?>>?): kotlin/Boolean',
      '    }',
    ]);

    const result = await service.lookup({
      query: 'AVAudioSession.setCategory',
      frameworks: ['AVFAudio'],
      queryKind: 'member',
    });

    expect(searchSymbols).toHaveBeenCalledTimes(2);
    expect(searchSymbols.mock.calls[0]?.[0]).toMatchObject({ limit: 20 });
    expect(searchSymbols.mock.calls[1]?.[0]).toMatchObject({ limit: 300 });
    expect(result.resultKind).toBe('member');
    expect(result.memberCard).toMatchObject({
      detailLevel: 'compact',
      ownerQualifiedName: 'platform.AVFAudio.AVAudioSession',
      name: 'setCategory',
      kind: 'function',
      objcSelectors: ['setCategory:error:'],
    });
  });
});

function createStorageMock(
  indexedDatasets: IndexedDatasetSummary[],
  searchResults: SearchResultItem[]
): {
  listIndexedDatasets(): IndexedDatasetSummary[];
  searchSymbols(): SearchResultItem[];
  close(): void;
} {
  return {
    listIndexedDatasets: () => indexedDatasets,
    searchSymbols: () => searchResults,
    close: () => undefined,
  };
}

function createIndexedDataset(
  overrides: Partial<IndexedDatasetSummary> = {}
): IndexedDatasetSummary {
  return {
    kotlinVersion: overrides.kotlinVersion ?? '2.2.21',
    konanHome: overrides.konanHome ?? '/tmp/kotlin-native-prebuilt-macos-aarch64-2.2.21',
    target: overrides.target ?? 'ios_simulator_arm64',
    indexedAt: overrides.indexedAt ?? '2026-04-08T00:00:00.000Z',
    recordCount: overrides.recordCount ?? 2,
    frameworkCount: overrides.frameworkCount ?? 1,
    frameworks: overrides.frameworks ?? ['AVFoundation'],
  };
}

function createSearchResult(overrides: Partial<SearchResultItem> & {
  id: number;
  framework: string;
  packageName: string;
  className: string | null;
  memberName: string;
  rawSignature: string;
}): SearchResultItem {
  return {
    id: overrides.id,
    kotlinVersion: overrides.kotlinVersion ?? '2.2.21',
    konanHome: overrides.konanHome ?? '/tmp/kotlin-native-prebuilt-macos-aarch64-2.2.21',
    target: overrides.target ?? 'ios_simulator_arm64',
    framework: overrides.framework,
    packageName: overrides.packageName,
    className: overrides.className,
    memberName: overrides.memberName,
    objcSelector: overrides.objcSelector ?? null,
    memberKind: overrides.memberKind ?? 'member',
    declarationForm: overrides.declarationForm ?? 'direct_member',
    isMetaClass: overrides.isMetaClass ?? false,
    matchType: overrides.matchType ?? 'exact',
    rawSignature: overrides.rawSignature,
  };
}