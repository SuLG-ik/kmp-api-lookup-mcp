import { uniqueSorted } from '../search-utils.js';
import type {
  LookupClassCard,
  LookupCompactCallableSummary,
  LookupCompactClassCard,
  LookupCompactMemberCard,
  LookupCompactPropertySummary,
  LookupDetailLevel,
  LookupFullClassCard,
  LookupFullMemberCard,
  LookupMemberCard,
  LookupPropertyAccessors,
  LookupSymbolSignature,
} from '../types.js';

interface PropertyInfo {
  readonly property: LookupSymbolSignature;
  readonly type: string;
  readonly mutable: boolean;
  readonly getter: boolean;
  readonly setter: boolean;
  readonly requiredImports: string[];
}

export function applyLookupDetailToClassCard(
  classCard: LookupFullClassCard,
  detailLevel: LookupDetailLevel
): LookupClassCard {
  const fullCard = normalizeFullClassCard(classCard);

  if (detailLevel === 'full') {
    return fullCard;
  }

  const propertyInfoByName = collectPropertyInfo(fullCard.members);

  return {
    framework: fullCard.framework,
    packageName: fullCard.packageName,
    name: fullCard.name,
    qualifiedName: fullCard.qualifiedName,
    detailLevel: 'compact',
    kind: fullCard.kind,
    kotlinSignature: fullCard.kotlinSignature,
    extendsType: fullCard.extendsType,
    implementsTypes: fullCard.implementsTypes,
    requiredImports: fullCard.requiredImports,
    constructors: groupCallables(fullCard.constructors),
    properties: buildCompactProperties(propertyInfoByName),
    methods: groupCallables(filterNonAccessorCallables(fullCard.members, propertyInfoByName)),
    classMethods: groupCallables(filterNonAccessorCallables(fullCard.classMembers, new Map())),
  } satisfies LookupCompactClassCard;
}

export function applyLookupDetailToMemberCard(
  memberCard: LookupFullMemberCard,
  detailLevel: LookupDetailLevel
): LookupMemberCard {
  const fullCard = normalizeFullMemberCard(memberCard);

  if (detailLevel === 'full') {
    return fullCard;
  }

  const propertyInfoByName = collectPropertyInfo(fullCard.entries);
  const propertyInfo = propertyInfoByName.get(fullCard.name);

  if (propertyInfo) {
    return {
      framework: fullCard.framework,
      packageName: fullCard.packageName,
      ownerName: fullCard.ownerName,
      ownerQualifiedName: fullCard.ownerQualifiedName,
      ownerKind: fullCard.ownerKind,
      detailLevel: 'compact',
      name: fullCard.name,
      requiredImports: propertyInfo.requiredImports,
      kind: 'property',
      kotlinSignatures: [propertyInfo.property.kotlinSignature],
      objcSelectors: [],
      accessors: toAccessors(propertyInfo),
      mutable: propertyInfo.mutable,
    } satisfies LookupCompactMemberCard;
  }

  const grouped = groupCallables(filterNonAccessorCallables(fullCard.entries, propertyInfoByName));
  const summary = grouped[0];

  if (!summary) {
    throw new Error(`Failed to compact member ${fullCard.ownerQualifiedName}.${fullCard.name}.`);
  }

  return {
    framework: fullCard.framework,
    packageName: fullCard.packageName,
    ownerName: fullCard.ownerName,
    ownerQualifiedName: fullCard.ownerQualifiedName,
    ownerKind: fullCard.ownerKind,
    detailLevel: 'compact',
    name: fullCard.name,
    requiredImports: summary.requiredImports,
    kind: inferCompactMemberKind(fullCard.entries),
    kotlinSignatures: summary.kotlinSignatures,
    objcSelectors: summary.objcSelectors,
    accessors: null,
    mutable: null,
  } satisfies LookupCompactMemberCard;
}

function normalizeFullClassCard(classCard: LookupFullClassCard): LookupFullClassCard {
  return {
    ...classCard,
    detailLevel: 'full',
    constructors: sortEntries(classCard.constructors),
    members: sortEntries(classCard.members),
    classMembers: sortEntries(classCard.classMembers),
    totalConstructors: Math.max(classCard.totalConstructors, classCard.constructors.length),
    totalMembers: Math.max(classCard.totalMembers, classCard.members.length),
    totalClassMembers: Math.max(classCard.totalClassMembers, classCard.classMembers.length),
    omittedConstructors: 0,
    omittedMembers: 0,
    omittedClassMembers: 0,
  };
}

function normalizeFullMemberCard(memberCard: LookupFullMemberCard): LookupFullMemberCard {
  return {
    ...memberCard,
    detailLevel: 'full',
    entries: sortEntries(memberCard.entries),
    totalEntries: Math.max(memberCard.totalEntries, memberCard.entries.length),
    omittedEntries: 0,
  };
}

function collectPropertyInfo(entries: LookupSymbolSignature[]): Map<string, PropertyInfo> {
  const properties = entries.filter((entry) => entry.kind === 'property');
  const propertyInfoByName = new Map<string, PropertyInfo>();

  for (const property of properties) {
    const propertyType = getPropertyType(property.kotlinSignature);
    const mutable = isMutableProperty(property.kotlinSignature);
    const getter = entries.some((entry) => isPropertyGetter(entry, property.name, propertyType));
    const setter =
      mutable && entries.some((entry) => isPropertySetter(entry, property.name, propertyType));
    const requiredImports = uniqueSorted(
      entries
        .filter(
          (entry) =>
            entry.kind === 'property'
              ? entry.name === property.name
              : isPropertyGetter(entry, property.name, propertyType) ||
                isPropertySetter(entry, property.name, propertyType)
        )
        .flatMap((entry) => entry.requiredImports)
    );

    propertyInfoByName.set(property.name, {
      property,
      type: propertyType,
      mutable,
      getter,
      setter,
      requiredImports,
    });
  }

  return propertyInfoByName;
}

