import { describe, expect, it } from 'vitest';

import {
  applyLookupDetailToClassCard,
  applyLookupDetailToMemberCard,
} from '../src/server/lookupDetail.js';
import type { LookupFullClassCard, LookupFullMemberCard } from '../src/types.js';

describe('lookup detail presentation', () => {
  it('keeps all non-accessor methods in compact class mode and groups overloads', () => {
    const classCard: LookupFullClassCard = {
      framework: 'AVFoundation',
      packageName: 'platform.AVFoundation',
      name: 'AVPlayer',
      qualifiedName: 'platform.AVFoundation.AVPlayer',
      detailLevel: 'full',
      kind: 'class',
      kotlinSignature: 'public open class platform.AVFoundation.AVPlayer : platform.darwin.NSObject',
      extendsType: 'platform.darwin.NSObject',
      implementsTypes: [],
      requiredImports: ['platform.AVFoundation.AVPlayer'],
      totalConstructors: 2,
      totalMembers: 7,
      totalClassMembers: 3,
      omittedConstructors: 0,
      omittedMembers: 0,
      omittedClassMembers: 0,
      constructors: [
        {
          name: 'init',
          kind: 'constructor',
          scope: 'instance',
          declarationForm: 'direct_member',
          kotlinSignature: 'public /* secondary */ constructor()',
          objcSelector: 'init',
          requiredImports: [],
        },
        {
          name: 'init',
          kind: 'constructor',
          scope: 'instance',
          declarationForm: 'direct_member',
          kotlinSignature: 'public /* secondary */ constructor(uRL: platform.Foundation.NSURL)',
          objcSelector: 'initWithURL:',
          requiredImports: [],
        },
      ],
      members: [
        {
          name: 'player',
          kind: 'property',
          scope: 'instance',
          declarationForm: 'direct_member',
          kotlinSignature: 'public final var player: platform.AVFoundation.AVPlayer?',
          objcSelector: null,
          requiredImports: [],
        },
        {
          name: 'player',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'direct_member',
          kotlinSignature: 'public open external fun player(): platform.AVFoundation.AVPlayer?',
          objcSelector: 'player',
          requiredImports: [],
        },
        {
          name: 'setPlayer',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'direct_member',
          kotlinSignature: 'public open external fun setPlayer(player: platform.AVFoundation.AVPlayer?): kotlin.Unit',
          objcSelector: 'setPlayer:',
          requiredImports: [],
        },
        {
          name: 'play',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'objc_bridge_extension',
          kotlinSignature: 'public final external fun platform.AVFoundation.AVPlayer.play(): kotlin.Unit',
          objcSelector: 'play',
          requiredImports: ['platform.AVFoundation.play'],
        },
        {
          name: 'seekToTime',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'objc_bridge_extension',
          kotlinSignature: 'public final external fun platform.AVFoundation.AVPlayer.seekToTime(time: kotlinx.cinterop.CValue<platform.CoreMedia.CMTime>): kotlin.Unit',
          objcSelector: 'seekToTime:',
          requiredImports: ['platform.AVFoundation.seekToTime'],
        },
        {
          name: 'seekToTime',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'objc_bridge_extension',
          kotlinSignature: 'public final external fun platform.AVFoundation.AVPlayer.seekToTime(time: kotlinx.cinterop.CValue<platform.CoreMedia.CMTime>, completionHandler: kotlin.Function1<kotlin.Boolean, kotlin.Unit>): kotlin.Unit',
          objcSelector: 'seekToTime:completionHandler:',
          requiredImports: ['platform.AVFoundation.seekToTime'],
        },
        {
          name: 'setRate',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'objc_bridge_extension',
          kotlinSignature: 'public final external fun platform.AVFoundation.AVPlayer.setRate(rate: kotlin.Float): kotlin.Unit',
          objcSelector: 'setRate:',
          requiredImports: ['platform.AVFoundation.setRate'],
        },
      ],
      classMembers: [
        {
          name: 'alloc',
          kind: 'function',
          scope: 'class',
          declarationForm: 'direct_member',
          kotlinSignature: 'public open external fun alloc(): platform.AVFoundation.AVPlayer?',
          objcSelector: 'alloc',
          requiredImports: [],
        },
        {
          name: 'new',
          kind: 'function',
          scope: 'class',
          declarationForm: 'direct_member',
          kotlinSignature: 'public open external fun new(): platform.AVFoundation.AVPlayer?',
          objcSelector: 'new',
          requiredImports: [],
        },
        {
          name: 'playerWithURL',
          kind: 'function',
          scope: 'class',
          declarationForm: 'direct_member',
          kotlinSignature: 'public open external fun playerWithURL(URL: platform.Foundation.NSURL): platform.AVFoundation.AVPlayer',
          objcSelector: 'playerWithURL:',
          requiredImports: [],
        },
      ],
    };

    const compact = applyLookupDetailToClassCard(classCard, 'compact');

    expect(compact.detailLevel).toBe('compact');
    if (compact.detailLevel !== 'compact') {
      throw new Error('Expected compact class card');
    }
    expect(compact.properties).toEqual([
      {
        name: 'player',
        kotlinSignature: 'public final var player: platform.AVFoundation.AVPlayer?',
        mutable: true,
        accessors: { getter: true, setter: true },
        requiredImports: [],
      },
    ]);
    expect(compact.methods.map((entry) => entry.name)).toEqual(['play', 'seekToTime', 'setRate']);
    expect(compact.methods.find((entry) => entry.name === 'seekToTime')?.kotlinSignatures).toHaveLength(2);
    expect(compact.methods.find((entry) => entry.name === 'setRate')?.objcSelectors).toEqual(['setRate:']);
    expect(compact.classMethods.map((entry) => entry.name)).toEqual(['alloc', 'new', 'playerWithURL']);
    expect(compact.constructors).toEqual([
      {
        name: 'init',
        kotlinSignatures: [
          'public /* secondary */ constructor()',
          'public /* secondary */ constructor(uRL: platform.Foundation.NSURL)',
        ],
        objcSelectors: ['init', 'initWithURL:'],
        requiredImports: [],
      },
    ]);
  });

  it('keeps the full class card untouched when detail=full is requested', () => {
    const classCard: LookupFullClassCard = {
      framework: 'AVFoundation',
      packageName: 'platform.AVFoundation',
      name: 'AVPlayerLayer',
      qualifiedName: 'platform.AVFoundation.AVPlayerLayer',
      detailLevel: 'full',
      kind: 'class',
      kotlinSignature: 'public open class platform.AVFoundation.AVPlayerLayer : platform.QuartzCore.CALayer',
      extendsType: 'platform.QuartzCore.CALayer',
      implementsTypes: [],
      requiredImports: ['platform.AVFoundation.AVPlayerLayer'],
      totalConstructors: 0,
      totalMembers: 1,
      totalClassMembers: 0,
      omittedConstructors: 0,
      omittedMembers: 0,
      omittedClassMembers: 0,
      constructors: [],
      members: [
        {
          name: 'player',
          kind: 'property',
          scope: 'instance',
          declarationForm: 'direct_member',
          kotlinSignature: 'public final var player: platform.AVFoundation.AVPlayer?',
          objcSelector: null,
          requiredImports: [],
        },
      ],
      classMembers: [],
    };

    const full = applyLookupDetailToClassCard(classCard, 'full');

    expect(full.detailLevel).toBe('full');
    if (full.detailLevel !== 'full') {
      throw new Error('Expected full class card');
    }
    expect(full.omittedMembers).toBe(0);
    expect(full.members).toHaveLength(1);
    expect(full.members[0]?.name).toBe('player');
  });

  it('represents compact property member cards without duplicating getter or setter methods', () => {
    const memberCard: LookupFullMemberCard = {
      framework: 'AVFoundation',
      packageName: 'platform.AVFoundation',
      ownerName: 'AVPlayerItem',
      ownerQualifiedName: 'platform.AVFoundation.AVPlayerItem',
      detailLevel: 'full',
      ownerKind: 'class',
      ownerKotlinSignature: 'public open class platform.AVFoundation.AVPlayerItem : platform.darwin.NSObject',
      extendsType: 'platform.darwin.NSObject',
      implementsTypes: [],
      name: 'status',
      requiredImports: [],
      totalEntries: 2,
      omittedEntries: 0,
      entries: [
        {
          name: 'status',
          kind: 'property',
          scope: 'instance',
          declarationForm: 'direct_member',
          kotlinSignature: 'public final val status: kotlin.Long',
          objcSelector: null,
          requiredImports: [],
        },
        {
          name: 'status',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'direct_member',
          kotlinSignature: 'public open external fun status(): kotlin.Long',
          objcSelector: 'status',
          requiredImports: [],
        },
      ],
    };

    const compact = applyLookupDetailToMemberCard(memberCard, 'compact');
    const full = applyLookupDetailToMemberCard(memberCard, 'full');

    expect(compact.detailLevel).toBe('compact');
    if (compact.detailLevel !== 'compact') {
      throw new Error('Expected compact member card');
    }
    expect(compact.kind).toBe('property');
    expect(compact.kotlinSignatures).toEqual(['public final val status: kotlin.Long']);
    expect(compact.accessors).toEqual({ getter: true, setter: false });
    expect(compact.mutable).toBe(false);
    expect(full.detailLevel).toBe('full');
    if (full.detailLevel !== 'full') {
      throw new Error('Expected full member card');
    }
    expect(full.entries).toHaveLength(2);
    expect(full.omittedEntries).toBe(0);
  });

  it('keeps set-like methods when they are not property accessors', () => {
    const memberCard: LookupFullMemberCard = {
      framework: 'AVFoundation',
      packageName: 'platform.AVFoundation',
      ownerName: 'AVPlayer',
      ownerQualifiedName: 'platform.AVFoundation.AVPlayer',
      detailLevel: 'full',
      ownerKind: 'class',
      ownerKotlinSignature: 'public open class platform.AVFoundation.AVPlayer : platform.darwin.NSObject',
      extendsType: 'platform.darwin.NSObject',
      implementsTypes: [],
      name: 'setRate',
      requiredImports: ['platform.AVFoundation.setRate'],
      totalEntries: 2,
      omittedEntries: 0,
      entries: [
        {
          name: 'setRate',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'objc_bridge_extension',
          kotlinSignature: 'public final external fun platform.AVFoundation.AVPlayer.setRate(rate: kotlin.Float): kotlin.Unit',
          objcSelector: 'setRate:',
          requiredImports: ['platform.AVFoundation.setRate'],
        },
        {
          name: 'setRate',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'objc_bridge_extension',
          kotlinSignature: 'public final external fun platform.AVFoundation.AVPlayer.setRate(rate: kotlin.Float, time: kotlinx.cinterop.CValue<platform.CoreMedia.CMTime>, atHostTime: kotlinx.cinterop.CValue<platform.CoreMedia.CMTime>): kotlin.Unit',
          objcSelector: 'setRate:time:atHostTime:',
          requiredImports: ['platform.AVFoundation.setRate'],
        },
      ],
    };

    const compact = applyLookupDetailToMemberCard(memberCard, 'compact');

    expect(compact.detailLevel).toBe('compact');
    if (compact.detailLevel !== 'compact') {
      throw new Error('Expected compact member card');
    }
    expect(compact.kind).toBe('function');
    expect(compact.kotlinSignatures).toHaveLength(2);
    expect(compact.objcSelectors).toEqual(['setRate:', 'setRate:time:atHostTime:']);
    expect(compact.accessors).toBeNull();
  });
});
