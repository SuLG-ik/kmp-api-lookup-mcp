import { execFile } from 'node:child_process';
import { access, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AppConfig } from '../config/index.js';
import { compactSelector, compareVersionStrings, normalizeSelector, uniqueSorted } from '../search-utils.js';
import type {
  DiscoveredInstallation,
  FrameworkSource,
  ParsedSignatureRecord,
} from '../types.js';

const execFileAsync = promisify(execFile);
const FRAMEWORK_PREFIX = 'org.jetbrains.kotlin.native.platform.';

export async function discoverKotlinNativeInstallations(
  config: AppConfig,
  explicitKonanHome?: string,
  options: { onlyExplicit?: boolean } = {}
): Promise<DiscoveredInstallation[]> {
  const candidates = new Map<string, Set<string>>();
  const installations = new Map<string, DiscoveredInstallation>();

  const addCandidate = (candidatePath: string, source: string): void => {
    const resolvedPath = path.resolve(candidatePath);
    const sources = candidates.get(resolvedPath) ?? new Set<string>();
    sources.add(source);
    candidates.set(resolvedPath, sources);
  };

  if (explicitKonanHome) {
    addCandidate(explicitKonanHome, 'explicit');
  }

  if (!options.onlyExplicit) {
    if (process.env.KONAN_HOME) {
      addCandidate(process.env.KONAN_HOME, 'env');
    }

    try {
      const scanEntries = await readdir(config.konanScanRoot, { withFileTypes: true });

      for (const entry of scanEntries) {
        if (entry.isDirectory() && entry.name.startsWith('kotlin-native-prebuilt-')) {
          addCandidate(path.join(config.konanScanRoot, entry.name), 'scan');
        }
      }
    } catch {
      // Ignore missing ~/.konan roots.
    }
  }

  for (const [candidatePath, sources] of candidates.entries()) {
    const installation = await inspectKonanHome(candidatePath, [...sources]);

    if (!installation) {
      continue;
    }

    const existing = installations.get(installation.konanHome);

    if (existing) {
      installations.set(installation.konanHome, {
        ...existing,
        sources: uniqueSorted([...existing.sources, ...installation.sources]),
      });
    } else {
      installations.set(installation.konanHome, installation);
    }
  }

  return [...installations.values()].sort((left, right) => {
    const versionOrder = compareVersionStrings(right.kotlinVersion, left.kotlinVersion);
    if (versionOrder !== 0) {
      return versionOrder;
    }

    return left.konanHome.localeCompare(right.konanHome);
  });
}

export async function listFrameworkSources(
  installation: DiscoveredInstallation,
  target: string,
  requestedFrameworks?: string[]
): Promise<FrameworkSource[]> {
  const targetRoot = path.join(installation.platformRootPath, target);
  const entries = await readdir(targetRoot, { withFileTypes: true });
  const availableFrameworks = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(FRAMEWORK_PREFIX)) {
      continue;
    }

    const frameworkName = entry.name.slice(FRAMEWORK_PREFIX.length);
    availableFrameworks.set(frameworkName, path.join(targetRoot, entry.name));
  }

  const selectedFrameworks = requestedFrameworks ?? [...availableFrameworks.keys()];
  const missingFrameworks = selectedFrameworks.filter((framework) => !availableFrameworks.has(framework));

  if (missingFrameworks.length > 0) {
    throw new Error(
      `Frameworks not found for target ${target}: ${missingFrameworks.join(', ')}`
    );
  }

  const frameworkSources: FrameworkSource[] = [];

  for (const frameworkName of uniqueSorted(selectedFrameworks)) {
    const directoryPath = availableFrameworks.get(frameworkName);

    if (!directoryPath) {
      continue;
    }

    const frameworkStat = await stat(directoryPath);
    frameworkSources.push({
      name: frameworkName,
      directoryPath,
      sourceMtimeMs: frameworkStat.mtimeMs,
    });
  }

  return frameworkSources;
}