function buildCompactProperties(
  propertyInfoByName: Map<string, PropertyInfo>
): LookupCompactPropertySummary[] {
  return [...propertyInfoByName.values()]
    .map((info) => ({
      name: info.property.name,
      kotlinSignature: info.property.kotlinSignature,
      mutable: info.mutable,
      accessors: toAccessors(info),
      requiredImports: info.requiredImports,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function groupCallables(entries: LookupSymbolSignature[]): LookupCompactCallableSummary[] {
  const groups = new Map<
    string,
    {
      kotlinSignatures: string[];
      objcSelectors: Set<string>;
      requiredImports: Set<string>;
    }
  >();

  for (const entry of sortEntries(entries)) {
    if (entry.kind === 'property') {
      continue;
    }

    const existing = groups.get(entry.name);

    if (existing) {
      existing.kotlinSignatures.push(entry.kotlinSignature);
      if (entry.objcSelector) {
        existing.objcSelectors.add(entry.objcSelector);
      }
      for (const requiredImport of entry.requiredImports) {
        existing.requiredImports.add(requiredImport);
      }
      continue;
    }

    groups.set(entry.name, {
      kotlinSignatures: [entry.kotlinSignature],
      objcSelectors: new Set(entry.objcSelector ? [entry.objcSelector] : []),
      requiredImports: new Set(entry.requiredImports),
    });
  }

  return [...groups.entries()]
    .map(([name, group]) => ({
      name,
      kotlinSignatures: [...group.kotlinSignatures].sort((left, right) => left.localeCompare(right)),
      objcSelectors: [...group.objcSelectors].sort((left, right) => left.localeCompare(right)),
      requiredImports: [...group.requiredImports].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function filterNonAccessorCallables(
  entries: LookupSymbolSignature[],
  propertyInfoByName: Map<string, PropertyInfo>
): LookupSymbolSignature[] {
  return entries.filter((entry) => {
    if (entry.kind !== 'function') {
      return entry.kind === 'constructor';
    }

    for (const propertyInfo of propertyInfoByName.values()) {
      if (
        isPropertyGetter(entry, propertyInfo.property.name, propertyInfo.type) ||
        isPropertySetter(entry, propertyInfo.property.name, propertyInfo.type)
      ) {
        return false;
      }
    }

    return true;
  });
}

function inferCompactMemberKind(entries: LookupSymbolSignature[]): LookupCompactMemberCard['kind'] {
  const constructor = entries.find((entry) => entry.kind === 'constructor');

  if (constructor) {
    return 'constructor';
  }

  const property = entries.find((entry) => entry.kind === 'property');

  if (property) {
    return 'property';
  }

  return 'function';
}

function toAccessors(info: PropertyInfo): LookupPropertyAccessors {
  return {
    getter: info.getter,
    setter: info.setter,
  };
}

function isPropertyGetter(entry: LookupSymbolSignature, propertyName: string, propertyType: string): boolean {
  return (
    entry.kind === 'function' &&
    entry.name === propertyName &&
    countParameters(entry.kotlinSignature) === 0 &&
    getReturnType(entry.kotlinSignature) === propertyType
  );
}

function isPropertySetter(entry: LookupSymbolSignature, propertyName: string, propertyType: string): boolean {
  return (
    entry.kind === 'function' &&
    entry.name === `set${upperFirst(propertyName)}` &&
    countParameters(entry.kotlinSignature) === 1 &&
    getParameterTypes(entry.kotlinSignature)[0] === propertyType &&
    getReturnType(entry.kotlinSignature) === 'kotlin.Unit'
  );
}

function isMutableProperty(signature: string): boolean {
  return /\bvar\b/.test(signature);
}

function getPropertyType(signature: string): string {
  return getReturnType(signature);
}

function getReturnType(signature: string): string {
  const index = signature.lastIndexOf(': ');

  return index >= 0 ? signature.slice(index + 2).trim() : '';
}

function getParameterTypes(signature: string): string[] {
  const start = signature.indexOf('(');
  const end = signature.indexOf(')', start + 1);

  if (start < 0 || end < 0) {
    return [];
  }

  const params = signature.slice(start + 1, end).trim();

  if (!params) {
    return [];
  }

  return splitTopLevelComma(params).map((param) => {
    const separatorIndex = param.indexOf(': ');
    return separatorIndex >= 0 ? param.slice(separatorIndex + 2).trim() : param.trim();
  });
}

function countParameters(signature: string): number {
  return getParameterTypes(signature).length;
}

function splitTopLevelComma(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let angleDepth = 0;
  let parenDepth = 0;

  for (const char of value) {
    if (char === '<') {
      angleDepth += 1;
    } else if (char === '>' && angleDepth > 0) {
      angleDepth -= 1;
    } else if (char === '(') {
      parenDepth += 1;
    } else if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
    }

    if (char === ',' && angleDepth === 0 && parenDepth === 0) {
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

function upperFirst(value: string): string {
  if (!value) {
    return value;
  }

  return value[0].toUpperCase() + value.slice(1);
}

function sortEntries(entries: LookupSymbolSignature[]): LookupSymbolSignature[] {
  return [...entries].sort(
    (left, right) => left.name.localeCompare(right.name) || left.kotlinSignature.localeCompare(right.kotlinSignature)
  );
}
