import { describe, expect, it } from 'vitest';

import { parseSignatureLine } from '../src/indexer/index.js';

describe('parseSignatureLine', () => {
  it('parses a regular ObjC selector mapping', () => {
    const record = parseSignatureLine(
      'platform.Foundation/NSURLSession.dataTaskWithRequest|objc:dataTaskWithRequest:[100]'
    );

    expect(record).toMatchObject({
      framework: 'Foundation',
      packageName: 'platform.Foundation',
      className: 'NSURLSession',
      memberName: 'dataTaskWithRequest',
      memberSearchName: 'dataTaskWithRequest',
      memberKind: 'member',
      objcSelector: 'dataTaskWithRequest:',
      objcSelectorCompact: 'datataskwithrequest',
      isMetaClass: false,
    });
  });

  it('parses ObjC bridge methods that encode the receiver before objc', () => {
    const record = parseSignatureLine('platform.AVFoundation/play|AVPlayer.objc:play[100]');

    expect(record).toMatchObject({
      framework: 'AVFoundation',
      packageName: 'platform.AVFoundation',
      className: 'AVPlayer',
      memberName: 'play',
      memberSearchName: 'play',
      memberKind: 'member',
      declarationForm: 'objc_bridge_extension',
      objcSelector: 'play',
      objcSelectorCompact: 'play',
      isMetaClass: false,
    });
  });

  it('parses class declarations from null signatures', () => {
    const record = parseSignatureLine('platform.AVFoundation/AVPlayer|null[100]');

    expect(record).toMatchObject({
      framework: 'AVFoundation',
      packageName: 'platform.AVFoundation',
      className: 'AVPlayer',
      memberName: 'AVPlayer',
      memberSearchName: 'AVPlayer',
      memberKind: 'class',
      declarationForm: 'class',
      objcSelector: null,
    });
  });

  it('parses property signatures and drops accessor-only entries', () => {
    const propertyRecord = parseSignatureLine('platform.AVFoundation/AVPlayer.status|{}status[100]');
    const accessorRecord = parseSignatureLine(
      'platform.AVFoundation/AVPlayer.status.<get-status>|objc:status#Accessor[100]'
    );

    expect(propertyRecord).toMatchObject({
      className: 'AVPlayer',
      memberName: 'status',
      declarationForm: 'direct_member',
      objcSelector: null,
    });
    expect(accessorRecord).toBeNull();
  });

  it('marks Meta receivers for bridge-form class methods', () => {
    const record = parseSignatureLine(
      'platform.AVFoundation/playerWithURL|AVPlayerMeta.objc:playerWithURL:[100]'
    );

    expect(record).toMatchObject({
      className: 'AVPlayerMeta',
      memberName: 'playerWithURL',
      declarationForm: 'objc_bridge_extension',
      objcSelector: 'playerWithURL:',
      isMetaClass: true,
    });
  });

  it('normalizes constructors to init for searching', () => {
    const record = parseSignatureLine('platform.Foundation/NSURLSession.<init>|objc:init#Constructor[100]');

    expect(record).toMatchObject({
      className: 'NSURLSession',
      memberName: '<init>',
      memberSearchName: 'init',
      memberKind: 'constructor',
      declarationForm: 'direct_member',
      objcSelector: 'init',
    });
  });

  it('marks Meta classes explicitly', () => {
    const record = parseSignatureLine('platform.Foundation/NSURLSessionMeta.sharedSession|objc:sharedSession[100]');

    expect(record).toMatchObject({
      className: 'NSURLSessionMeta',
      memberName: 'sharedSession',
      isMetaClass: true,
    });
  });
});