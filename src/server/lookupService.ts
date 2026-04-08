import { mkdir, readFile, writeFile } from 'node:fs/promises';

import type { AppConfig } from '../config/index.js';
import {
  discoverKotlinNativeInstallations,
  dumpFrameworkMetadata,
  dumpFrameworkSignatures,
  listFrameworkSources,
} from '../indexer/index.js';
import {
  compactSelector,
  normalizeSelector,
  normalizeText,
  pickLatestVersion,
  toIsoNow,
  uniqueSorted,
} from '../search-utils.js';
import { KlibIndexStorage } from '../storage/index.js';
import { applyLookupDetailToClassCard, applyLookupDetailToMemberCard } from './lookupDetail.js';
import { buildClassCardFromMetadata } from './metadataInspector.js';
import type {
  DiscoveredInstallation,
  DiscoveryResponse,
  ExplainResponse,
  FrameworkRebuildReport,
  IndexedDatasetSummary,
  LookupAlternative,
  LookupDetailLevel,
  LookupFullClassCard,
  LookupFullMemberCard,
  LookupQueryKind,
  LookupRequest,
  LookupResponse,
  RebuildRequest,
  RebuildResult,
  SearchRequest,
  SearchResponse,
  SearchResultItem,
  StatusResponse,
  StoredState,
} from '../types.js';

interface ResolvedSearchContext {
  readonly effectiveVersion: string;
  readonly availableTargets: string[];
  readonly effectiveTargets: string[];
  readonly selectedFrameworks: string[];
}

interface LookupOwnerCandidate {
  readonly framework: string;
  readonly packageName: string;
  readonly className: string;
  readonly target: string;
  readonly konanHome: string;
  readonly rank: number;
}

interface LookupMemberCandidate extends LookupOwnerCandidate {
  readonly memberName: string;
  readonly selectors: string[];
}

type LookupResolution =
  | {
      readonly kind: 'class';
      readonly owner: LookupOwnerCandidate;
    }
  | {
      readonly kind: 'member';
      readonly owner: LookupOwnerCandidate;
      readonly memberName: string;
    }
  | {
      readonly kind: 'ambiguous';
      readonly alternatives: LookupAlternative[];
    }
  | {
      readonly kind: 'not_found';
    };

export class KlibLookupService {
  private readonly metadataCache = new Map<string, Promise<string[]>>();

  constructor(
    private readonly config: AppConfig,
    private readonly storage: KlibIndexStorage = new KlibIndexStorage(config)
  ) {}

  close(): void {
    this.storage.close();
  }

  async lookup(request: LookupRequest): Promise<LookupResponse> {
    const query = request.query.trim();
    const detailLevel: LookupDetailLevel = request.detail ?? 'compact';

    if (!query) {
      throw new Error('lookup_symbol requires a non-empty query');
    }

    const context = this.resolveSearchContext(request);
    const results = this.storage.searchSymbols({
      query,
      kotlinVersion: context.effectiveVersion,
      targets: context.effectiveTargets,
      frameworks: context.selectedFrameworks,
      matchMode: 'auto',
      limit: Math.max(request.limit ?? 5, 20),
      includeMetaClasses: true,
      includeRawSignature: true,
    });
    const effectiveTarget = pickPreferredTarget(context.effectiveTargets);

    if (results.length === 0) {
      return {
        query,
        effectiveKotlinVersion: context.effectiveVersion,
        effectiveTarget,
        detailLevel,
        resultKind: 'not_found',
        classCard: null,
        memberCard: null,
        alternatives: [],
      };
    }

    const resolution = this.resolveLookupResolution(
      query,
      request.queryKind ?? 'auto',
      results,
      request.limit ?? 5
    );

    if (resolution.kind === 'not_found') {
      return {
        query,
        effectiveKotlinVersion: context.effectiveVersion,
        effectiveTarget,
        detailLevel,
        resultKind: 'not_found',
        classCard: null,
        memberCard: null,
        alternatives: [],
      };
    }

    if (resolution.kind === 'ambiguous') {
      return {
        query,
        effectiveKotlinVersion: context.effectiveVersion,
        effectiveTarget,
        detailLevel,
        resultKind: 'ambiguous',
        classCard: null,
        memberCard: null,
        alternatives: resolution.alternatives,
      };
    }

    const classCard = await this.loadClassCard(resolution.owner);

    if (!classCard) {
      throw new Error(
        `Failed to load Kotlin metadata for ${resolution.owner.packageName}.${resolution.owner.className}`
      );
    }

    if (resolution.kind === 'class') {
      return {
        query,
        effectiveKotlinVersion: context.effectiveVersion,
        effectiveTarget: resolution.owner.target,
        detailLevel,
        resultKind: 'class',
        classCard: applyLookupDetailToClassCard(classCard, detailLevel),
        memberCard: null,
        alternatives: [],
      };
    }

    const memberCard = this.buildMemberCard(classCard, resolution.memberName);

    if (!memberCard) {
      throw new Error(
        `Failed to locate ${resolution.memberName} inside ${classCard.qualifiedName} metadata.`
      );
    }

    return {
      query,
      effectiveKotlinVersion: context.effectiveVersion,
      effectiveTarget: resolution.owner.target,
      detailLevel,
      resultKind: 'member',
      classCard: null,
      memberCard: applyLookupDetailToMemberCard(memberCard, detailLevel),
      alternatives: [],
    };
  }

