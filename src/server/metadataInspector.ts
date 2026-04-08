import { parseSignatureLine } from '../indexer/index.js';
import type {
  LookupClassKind,
  LookupFullClassCard,
  LookupFullMemberCard,
  LookupMemberScope,
  LookupSymbolSignature,
  ParsedSignatureRecord,
} from '../types.js';

interface DeclarationBlock {
  readonly headerLine: string;
  readonly lines: string[];
}

export function buildClassCardFromMetadata(params: {
  readonly metadataLines: string[];
  readonly framework: string;
  readonly packageName: string;
  readonly className: string;
}): LookupFullClassCard | null {
  const qualifiedName = `${params.packageName.replace(/\./g, '/')}/${params.className}`;
  const classBlock = findDeclarationBlock(params.metadataLines, qualifiedName);

  if (!classBlock) {
    return null;
  }

  const kotlinSignature = normalizeDeclarationLine(stripBlockSuffix(classBlock.headerLine));
  const kind = parseClassKind(kotlinSignature);
  const supertypes = parseSupertypes(kotlinSignature);
  const constructors = collectBlockDeclarations(classBlock.lines, 'instance').filter(
    (entry) => entry.kind === 'constructor'
  );
  const directMembers = collectBlockDeclarations(classBlock.lines, 'instance').filter(
    (entry) => entry.kind !== 'constructor'
  );
  const metaBlock = findDeclarationBlock(params.metadataLines, `${qualifiedName}Meta`);
  const classMembers = metaBlock ? collectBlockDeclarations(metaBlock.lines, 'class') : [];
  const bridgeMembers = collectBridgeDeclarations(
    params.metadataLines,
    params.className
  );

  return {
    framework: params.framework,
    packageName: params.packageName,
    name: params.className,
    qualifiedName: `${params.packageName}.${params.className}`,
    detailLevel: 'full',
    kind,
    kotlinSignature,
    extendsType: kind === 'interface' ? null : supertypes[0] ?? null,
    implementsTypes: kind === 'interface' ? supertypes : supertypes.slice(1),
    requiredImports: [`${params.packageName}.${params.className}`],
    totalConstructors: constructors.length,
    totalMembers: directMembers.length + bridgeMembers.length,
    totalClassMembers: classMembers.length,
    omittedConstructors: 0,
    omittedMembers: 0,
    omittedClassMembers: 0,
    constructors: sortEntries(constructors),
    members: sortEntries([...directMembers, ...bridgeMembers]),
    classMembers: sortEntries(classMembers),
  };
}

export function buildTopLevelMemberCardFromMetadata(params: {
  readonly metadataLines: string[];
  readonly framework: string;
  readonly packageName: string;
  readonly symbolName: string;
  readonly rawSignatures: readonly string[];
}): LookupFullMemberCard | null {
  const entries = uniqueEntries(
    params.rawSignatures.flatMap((rawSignature) => {
      const entry = findTopLevelEntryBySignature(
        params.metadataLines,
        rawSignature,
        params.packageName,
        params.symbolName
      );

      return entry ? [entry] : [];
    })
  );

  if (entries.length === 0) {
    return null;
  }

  return {
    framework: params.framework,
    packageName: params.packageName,
    ownerName: params.packageName,
    ownerQualifiedName: params.packageName,
    detailLevel: 'full',
    ownerKind: 'package',
    ownerKotlinSignature: `package ${params.packageName}`,
    extendsType: null,
    implementsTypes: [],
    name: params.symbolName,
    requiredImports: uniqueSortedStrings(entries.flatMap((entry) => entry.requiredImports)),
    totalEntries: entries.length,
    omittedEntries: 0,
    entries: sortEntries(entries),
  };
}

function collectBridgeDeclarations(
  lines: readonly string[],
  className: string
): LookupSymbolSignature[] {
  const entries: LookupSymbolSignature[] = [];
  let pendingRecord: ParsedSignatureRecord | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('// signature: ')) {
      const parsed = parseSignatureLine(trimmed.slice('// signature: '.length));
      pendingRecord =
        parsed && parsed.declarationForm === 'objc_bridge_extension' && parsed.className === className
          ? parsed
          : null;
      continue;
    }

    if (!pendingRecord || trimmed.startsWith('@')) {
      continue;
    }

    if (!trimmed.startsWith('public ')) {
      pendingRecord = null;
      continue;
    }

    if (!isDeclarationLine(trimmed) || isAccessorLine(trimmed)) {
      pendingRecord = null;
      continue;
    }

    entries.push(createLookupEntry(pendingRecord, trimmed, 'instance'));
    pendingRecord = null;
  }

  return uniqueEntries(entries);
}

function collectBlockDeclarations(
  lines: readonly string[],
  scope: LookupMemberScope
): LookupSymbolSignature[] {
  const entries: LookupSymbolSignature[] = [];
  let pendingRecord: ParsedSignatureRecord | null = null;

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed === '}') {
      break;
    }

    if (trimmed.startsWith('// signature: ')) {
      pendingRecord = parseSignatureLine(trimmed.slice('// signature: '.length));
      continue;
    }

    if (!pendingRecord || trimmed.startsWith('@')) {
      continue;
    }

    if (!trimmed.startsWith('public ')) {
      pendingRecord = null;
      continue;
    }

    if (!isDeclarationLine(trimmed) || isAccessorLine(trimmed)) {
      pendingRecord = null;
      continue;
    }

    entries.push(createLookupEntry(pendingRecord, trimmed, scope));
    pendingRecord = null;
  }

  return uniqueEntries(entries);
}

