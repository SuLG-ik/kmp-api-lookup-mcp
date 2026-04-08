import { describe, expect, it } from 'vitest';

import { buildClassCardFromMetadata } from '../src/server/metadataInspector.js';

describe('buildClassCardFromMetadata', () => {
  it('builds a compact class card with supertypes, meta methods, and bridge members', () => {
    const classCard = buildClassCardFromMetadata({
      metadataLines: [
        '    public open class platform/AVFoundation/AVPlayerMeta : platform/darwin/NSObjectMeta {',
        '      // signature: platform.AVFoundation/AVPlayerMeta.playerWithURL|objc:playerWithURL:[100]',
        '      @kotlinx/cinterop/ObjCMethod(selector = "playerWithURL:", encoding = "@24@0:8@16", isStret = false)',
        '      public open external fun playerWithURL(URL: platform/Foundation/NSURL): platform/AVFoundation/AVPlayer',
        '    }',
        '    public open class platform/AVFoundation/AVPlayer : platform/darwin/NSObject, platform/AVFoundation/AVQueuedSampleBufferRenderingProtocol {',
        '      // signature: platform.AVFoundation/AVPlayer.<init>|objc:init#Constructor[100]',
        '      @kotlinx/cinterop/ObjCConstructor(designated = true, initSelector = "init")',
        '      public /* secondary */ constructor()',
        '      // signature: platform.AVFoundation/AVPlayer.status|{}status[100]',
        '      public final val status: kotlin/Long',
        '    }',
        '    // signature: platform.AVFoundation/play|AVPlayer.objc:play[100]',
        '    @kotlinx/cinterop/ObjCMethod(selector = "play", encoding = "v16@0:8", isStret = false)',
        '    public final external fun platform/AVFoundation/AVPlayer.play(): kotlin/Unit',
      ],
      framework: 'AVFoundation',
      packageName: 'platform.AVFoundation',
      className: 'AVPlayer',
    });

    expect(classCard).toMatchObject({
      framework: 'AVFoundation',
      packageName: 'platform.AVFoundation',
      name: 'AVPlayer',
      qualifiedName: 'platform.AVFoundation.AVPlayer',
      kind: 'class',
      kotlinSignature:
        'public open class platform.AVFoundation.AVPlayer : platform.darwin.NSObject, platform.AVFoundation.AVQueuedSampleBufferRenderingProtocol',
      extendsType: 'platform.darwin.NSObject',
      implementsTypes: ['platform.AVFoundation.AVQueuedSampleBufferRenderingProtocol'],
      requiredImports: ['platform.AVFoundation.AVPlayer'],
    });

    expect(classCard?.constructors[0]).toMatchObject({
      name: 'init',
      kind: 'constructor',
      scope: 'instance',
      declarationForm: 'direct_member',
      kotlinSignature: 'public /* secondary */ constructor()',
    });
    expect(classCard?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          kind: 'property',
          declarationForm: 'direct_member',
          kotlinSignature: 'public final val status: kotlin.Long',
        }),
        expect.objectContaining({
          name: 'play',
          kind: 'function',
          scope: 'instance',
          declarationForm: 'objc_bridge_extension',
          kotlinSignature: 'public final external fun platform.AVFoundation.AVPlayer.play(): kotlin.Unit',
          requiredImports: ['platform.AVFoundation.play'],
        }),
      ])
    );
    expect(classCard?.classMembers[0]).toMatchObject({
      name: 'playerWithURL',
      kind: 'function',
      scope: 'class',
      declarationForm: 'direct_member',
      kotlinSignature:
        'public open external fun playerWithURL(URL: platform.Foundation.NSURL): platform.AVFoundation.AVPlayer',
    });
  });
});