  async discoverInstallations(explicitKonanHome?: string): Promise<DiscoveryResponse> {
    const installations = await discoverKotlinNativeInstallations(
      this.config,
      explicitKonanHome,
      explicitKonanHome ? { onlyExplicit: true } : undefined
    );

    if (explicitKonanHome && installations.length === 0) {
      throw new Error(`No valid Kotlin/Native installation found at ${explicitKonanHome}`);
    }

    return {
      explicitKonanHome: explicitKonanHome ?? null,
      installations,
    };
  }

  async getStatus(): Promise<StatusResponse> {
    const discoveredInstallations = await discoverKotlinNativeInstallations(this.config);
    const indexedDatasets = this.storage.listIndexedDatasets();
    const recordCounts = this.storage.getRecordCounts();
    const lastRebuild = await this.readStateFile();

    return {
      ready: recordCounts.symbols > 0,
      discoveredInstallations: discoveredInstallations.map((installation) => ({
        kotlinVersion: installation.kotlinVersion,
        availableTargets: installation.availableTargets,
        sources: installation.sources,
      })),
      indexedDatasets: indexedDatasets.map((dataset) => ({
        kotlinVersion: dataset.kotlinVersion,
        target: dataset.target,
        indexedAt: dataset.indexedAt,
        recordCount: dataset.recordCount,
        frameworkCount: dataset.frameworkCount,
        frameworks: dataset.frameworks,
      })),
      recordCounts,
      lastRebuildAt: lastRebuild?.lastRebuildAt ?? null,
    };
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const query = request.query.trim();

    if (!query) {
      throw new Error('search_klib_api requires a non-empty query');
    }
    const context = this.resolveSearchContext(request);
    const matchMode = request.matchMode ?? this.config.defaultMatchMode;
    const limit = request.limit ?? this.config.defaultSearchLimit;
    const includeMetaClasses = request.includeMetaClasses ?? this.config.defaultIncludeMetaClasses;
    const includeRawSignature = request.includeRawSignature ?? this.config.defaultIncludeRawSignature;
    const results = this.storage.searchSymbols({
      query,
      kotlinVersion: context.effectiveVersion,
      targets: context.effectiveTargets,
      frameworks: context.selectedFrameworks,
      matchMode,
      limit,
      includeMetaClasses,
      includeRawSignature,
    });

    return {
      query,
      effectiveKotlinVersion: context.effectiveVersion,
      effectiveTargets: context.effectiveTargets,
      availableTargets: context.availableTargets,
      selectedFrameworks: context.selectedFrameworks,
      matchMode,
      limit,
      includeMetaClasses,
      includeRawSignature,
      totalResults: results.length,
      noResults: results.length === 0,
      results,
    };
  }

  async explain(request: SearchRequest): Promise<ExplainResponse> {
    const searchResult = await this.search({
      ...request,
      limit: 1,
      includeRawSignature: request.includeRawSignature ?? this.config.defaultIncludeRawSignature,
    });

    return {
      query: searchResult.query,
      effectiveKotlinVersion: searchResult.effectiveKotlinVersion,
      effectiveTargets: searchResult.effectiveTargets,
      matchMode: searchResult.matchMode,
      includeMetaClasses: searchResult.includeMetaClasses,
      noResults: searchResult.noResults,
      symbol: searchResult.results[0] ?? null,
    };
  }

