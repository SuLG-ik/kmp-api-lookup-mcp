import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compactSelector, normalizeSelector } from '../src/search-utils.js';
import { KlibIndexStorage } from '../src/storage/index.js';
import { createInstallation, createParsedRecord, createTempConfig } from './testUtils.js';

describe('KlibIndexStorage', () => {
  let cleanup: (() => Promise<void>) | undefined;
  let storage: KlibIndexStorage | undefined;

  afterEach(async () => {
    storage?.close();
    storage = undefined;
    await cleanup?.();
    cleanup = undefined;
  });

  beforeEach(async () => {
    const temp = await createTempConfig();
    cleanup = temp.cleanup;
    storage = new KlibIndexStorage(temp.config);

    const installation = createInstallation();
    const foundationSource = {
      name: 'Foundation',
      directoryPath: '/tmp/Foundation',
      sourceMtimeMs: 100,
    };
    const coreGraphicsSource = {
      name: 'CoreGraphics',
      directoryPath: '/tmp/CoreGraphics',
      sourceMtimeMs: 200,
    };

    storage.writeFrameworkBatch({
      installation,
      target: 'ios_arm64',
      indexedAt: '2026-04-08T00:00:00.000Z',
      cleanBefore: true,
      items: [
        {
          source: foundationSource,
          lineCount: 6,
          records: [
            createParsedRecord({
              framework: 'Foundation',
              packageName: 'platform.Foundation',
              className: 'NSURLSession',
              memberName: 'NSURLSession',
              memberSearchName: 'NSURLSession',
              memberKind: 'class',
              declarationForm: 'class',
              rawSignature: 'platform.Foundation/NSURLSession|null[100]',
            }),
            createParsedRecord({
              framework: 'Foundation',
              packageName: 'platform.Foundation',
              className: 'NSURLSession',
              memberName: 'dataTaskWithRequest',
              memberSearchName: 'dataTaskWithRequest',
              memberKind: 'member',
              objcSelector: 'dataTaskWithRequest:',
              objcSelectorNormalized: normalizeSelector('dataTaskWithRequest:'),
              objcSelectorCompact: compactSelector('dataTaskWithRequest:'),
              rawSignature:
                'platform.Foundation/NSURLSession.dataTaskWithRequest|objc:dataTaskWithRequest:[100]',
            }),
            createParsedRecord({
              framework: 'Foundation',
              packageName: 'platform.Foundation',
              className: 'NSURLSession',
              memberName: 'delegate',
              memberSearchName: 'delegate',
              memberKind: 'member',
              objcSelector: 'delegate',
              objcSelectorNormalized: normalizeSelector('delegate'),
              objcSelectorCompact: compactSelector('delegate'),
              rawSignature: 'platform.Foundation/NSURLSession.delegate|objc:delegate[100]',
            }),
            createParsedRecord({
              framework: 'Foundation',
              packageName: 'platform.Foundation',
              className: 'NSURLSession',
              memberName: 'configuration',
              memberSearchName: 'configuration',
              memberKind: 'member',
              declarationForm: 'direct_member',
              rawSignature: 'platform.Foundation/NSURLSession.configuration|{}configuration[100]',
            }),
            createParsedRecord({
              framework: 'Foundation',
              packageName: 'platform.Foundation',
              className: 'NSURLSession',
              memberName: 'resume',
              memberSearchName: 'resume',
              memberKind: 'member',
              declarationForm: 'objc_bridge_extension',
              objcSelector: 'resume',
              objcSelectorNormalized: normalizeSelector('resume'),
              objcSelectorCompact: compactSelector('resume'),
              rawSignature: 'platform.Foundation/resume|NSURLSession.objc:resume[100]',
            }),
            createParsedRecord({
              framework: 'Foundation',
              packageName: 'platform.Foundation',
              className: 'NSURLSessionMeta',
              memberName: 'sharedSession',
              memberSearchName: 'sharedSession',
              memberKind: 'member',
              objcSelector: 'sharedSession',
              objcSelectorNormalized: normalizeSelector('sharedSession'),
              objcSelectorCompact: compactSelector('sharedSession'),
              rawSignature:
                'platform.Foundation/NSURLSessionMeta.sharedSession|objc:sharedSession[100]',
              isMetaClass: true,
            }),
          ],
        },
        {
          source: coreGraphicsSource,
          lineCount: 1,
          records: [
            createParsedRecord({
              framework: 'CoreGraphics',
              packageName: 'platform.CoreGraphics',
              className: null,
              memberName: 'CGPointMake',
              memberSearchName: 'CGPointMake',
              memberKind: 'member',
              objcSelector: 'CGPointMake',
              objcSelectorNormalized: normalizeSelector('CGPointMake'),
              objcSelectorCompact: compactSelector('CGPointMake'),
              rawSignature: 'platform.CoreGraphics/CGPointMake|objc:CGPointMake[100]',
            }),
          ],
        },
      ],
    });
  });

  it('tracks indexed datasets and counts', () => {
    const datasets = storage?.listIndexedDatasets() ?? [];

    expect(datasets).toHaveLength(1);
    expect(datasets[0]).toMatchObject({
      kotlinVersion: '2.2.21',
      target: 'ios_arm64',
      recordCount: 7,
      frameworkCount: 2,
    });
  });

  it('finds exact class matches from class declaration records', () => {
    const results = storage?.searchSymbols({
      query: 'NSURLSession',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: [],
      matchMode: 'auto',
      limit: 20,
      includeMetaClasses: false,
      includeRawSignature: false,
    }) ?? [];

    expect(results[0]).toMatchObject({
      memberName: 'NSURLSession',
      memberKind: 'class',
      declarationForm: 'class',
      matchType: 'exact',
    });
  });

  it('finds exact selector matches with and without colon', () => {
    const withColon = storage?.searchSymbols({
      query: 'dataTaskWithRequest:',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: [],
      matchMode: 'auto',
      limit: 20,
      includeMetaClasses: false,
      includeRawSignature: false,
    }) ?? [];

    const withoutColon = storage?.searchSymbols({
      query: 'dataTaskWithRequest',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: [],
      matchMode: 'auto',
      limit: 20,
      includeMetaClasses: false,
      includeRawSignature: false,
    }) ?? [];

    expect(withColon[0]).toMatchObject({ memberName: 'dataTaskWithRequest', matchType: 'exact' });
    expect(withoutColon[0]).toMatchObject({ memberName: 'dataTaskWithRequest', matchType: 'exact' });
  });

  it('supports prefix, fuzzy and framework filtering', () => {
    const prefixResults = storage?.searchSymbols({
      query: 'dataTask',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: [],
      matchMode: 'prefix',
      limit: 20,
      includeMetaClasses: false,
      includeRawSignature: false,
    }) ?? [];

    const fuzzyResults = storage?.searchSymbols({
      query: 'shared session',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: [],
      matchMode: 'fuzzy',
      limit: 20,
      includeMetaClasses: true,
      includeRawSignature: false,
    }) ?? [];

    const filteredResults = storage?.searchSymbols({
      query: 'CGPointMake',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: ['CoreGraphics'],
      matchMode: 'auto',
      limit: 20,
      includeMetaClasses: false,
      includeRawSignature: false,
    }) ?? [];

    expect(prefixResults[0]).toMatchObject({ memberName: 'dataTaskWithRequest', matchType: 'prefix' });
    expect(fuzzyResults[0]).toMatchObject({ memberName: 'sharedSession' });
    expect(filteredResults).toHaveLength(1);
    expect(filteredResults[0]).toMatchObject({ framework: 'CoreGraphics', memberName: 'CGPointMake' });
  });

  it('finds bridge-form ObjC methods by class and member name', () => {
    const byMember = storage?.searchSymbols({
      query: 'resume',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: [],
      matchMode: 'auto',
      limit: 20,
      includeMetaClasses: false,
      includeRawSignature: false,
    }) ?? [];

    const byClass = storage?.searchSymbols({
      query: 'NSURLSession',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: [],
      matchMode: 'fuzzy',
      limit: 20,
      includeMetaClasses: false,
      includeRawSignature: false,
    }) ?? [];

    expect(byMember.some((result) => result.memberName === 'resume')).toBe(true);
    expect(byClass.some((result) => result.className === 'NSURLSession' && result.memberName === 'resume')).toBe(true);
  });

  it('excludes Meta classes unless explicitly requested', () => {
    const withoutMeta = storage?.searchSymbols({
      query: 'sharedSession',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: [],
      matchMode: 'auto',
      limit: 20,
      includeMetaClasses: false,
      includeRawSignature: false,
    }) ?? [];

    const withMeta = storage?.searchSymbols({
      query: 'sharedSession',
      kotlinVersion: '2.2.21',
      targets: ['ios_arm64'],
      frameworks: [],
      matchMode: 'auto',
      limit: 20,
      includeMetaClasses: true,
      includeRawSignature: false,
    }) ?? [];

    expect(withoutMeta).toHaveLength(0);
    expect(withMeta[0]).toMatchObject({ isMetaClass: true, memberName: 'sharedSession' });
  });
});