function createLookupEntry(
  record: ParsedSignatureRecord,
  declarationLine: string,
  scope: LookupMemberScope
): LookupSymbolSignature {
  return {
    name: record.memberSearchName,
    kind: resolveMemberKind(declarationLine),
    scope,
    declarationForm:
      record.declarationForm === 'objc_bridge_extension' ? 'objc_bridge_extension' : 'direct_member',
    kotlinSignature: normalizeDeclarationLine(declarationLine),
    objcSelector: record.objcSelector,
    requiredImports:
      record.declarationForm === 'objc_bridge_extension'
        ? [`${record.packageName}.${record.memberSearchName}`]
        : [],
  };
}

function findTopLevelEntryBySignature(
  lines: readonly string[],
  rawSignature: string,
  packageName: string,
  symbolName: string
): LookupSymbolSignature | null {
  const signatureLine = `// signature: ${rawSignature}`;
  const parsed = parseSignatureLine(rawSignature);

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== signatureLine) {
      continue;
    }

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const trimmed = lines[cursor].trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith('// signature: ')) {
        break;
      }

      if (trimmed.startsWith('@')) {
        continue;
      }

      if (!trimmed.startsWith('public ') || isAccessorLine(trimmed) || !isDeclarationLine(trimmed)) {
        continue;
      }

      const name = parsed?.memberSearchName ?? symbolName;

      return {
        name,
        kind: resolveMemberKind(trimmed),
        scope: 'top_level',
        declarationForm:
          parsed?.declarationForm === 'objc_bridge_extension' ? 'objc_bridge_extension' : 'direct_member',
        kotlinSignature: normalizeDeclarationLine(trimmed),
        objcSelector: parsed?.objcSelector ?? null,
        requiredImports: [`${packageName}.${name}`],
      };
    }
  }

  return null;
}

function findDeclarationBlock(lines: readonly string[], qualifiedName: string): DeclarationBlock | null {
  const headerPattern = new RegExp(
    `^\\s*public\\b.*\\b(?:class|interface|companion object|object)\\s+${escapeRegex(qualifiedName)}(?:\\s*:\\s*.*)?\\s*\\{$`
  );

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!headerPattern.test(line)) {
      continue;
    }

    const blockLines: string[] = [];
    let depth = 0;

    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const blockLine = lines[cursor];
      blockLines.push(blockLine);
      depth += countChar(blockLine, '{') - countChar(blockLine, '}');

      if (depth === 0) {
        return {
          headerLine: line.trim(),
          lines: blockLines,
        };
      }
    }
  }

  return null;
}

function resolveMemberKind(declarationLine: string): LookupSymbolSignature['kind'] {
  if (declarationLine.includes(' constructor(')) {
    return 'constructor';
  }

  if (/\btypealias\b/.test(declarationLine)) {
    return 'typealias';
  }

  if (/\b(?:val|var)\b/.test(declarationLine)) {
    return 'property';
  }

  return 'function';
}

function normalizeDeclarationLine(value: string): string {
  return value.trim().replace(/([A-Za-z0-9_])\/(?=[A-Za-z0-9_])/g, '$1.');
}

function stripBlockSuffix(value: string): string {
  return value.replace(/\s*\{$/, '').trim();
}

function parseClassKind(signature: string): LookupClassKind {
  if (/\bcompanion object\b/.test(signature)) {
    return 'companion';
  }

  if (/\binterface\b/.test(signature)) {
    return 'interface';
  }

  if (/\bobject\b/.test(signature)) {
    return 'object';
  }

  return 'class';
}

function parseSupertypes(signature: string): string[] {
  const colonIndex = signature.indexOf(' : ');

  if (colonIndex < 0) {
    return [];
  }

  return splitTopLevelComma(signature.slice(colonIndex + 3).trim());
}

function splitTopLevelComma(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let genericDepth = 0;

  for (const char of value) {
    if (char === '<') {
      genericDepth += 1;
    } else if (char === '>' && genericDepth > 0) {
      genericDepth -= 1;
    }

    if (char === ',' && genericDepth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function sortEntries(entries: LookupSymbolSignature[]): LookupSymbolSignature[] {
  return [...entries].sort(
    (left, right) => left.name.localeCompare(right.name) || left.kotlinSignature.localeCompare(right.kotlinSignature)
  );
}

function uniqueEntries(entries: LookupSymbolSignature[]): LookupSymbolSignature[] {
  const seen = new Set<string>();
  const result: LookupSymbolSignature[] = [];

  for (const entry of entries) {
    const key = `${entry.scope}|${entry.declarationForm}|${entry.kotlinSignature}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(entry);
  }

  return result;
}

function isAccessorLine(value: string): boolean {
  return /\bexternal\s+(get|set)\b/.test(value);
}

function isDeclarationLine(value: string): boolean {
  return /\b(?:constructor|fun|val|var|typealias)\b/.test(value);
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countChar(value: string, char: string): number {
  return [...value].filter((item) => item === char).length;
}