  async rebuild(request: RebuildRequest): Promise<RebuildResult> {
    const cleanBefore = request.cleanBefore ?? true;
    const dryRun = request.dryRun ?? false;
    const force = request.force ?? false;

    if (request.kotlinVersion && request.konanHome) {
      throw new Error('rebuild_klib_index accepts at most one of kotlinVersion or konanHome');
    }

    const installation = await this.resolveInstallation(request.kotlinVersion, request.konanHome);
    const target = request.target?.trim() || pickPreferredTarget(installation.availableTargets);

    if (!target) {
      throw new Error('rebuild_klib_index could not resolve a default target for the selected installation');
    }

    const frameworkSources = await listFrameworkSources(
      installation,
      target,
      request.frameworks ? uniqueSorted(request.frameworks) : undefined
    );

    if (frameworkSources.length === 0) {
      throw new Error(`No frameworks were found for target ${target}`);
    }

    const existingSnapshots = this.storage.getFrameworkSnapshots(
      installation.konanHome,
      target,
      frameworkSources.map((framework) => framework.name)
    );

    const reports: FrameworkRebuildReport[] = frameworkSources.map((framework) => {
      const existing = existingSnapshots.get(framework.name);
      const isFresh =
        !force
        && existing !== undefined
        && existing.sourceMtimeMs === framework.sourceMtimeMs
        && existing.symbolCount > 0;

      return {
        framework: framework.name,
        action: isFresh ? 'skip-fresh' : 'rebuild',
        lineCount: 0,
        symbolCount: existing?.symbolCount ?? 0,
        reason: isFresh ? 'Framework metadata mtime matches the indexed snapshot' : undefined,
      };
    });

    const frameworksToBuild = frameworkSources.filter((framework) => {
      const report = reports.find((item) => item.framework === framework.name);
      return report?.action === 'rebuild';
    });

    if (dryRun || frameworksToBuild.length === 0) {
      const indexedAt = dryRun ? null : toIsoNow();
      const result: RebuildResult = {
        kotlinVersion: installation.kotlinVersion,
        target,
        selectedFrameworks: frameworkSources.map((framework) => framework.name),
        rebuiltFrameworks: frameworksToBuild.map((framework) => framework.name),
        skippedFrameworks: reports
          .filter((report) => report.action === 'skip-fresh')
          .map((report) => report.framework),
        dryRun,
        indexedAt,
        totalRecordsWritten: dryRun ? 0 : 0,
        reports,
      };

      if (!dryRun && frameworksToBuild.length === 0) {
        await this.writeStateFile({
          lastRebuildAt: indexedAt,
          lastRebuild: result,
        });
      }

      return result;
    }

    const indexedAt = toIsoNow();
    const batchItems = [];

    for (const framework of frameworksToBuild) {
      const dumpedFramework = await dumpFrameworkSignatures(installation, framework);
      const report = reports.find((item) => item.framework === framework.name);

      if (report) {
        report.lineCount = dumpedFramework.lineCount;
        report.symbolCount = dumpedFramework.records.length;
      }

      batchItems.push({
        source: framework,
        lineCount: dumpedFramework.lineCount,
        records: dumpedFramework.records,
      });
    }

    const totalRecordsWritten = this.storage.writeFrameworkBatch({
      installation,
      target,
      indexedAt,
      cleanBefore,
      items: batchItems,
    });

    const result: RebuildResult = {
      kotlinVersion: installation.kotlinVersion,
      target,
      selectedFrameworks: frameworkSources.map((framework) => framework.name),
      rebuiltFrameworks: frameworksToBuild.map((framework) => framework.name),
      skippedFrameworks: reports
        .filter((report) => report.action === 'skip-fresh')
        .map((report) => report.framework),
      dryRun,
      indexedAt,
      totalRecordsWritten,
      reports,
    };

    await this.writeStateFile({
      lastRebuildAt: indexedAt,
      lastRebuild: result,
    });

    return result;
  }

  private resolveEffectiveVersion(
    requestedVersion: string | undefined,
    indexedDatasets: IndexedDatasetSummary[]
  ): string {
    if (requestedVersion) {
      return requestedVersion.trim();
    }

    const latestVersion = pickLatestVersion(indexedDatasets.map((dataset) => dataset.kotlinVersion));

    if (!latestVersion) {
      throw new Error('No indexed Kotlin/Native version is available. Run rebuild_klib_index first.');
    }

    return latestVersion;
  }