export function parseSignatureLine(line: string): ParsedSignatureRecord | null {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return null;
  }

  const classMatch = trimmedLine.match(/^(?<container>[^|]+)\|null\[(?<version>\d+)\]$/);

  if (classMatch?.groups) {
    const [packageName, symbolPath] = classMatch.groups.container.split('/', 2);

    if (!packageName || !symbolPath) {
      return null;
    }

    const framework = packageName.startsWith('platform.')
      ? packageName.slice('platform.'.length)
      : packageName;
    const memberName = symbolPath.includes('.') ? symbolPath.slice(symbolPath.lastIndexOf('.') + 1) : symbolPath;

    return {
      framework,
      packageName,
      className: symbolPath,
      memberName,
      memberSearchName: memberName,
      memberKind: 'class',
      declarationForm: 'class',
      objcSelector: null,
      objcSelectorNormalized: null,
      objcSelectorCompact: null,
      rawSignature: trimmedLine,
      isMetaClass: symbolPath.endsWith('Meta'),
    };
  }

  const propertyMatch = trimmedLine.match(/^(?<container>[^|]+)\|\{\}(?<property>[^\[]+)\[(?<version>\d+)\]$/);

  if (propertyMatch?.groups) {
    const [packageName, symbolPath] = propertyMatch.groups.container.split('/', 2);

    if (!packageName || !symbolPath) {
      return null;
    }

    const dotIndex = symbolPath.lastIndexOf('.');
    const className = dotIndex >= 0 ? symbolPath.slice(0, dotIndex) : null;
    const memberName = propertyMatch.groups.property;

    if (memberName.startsWith('<get-') || memberName.startsWith('<set-')) {
      return null;
    }

    const framework = packageName.startsWith('platform.')
      ? packageName.slice('platform.'.length)
      : packageName;

    return {
      framework,
      packageName,
      className,
      memberName,
      memberSearchName: memberName,
      memberKind: 'member',
      declarationForm: 'direct_member',
      objcSelector: null,
      objcSelectorNormalized: null,
      objcSelectorCompact: null,
      rawSignature: trimmedLine,
      isMetaClass: className?.endsWith('Meta') ?? false,
    };
  }

  const lineMatch = trimmedLine.match(
    /^(?<container>[^|]+)\|(?:(?<receiver>.+)\.)?objc:(?<selector>[^\[]+)\[(?<version>\d+)\]$/
  );

  if (!lineMatch?.groups) {
    return null;
  }

  const [packageName, symbolPath] = lineMatch.groups.container.split('/', 2);

  if (!packageName || !symbolPath) {
    return null;
  }

  const dotIndex = symbolPath.lastIndexOf('.');
  const className = lineMatch.groups.receiver ?? (dotIndex >= 0 ? symbolPath.slice(0, dotIndex) : null);
  const memberName = dotIndex >= 0 ? symbolPath.slice(dotIndex + 1) : symbolPath;

  if (memberName.startsWith('<get-') || memberName.startsWith('<set-')) {
    return null;
  }

  const normalizedSelector = lineMatch.groups.selector.replace(/#Constructor$/, '');
  const framework = packageName.startsWith('platform.')
    ? packageName.slice('platform.'.length)
    : packageName;

  return {
    framework,
    packageName,
    className,
    memberName,
    memberSearchName: memberName === '<init>' ? 'init' : memberName,
    memberKind: memberName === '<init>' ? 'constructor' : 'member',
    declarationForm: lineMatch.groups.receiver ? 'objc_bridge_extension' : 'direct_member',
    objcSelector: normalizedSelector,
    objcSelectorNormalized: normalizeSelector(normalizedSelector),
    objcSelectorCompact: compactSelector(normalizedSelector),
    rawSignature: trimmedLine,
    isMetaClass: className?.endsWith('Meta') ?? false,
  };
}

export async function dumpFrameworkSignatures(
  installation: DiscoveredInstallation,
  framework: FrameworkSource
): Promise<{ lineCount: number; records: ParsedSignatureRecord[] }> {
  try {
    const { stdout } = await execFileAsync(
      installation.klibBinaryPath,
      ['dump-metadata-signatures', framework.directoryPath],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }
    );

    const lines = stdout.split(/\r?\n/).filter(Boolean);

    return {
      lineCount: lines.length,
      records: lines
        .map((line) => parseSignatureLine(line))
        .filter((record): record is ParsedSignatureRecord => record !== null),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to dump metadata signatures for ${framework.name}: ${message}`
    );
  }
}

export async function dumpFrameworkMetadata(
  installation: DiscoveredInstallation,
  framework: FrameworkSource
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      installation.klibBinaryPath,
      ['dump-metadata', framework.directoryPath, '-print-signatures', 'true'],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }
    );

    return stdout.split(/\r?\n/);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to dump metadata for ${framework.name}: ${message}`
    );
  }
}

async function inspectKonanHome(
  konanHome: string,
  sources: string[]
): Promise<DiscoveredInstallation | null> {
  try {
    const resolvedKonanHome = await realpath(konanHome);
    const klibBinaryPath = path.join(resolvedKonanHome, 'bin', 'klib');
    const platformRootPath = path.join(resolvedKonanHome, 'klib', 'platform');

    await access(klibBinaryPath);
    await access(platformRootPath);

    const targetEntries = await readdir(platformRootPath, { withFileTypes: true });

    return {
      kotlinVersion: parseVersionFromKonanHome(resolvedKonanHome),
      konanHome: resolvedKonanHome,
      klibBinaryPath,
      platformRootPath,
      availableTargets: uniqueSorted(
        targetEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      ),
      sources: uniqueSorted(sources),
    };
  } catch {
    return null;
  }
}

function parseVersionFromKonanHome(konanHome: string): string {
  const baseName = path.basename(konanHome);
  const versionMatch = baseName.match(/-(\d+\.\d+\.\d+(?:[-A-Za-z0-9.]+)?)$/);

  if (versionMatch) {
    return versionMatch[1];
  }

  return baseName.replace(/^kotlin-native-prebuilt-/, '');
}