  private resolveSearchContext(
    request: Pick<SearchRequest, 'frameworks' | 'kotlinVersion' | 'target'>
  ): ResolvedSearchContext {
    const indexedDatasets = this.storage.listIndexedDatasets();

    if (indexedDatasets.length === 0) {
      throw new Error(
        'No index is available yet. Run rebuild_klib_index first to build at least one Kotlin/Native target.'
      );
    }

    const effectiveVersion = this.resolveEffectiveVersion(request.kotlinVersion, indexedDatasets);
    const datasetsForVersion = indexedDatasets.filter(
      (dataset) => dataset.kotlinVersion === effectiveVersion
    );

    if (datasetsForVersion.length === 0) {
      throw new Error(
        `No indexed dataset found for Kotlin/Native ${effectiveVersion}. Run rebuild_klib_index for that version first.`
      );
    }

    const availableTargets = uniqueSorted(datasetsForVersion.map((dataset) => dataset.target));

    if (request.target && !availableTargets.includes(request.target)) {
      throw new Error(
        `No indexed target ${request.target} found for Kotlin/Native ${effectiveVersion}. Run rebuild_klib_index for that target first.`
      );
    }

    return {
      effectiveVersion,
      availableTargets,
      effectiveTargets: request.target ? [request.target] : availableTargets,
      selectedFrameworks: request.frameworks ? uniqueSorted(request.frameworks) : [],
    };
  }

  private async resolveInstallation(
    kotlinVersion: string | undefined,
    konanHome: string | undefined
  ): Promise<DiscoveredInstallation> {
    if (konanHome) {
      const explicit = await discoverKotlinNativeInstallations(this.config, konanHome, {
        onlyExplicit: true,
      });

      if (explicit.length === 0) {
        throw new Error(`No valid Kotlin/Native installation found at ${konanHome}`);
      }

      return explicit[0];
    }

    const discovered = await discoverKotlinNativeInstallations(this.config);

    if (discovered.length === 0) {
      throw new Error('No Kotlin/Native installations were discovered locally.');
    }

    if (!kotlinVersion) {
      return discovered[0];
    }

    const matches = discovered.filter((installation) => installation.kotlinVersion === kotlinVersion);

    if (matches.length === 0) {
      throw new Error(`No discovered Kotlin/Native installation found for version ${kotlinVersion}`);
    }

    if (matches.length > 1) {
      throw new Error(
        `Multiple Kotlin/Native installations were found for version ${kotlinVersion}. Use konanHome to disambiguate.`
      );
    }

    return matches[0];
  }

  private resolveLookupResolution(
    query: string,
    queryKind: LookupQueryKind,
    results: SearchResultItem[],
    limit: number
  ): LookupResolution {
    const classCandidates = this.collectClassCandidates(results);
    const memberCandidates = this.collectMemberCandidates(results);
    const exactClassMatches = classCandidates.filter((candidate) => matchesClassQuery(query, candidate));
    const exactMemberMatches = memberCandidates.filter((candidate) => matchesMemberQuery(query, candidate));

    if (queryKind === 'class') {
      return this.resolveClassCandidates(exactClassMatches.length > 0 ? exactClassMatches : classCandidates, limit);
    }

    if (queryKind === 'member') {
      return this.resolveMemberCandidates(exactMemberMatches.length > 0 ? exactMemberMatches : memberCandidates, limit);
    }

    if (query.includes('.') && exactMemberMatches.length > 0) {
      return this.resolveMemberCandidates(exactMemberMatches, limit);
    }

    if (exactClassMatches.length > 0) {
      return this.resolveClassCandidates(exactClassMatches, limit);
    }

    if (exactMemberMatches.length > 0) {
      return this.resolveMemberCandidates(exactMemberMatches, limit);
    }

    if (classCandidates.length === 1) {
      return {
        kind: 'class',
        owner: classCandidates[0],
      };
    }

    if (memberCandidates.length === 1) {
      return {
        kind: 'member',
        owner: memberCandidates[0],
        memberName: memberCandidates[0].memberName,
      };
    }

    if (classCandidates.length > 1 && looksLikeClassQuery(query)) {
      return this.resolveClassCandidates(classCandidates, limit);
    }

    if (memberCandidates.length > 0) {
      return this.resolveMemberCandidates(memberCandidates, limit);
    }

    if (classCandidates.length > 0) {
      return this.resolveClassCandidates(classCandidates, limit);
    }

    return {
      kind: 'not_found',
    };
  }

  private resolveClassCandidates(
    candidates: LookupOwnerCandidate[],
    limit: number
  ): LookupResolution {
    if (candidates.length === 0) {
      return {
        kind: 'not_found',
      };
    }

    if (candidates.length === 1) {
      return {
        kind: 'class',
        owner: candidates[0],
      };
    }

    return {
      kind: 'ambiguous',
      alternatives: candidates.slice(0, limit).map((candidate) => ({
        resultKind: 'class',
        framework: candidate.framework,
        packageName: candidate.packageName,
        ownerName: candidate.className,
        symbolName: candidate.className,
      })),
    };
  }

  private resolveMemberCandidates(
    candidates: LookupMemberCandidate[],
    limit: number
  ): LookupResolution {
    if (candidates.length === 0) {
      return {
        kind: 'not_found',
      };
    }

    if (candidates.length === 1) {
      return {
        kind: 'member',
        owner: candidates[0],
        memberName: candidates[0].memberName,
      };
    }

    return {
      kind: 'ambiguous',
      alternatives: candidates.slice(0, limit).map((candidate) => ({
        resultKind: 'member',
        framework: candidate.framework,
        packageName: candidate.packageName,
        ownerName: candidate.className,
        symbolName: candidate.memberName,
      })),
    };
  }

  private collectClassCandidates(results: SearchResultItem[]): LookupOwnerCandidate[] {
    const candidates = new Map<string, LookupOwnerCandidate>();

    results.forEach((result, index) => {
      const ownerClassName = normalizeOwnerClassName(result);

      if (!ownerClassName) {
        return;
      }

      if (result.declarationForm === 'class' && result.isMetaClass) {
        return;
      }

      const key = `${result.framework}|${result.packageName}|${ownerClassName}`;

      if (candidates.has(key)) {
        return;
      }

      candidates.set(key, {
        framework: result.framework,
        packageName: result.packageName,
        className: ownerClassName,
        target: result.target,
        konanHome: result.konanHome,
        rank: index,
      });
    });

    return [...candidates.values()].sort((left, right) => left.rank - right.rank);
  }

  private collectMemberCandidates(results: SearchResultItem[]): LookupMemberCandidate[] {
    const candidates = new Map<
      string,
      LookupMemberCandidate & {
        selectorsSet: Set<string>;
      }
    >();

    results.forEach((result, index) => {
      if (result.declarationForm === 'class') {
        return;
      }

      const ownerClassName = normalizeOwnerClassName(result);

      if (!ownerClassName) {
        return;
      }

      const key = `${result.framework}|${result.packageName}|${ownerClassName}|${result.memberName}`;
      const existing = candidates.get(key);

      if (existing) {
        if (result.objcSelector) {
          existing.selectorsSet.add(result.objcSelector);
        }

        return;
      }

      candidates.set(key, {
        framework: result.framework,
        packageName: result.packageName,
        className: ownerClassName,
        target: result.target,
        konanHome: result.konanHome,
        memberName: result.memberName,
        selectors: [],
        selectorsSet: new Set(result.objcSelector ? [result.objcSelector] : []),
        rank: index,
      });
    });

    return [...candidates.values()]
      .map((candidate) => ({
        framework: candidate.framework,
        packageName: candidate.packageName,
        className: candidate.className,
        target: candidate.target,
        konanHome: candidate.konanHome,
        memberName: candidate.memberName,
        selectors: [...candidate.selectorsSet],
        rank: candidate.rank,
      }))
      .sort((left, right) => left.rank - right.rank);
  }

  private async loadClassCard(owner: LookupOwnerCandidate): Promise<LookupFullClassCard | null> {
    const metadataLines = await this.getMetadataLines(owner);

    return buildClassCardFromMetadata({
      metadataLines,
      framework: owner.framework,
      packageName: owner.packageName,
      className: owner.className,
    });
  }

  private buildMemberCard(
    classCard: LookupFullClassCard,
    memberName: string
  ): LookupFullMemberCard | null {
    const entries = [
      ...classCard.constructors,
      ...classCard.members,
      ...classCard.classMembers,
    ].filter((entry) => entry.name === memberName);

    if (entries.length === 0) {
      return null;
    }

    return {
      framework: classCard.framework,
      packageName: classCard.packageName,
      ownerName: classCard.name,
      ownerQualifiedName: classCard.qualifiedName,
      detailLevel: 'full',
      ownerKind: classCard.kind,
      ownerKotlinSignature: classCard.kotlinSignature,
      extendsType: classCard.extendsType,
      implementsTypes: classCard.implementsTypes,
      name: memberName,
      requiredImports: uniqueSorted(entries.flatMap((entry) => entry.requiredImports)),
      totalEntries: entries.length,
      omittedEntries: 0,
      entries,
    };
  }

  private async getMetadataLines(owner: LookupOwnerCandidate): Promise<string[]> {
    const cacheKey = `${owner.konanHome}|${owner.target}|${owner.framework}`;
    const cached = this.metadataCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const pending = this.loadMetadataLines(owner);
    this.metadataCache.set(cacheKey, pending);
    return pending;
  }

  private async loadMetadataLines(owner: LookupOwnerCandidate): Promise<string[]> {
    const installation = await this.resolveInstallation(undefined, owner.konanHome);
    const frameworks = await listFrameworkSources(installation, owner.target, [owner.framework]);
    const framework = frameworks[0];

    if (!framework) {
      throw new Error(
        `Framework ${owner.framework} is not available for ${owner.target} in ${owner.konanHome}`
      );
    }

    return dumpFrameworkMetadata(installation, framework);
  }

  private async readStateFile(): Promise<StoredState | null> {
    try {
      const raw = await readFile(this.config.metadataPath, 'utf8');
      return JSON.parse(raw) as StoredState;
    } catch {
      return null;
    }
  }

  private async writeStateFile(state: StoredState): Promise<void> {
    await mkdir(this.config.cacheDir, { recursive: true });
    await writeFile(this.config.metadataPath, JSON.stringify(state, null, 2), 'utf8');
  }
}

function normalizeOwnerClassName(result: SearchResultItem): string | null {
  if (!result.className) {
    return null;
  }

  let owner = result.className;

  if (owner.endsWith('.Companion')) {
    owner = owner.slice(0, -'.Companion'.length);
  }

  if (result.isMetaClass && owner.endsWith('Meta')) {
    owner = owner.slice(0, -'Meta'.length);
  }

  return owner;
}

function matchesClassQuery(query: string, candidate: LookupOwnerCandidate): boolean {
  const normalizedQuery = normalizeText(query);

  return buildOwnerQueryForms(candidate).includes(normalizedQuery);
}

function matchesMemberQuery(query: string, candidate: LookupMemberCandidate): boolean {
  const normalizedQuery = normalizeText(query);
  const normalizedSelectorQuery = normalizeSelector(query) ?? normalizedQuery;
  const compactQuery = compactSelector(query) ?? normalizedQuery;
  const selectorForms = new Set<string>();

  for (const selector of candidate.selectors) {
    selectorForms.add(normalizeSelector(selector) ?? normalizeText(selector));
    selectorForms.add(compactSelector(selector) ?? normalizeText(selector));
  }

  if (query.includes('.')) {
    const dotIndex = query.lastIndexOf('.');
    const ownerQuery = normalizeText(query.slice(0, dotIndex));
    const memberQuery = normalizeText(query.slice(dotIndex + 1));

    return buildOwnerQueryForms(candidate).includes(ownerQuery)
      && (
        memberQuery === normalizeText(candidate.memberName)
        || selectorForms.has(normalizeSelector(memberQuery) ?? memberQuery)
        || selectorForms.has(compactSelector(memberQuery) ?? memberQuery)
      );
  }

  return (
    normalizedQuery === normalizeText(candidate.memberName)
    || selectorForms.has(normalizedSelectorQuery)
    || selectorForms.has(compactQuery)
  );
}

function buildOwnerQueryForms(candidate: Pick<LookupOwnerCandidate, 'className' | 'packageName'>): string[] {
  const simpleName = candidate.className.split('.').at(-1) ?? candidate.className;

  return uniqueSorted([
    candidate.className,
    simpleName,
    `${candidate.packageName}.${candidate.className}`,
  ].map((value) => normalizeText(value)));
}

function looksLikeClassQuery(query: string): boolean {
  const trimmed = query.trim();

  return trimmed.length > 0 && /^[A-Z]/.test(trimmed);
}

function pickPreferredTarget(targets: readonly string[]): string {
  const preferredTargets = ['ios_simulator_arm64', 'ios_arm64', 'ios_x64'];

  for (const preferredTarget of preferredTargets) {
    if (targets.includes(preferredTarget)) {
      return preferredTarget;
    }
  }

  return [...targets].sort((left, right) => left.localeCompare(right))[0] ?? '';
}