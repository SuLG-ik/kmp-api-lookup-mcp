import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { AppConfig } from '../config/index.js';
import {
  buildFtsQuery,
  compactSelector,
  escapeLikePattern,
  normalizeSelector,
  normalizeText,
  uniqueSorted,
} from '../search-utils.js';
import type {
  DiscoveredInstallation,
  IndexedDatasetSummary,
  ParsedSignatureRecord,
  RecordCounts,
  SymbolDeclarationForm,
  SearchMatchMode,
  SearchMatchType,
  SearchResultItem,
} from '../types.js';

interface SearchSymbolsQuery {
  readonly query: string;
  readonly kotlinVersion: string;
  readonly targets: string[];
  readonly frameworks: string[];
  readonly matchMode: SearchMatchMode;
  readonly limit: number;
  readonly includeMetaClasses: boolean;
  readonly includeRawSignature: boolean;
}

interface FrameworkBatchItem {
  readonly source: {
    readonly name: string;
    readonly directoryPath: string;
    readonly sourceMtimeMs: number;
  };
  readonly lineCount: number;
  readonly records: ParsedSignatureRecord[];
}

interface SymbolRow {
  readonly id: number;
  readonly kotlin_version: string;
  readonly konan_home: string;
  readonly target: string;
  readonly framework: string;
  readonly package_name: string;
  readonly class_name: string | null;
  readonly member_name: string;
  readonly objc_selector: string | null;
  readonly member_kind: string;
  readonly is_meta_class: number;
  readonly raw_signature: string;
}

interface IndexedDatasetRow {
  readonly kotlin_version: string;
  readonly konan_home: string;
  readonly target: string;
  readonly indexed_at: string;
  readonly record_count: number;
  readonly framework_count: number;
  readonly frameworks: string | null;
}

interface FrameworkSnapshotRow {
  readonly name: string;
  readonly source_mtime_ms: number;
  readonly symbol_count: number;
}

export class KlibIndexStorage {
  private readonly db: Database.Database;

  constructor(private readonly config: AppConfig) {
    mkdirSync(path.dirname(config.dbPath), { recursive: true });
    this.db = new Database(config.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.initializeSchema();
  }

  close(): void {
    this.db.close();
  }

  listIndexedDatasets(): IndexedDatasetSummary[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            d.kotlin_version,
            i.konan_home,
            d.target,
            d.indexed_at,
            d.record_count,
            d.framework_count,
            GROUP_CONCAT(f.name, ',') AS frameworks
          FROM datasets d
          JOIN installations i ON i.id = d.installation_id
          LEFT JOIN frameworks f ON f.dataset_id = d.id
          GROUP BY d.id
          ORDER BY d.kotlin_version DESC, d.target ASC
        `
      )
      .all() as IndexedDatasetRow[];

    return rows.map((row) => ({
      kotlinVersion: row.kotlin_version,
      konanHome: row.konan_home,
      target: row.target,
      indexedAt: row.indexed_at,
      recordCount: row.record_count,
      frameworkCount: row.framework_count,
      frameworks: row.frameworks ? uniqueSorted(row.frameworks.split(',')) : [],
    }));
  }

  getRecordCounts(): RecordCounts {
    const row = this.db
      .prepare(
        `
          SELECT
            (SELECT COUNT(*) FROM datasets) AS datasets,
            (SELECT COUNT(*) FROM frameworks) AS frameworks,
            (SELECT COUNT(*) FROM symbols) AS symbols
        `
      )
      .get() as RecordCounts;

    return row;
  }

  getFrameworkSnapshots(
    konanHome: string,
    target: string,
    frameworkNames: string[]
  ): Map<string, { sourceMtimeMs: number; symbolCount: number }> {
    if (frameworkNames.length === 0) {
      return new Map();
    }

    const placeholders = frameworkNames.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `
          SELECT f.name, f.source_mtime_ms, f.symbol_count
          FROM frameworks f
          JOIN datasets d ON d.id = f.dataset_id
          JOIN installations i ON i.id = d.installation_id
          WHERE i.konan_home = ?
            AND d.target = ?
            AND f.name IN (${placeholders})
        `
      )
      .all(konanHome, target, ...frameworkNames) as FrameworkSnapshotRow[];

    return new Map(
      rows.map((row) => [
        row.name,
        {
          sourceMtimeMs: row.source_mtime_ms,
          symbolCount: row.symbol_count,
        },
      ])
    );
  }

  writeFrameworkBatch(params: {
    readonly installation: DiscoveredInstallation;
    readonly target: string;
    readonly indexedAt: string;
    readonly cleanBefore: boolean;
    readonly items: FrameworkBatchItem[];
  }): number {
    const transaction = this.db.transaction(() => {
      const installationId = this.upsertInstallation(params.installation, params.indexedAt);
      const datasetId = this.upsertDataset(
        installationId,
        params.installation.kotlinVersion,
        params.target,
        params.indexedAt
      );

      for (const item of params.items) {
        if (params.cleanBefore) {
          this.deleteFrameworkData(datasetId, item.source.name);
        }

        const frameworkId = this.upsertFramework(datasetId, item, params.indexedAt);

        for (const record of item.records) {
          this.upsertSymbol({
            datasetId,
            frameworkId,
            kotlinVersion: params.installation.kotlinVersion,
            konanHome: params.installation.konanHome,
            target: params.target,
            framework: item.source.name,
            record,
          });
        }

        this.syncFrameworkSearchIndex(datasetId, item.source.name);
        this.refreshFrameworkStats(datasetId, item.source.name, item.lineCount, params.indexedAt);
      }

      this.refreshDatasetStats(datasetId, params.indexedAt);
      return params.items.reduce((total, item) => total + item.records.length, 0);
    });

    return transaction();
  }

  searchSymbols(query: SearchSymbolsQuery): SearchResultItem[] {
    const results: SearchResultItem[] = [];
    const seenIds = new Set<number>();
    const stages = resolveStages(query.matchMode);

    for (const stage of stages) {
      if (results.length >= query.limit) {
        break;
      }

      const stageResults = this.queryStage(stage, query, query.limit - results.length);

      for (const result of stageResults) {
        if (seenIds.has(result.id)) {
          continue;
        }

        seenIds.add(result.id);
        results.push(result);

        if (results.length >= query.limit) {
          break;
        }
      }
    }

    return results;
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS installations (
        id INTEGER PRIMARY KEY,
        kotlin_version TEXT NOT NULL,
        konan_home TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        discovered_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS datasets (
        id INTEGER PRIMARY KEY,
        installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
        kotlin_version TEXT NOT NULL,
        target TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        record_count INTEGER NOT NULL DEFAULT 0,
        framework_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(installation_id, target)
      );

      CREATE TABLE IF NOT EXISTS frameworks (
        id INTEGER PRIMARY KEY,
        dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        source_path TEXT NOT NULL,
        source_mtime_ms REAL NOT NULL,
        line_count INTEGER NOT NULL,
        symbol_count INTEGER NOT NULL,
        indexed_at TEXT NOT NULL,
        UNIQUE(dataset_id, name)
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY,
        dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        framework_id INTEGER NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
        kotlin_version TEXT NOT NULL,
        konan_home TEXT NOT NULL,
        target TEXT NOT NULL,
        framework TEXT NOT NULL,
        package_name TEXT NOT NULL,
        class_name TEXT,
        member_name TEXT NOT NULL,
        member_name_normalized TEXT NOT NULL,
        objc_selector TEXT,
        objc_selector_normalized TEXT,
        objc_selector_compact TEXT,
        raw_signature TEXT NOT NULL,
        raw_signature_lower TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        member_kind TEXT NOT NULL,
        is_meta_class INTEGER NOT NULL DEFAULT 0,
        UNIQUE(dataset_id, framework, raw_signature)
      );

      CREATE INDEX IF NOT EXISTS idx_symbols_version_target ON symbols(kotlin_version, target);
      CREATE INDEX IF NOT EXISTS idx_symbols_framework ON symbols(framework);
      CREATE INDEX IF NOT EXISTS idx_symbols_member_name_normalized ON symbols(member_name_normalized);
      CREATE INDEX IF NOT EXISTS idx_symbols_objc_selector_normalized ON symbols(objc_selector_normalized);
      CREATE INDEX IF NOT EXISTS idx_symbols_objc_selector_compact ON symbols(objc_selector_compact);

      CREATE VIRTUAL TABLE IF NOT EXISTS symbol_search USING fts5(
        symbol_id UNINDEXED,
        dataset_id UNINDEXED,
        framework,
        package_name,
        class_name,
        member_name,
        objc_selector,
        raw_signature,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
  }

  private upsertInstallation(installation: DiscoveredInstallation, discoveredAt: string): number {
    this.db
      .prepare(
        `
          INSERT INTO installations (kotlin_version, konan_home, source, discovered_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(konan_home) DO UPDATE SET
            kotlin_version = excluded.kotlin_version,
            source = excluded.source,
            discovered_at = excluded.discovered_at
        `
      )
      .run(
        installation.kotlinVersion,
        installation.konanHome,
        installation.sources.join(','),
        discoveredAt
      );

    const row = this.db
      .prepare('SELECT id FROM installations WHERE konan_home = ?')
      .get(installation.konanHome) as { id: number };

    return row.id;
  }

  private upsertDataset(
    installationId: number,
    kotlinVersion: string,
    target: string,
    indexedAt: string
  ): number {
    this.db
      .prepare(
        `
          INSERT INTO datasets (installation_id, kotlin_version, target, indexed_at, record_count, framework_count)
          VALUES (?, ?, ?, ?, 0, 0)
          ON CONFLICT(installation_id, target) DO UPDATE SET
            kotlin_version = excluded.kotlin_version,
            indexed_at = excluded.indexed_at
        `
      )
      .run(installationId, kotlinVersion, target, indexedAt);

    const row = this.db
      .prepare('SELECT id FROM datasets WHERE installation_id = ? AND target = ?')
      .get(installationId, target) as { id: number };

    return row.id;
  }

  private upsertFramework(datasetId: number, item: FrameworkBatchItem, indexedAt: string): number {
    this.db
      .prepare(
        `
          INSERT INTO frameworks (
            dataset_id,
            name,
            source_path,
            source_mtime_ms,
            line_count,
            symbol_count,
            indexed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(dataset_id, name) DO UPDATE SET
            source_path = excluded.source_path,
            source_mtime_ms = excluded.source_mtime_ms,
            line_count = excluded.line_count,
            symbol_count = excluded.symbol_count,
            indexed_at = excluded.indexed_at
        `
      )
      .run(
        datasetId,
        item.source.name,
        item.source.directoryPath,
        item.source.sourceMtimeMs,
        item.lineCount,
        item.records.length,
        indexedAt
      );

    const row = this.db
      .prepare('SELECT id FROM frameworks WHERE dataset_id = ? AND name = ?')
      .get(datasetId, item.source.name) as { id: number };

    return row.id;
  }

  private upsertSymbol(params: {
    readonly datasetId: number;
    readonly frameworkId: number;
    readonly kotlinVersion: string;
    readonly konanHome: string;
    readonly target: string;
    readonly framework: string;
    readonly record: ParsedSignatureRecord;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO symbols (
            dataset_id,
            framework_id,
            kotlin_version,
            konan_home,
            target,
            framework,
            package_name,
            class_name,
            member_name,
            member_name_normalized,
            objc_selector,
            objc_selector_normalized,
            objc_selector_compact,
            raw_signature,
            raw_signature_lower,
            searchable_text,
            member_kind,
            is_meta_class
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(dataset_id, framework, raw_signature) DO UPDATE SET
            framework_id = excluded.framework_id,
            kotlin_version = excluded.kotlin_version,
            konan_home = excluded.konan_home,
            target = excluded.target,
            package_name = excluded.package_name,
            class_name = excluded.class_name,
            member_name = excluded.member_name,
            member_name_normalized = excluded.member_name_normalized,
            objc_selector = excluded.objc_selector,
            objc_selector_normalized = excluded.objc_selector_normalized,
            objc_selector_compact = excluded.objc_selector_compact,
            raw_signature_lower = excluded.raw_signature_lower,
            searchable_text = excluded.searchable_text,
            member_kind = excluded.member_kind,
            is_meta_class = excluded.is_meta_class
        `
      )
      .run(
        params.datasetId,
        params.frameworkId,
        params.kotlinVersion,
        params.konanHome,
        params.target,
        params.framework,
        params.record.packageName,
        params.record.className,
        params.record.memberSearchName,
        normalizeText(params.record.memberSearchName),
        params.record.objcSelector,
        params.record.objcSelectorNormalized,
        params.record.objcSelectorCompact,
        params.record.rawSignature,
        params.record.rawSignature.toLowerCase(),
        buildSearchableText(params.record),
        params.record.memberKind,
        params.record.isMetaClass ? 1 : 0
      );
  }

  private deleteFrameworkData(datasetId: number, frameworkName: string): void {
    this.db
      .prepare('DELETE FROM symbol_search WHERE dataset_id = ? AND framework = ?')
      .run(datasetId, frameworkName);
    this.db
      .prepare('DELETE FROM symbols WHERE dataset_id = ? AND framework = ?')
      .run(datasetId, frameworkName);
    this.db
      .prepare('DELETE FROM frameworks WHERE dataset_id = ? AND name = ?')
      .run(datasetId, frameworkName);
  }

  private syncFrameworkSearchIndex(datasetId: number, frameworkName: string): void {
    this.db
      .prepare('DELETE FROM symbol_search WHERE dataset_id = ? AND framework = ?')
      .run(datasetId, frameworkName);

    const rows = this.db
      .prepare(
        `
          SELECT id, dataset_id, framework, package_name, class_name, member_name, objc_selector, raw_signature
          FROM symbols
          WHERE dataset_id = ? AND framework = ?
        `
      )
      .all(datasetId, frameworkName) as Array<{
      id: number;
      dataset_id: number;
      framework: string;
      package_name: string;
      class_name: string | null;
      member_name: string;
      objc_selector: string | null;
      raw_signature: string;
    }>;

    const insertStatement = this.db.prepare(
      `
        INSERT INTO symbol_search (
          symbol_id,
          dataset_id,
          framework,
          package_name,
          class_name,
          member_name,
          objc_selector,
          raw_signature
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    for (const row of rows) {
      insertStatement.run(
        row.id,
        row.dataset_id,
        row.framework,
        row.package_name,
        row.class_name ?? '',
        row.member_name,
        row.objc_selector ?? '',
        row.raw_signature
      );
    }
  }

  private refreshFrameworkStats(
    datasetId: number,
    frameworkName: string,
    lineCount: number,
    indexedAt: string
  ): void {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS symbolCount
          FROM symbols
          WHERE dataset_id = ? AND framework = ?
        `
      )
      .get(datasetId, frameworkName) as { symbolCount: number };

    this.db
      .prepare(
        `
          UPDATE frameworks
          SET line_count = ?, symbol_count = ?, indexed_at = ?
          WHERE dataset_id = ? AND name = ?
        `
      )
      .run(lineCount, row.symbolCount, indexedAt, datasetId, frameworkName);
  }

  private refreshDatasetStats(datasetId: number, indexedAt: string): void {
    const row = this.db
      .prepare(
        `
          SELECT
            (SELECT COUNT(*) FROM symbols WHERE dataset_id = ?) AS recordCount,
            (SELECT COUNT(*) FROM frameworks WHERE dataset_id = ?) AS frameworkCount
        `
      )
      .get(datasetId, datasetId) as { recordCount: number; frameworkCount: number };

    this.db
      .prepare(
        `
          UPDATE datasets
          SET record_count = ?, framework_count = ?, indexed_at = ?
          WHERE id = ?
        `
      )
      .run(row.recordCount, row.frameworkCount, indexedAt, datasetId);
  }

  private queryStage(
    stage: SearchMatchType,
    query: SearchSymbolsQuery,
    limit: number
  ): SearchResultItem[] {
    switch (stage) {
      case 'exact':
        return this.queryExact(query, limit);
      case 'prefix':
        return this.queryPrefix(query, limit);
      case 'fts':
        return this.queryFts(query, limit);
      case 'fuzzy':
        return this.queryFuzzy(query, limit);
      default:
        return [];
    }
  }

  private queryExact(query: SearchSymbolsQuery, limit: number): SearchResultItem[] {
    const filters = this.buildSymbolFilters(query, 'symbols');
    const normalizedQuery = normalizeText(query.query);
    const normalizedSelector = normalizeSelector(query.query) ?? normalizedQuery;
    const compactQuery = compactSelector(query.query) ?? normalizedQuery;
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM symbols
          WHERE ${filters.clause}
            AND (
              member_name_normalized = ?
              OR objc_selector_normalized = ?
              OR objc_selector_compact = ?
            )
          ORDER BY framework ASC, COALESCE(class_name, '') ASC, member_name ASC
          LIMIT ?
        `
      )
      .all(
        ...filters.params,
        normalizedQuery,
        normalizedSelector,
        compactQuery,
        limit
      ) as SymbolRow[];

    return rows.map((row) => this.mapSearchResult(row, 'exact', query.includeRawSignature));
  }

  private queryPrefix(query: SearchSymbolsQuery, limit: number): SearchResultItem[] {
    const filters = this.buildSymbolFilters(query, 'symbols');
    const normalizedQuery = `${escapeLikePattern(normalizeText(query.query))}%`;
    const normalizedSelector = `${escapeLikePattern(normalizeSelector(query.query) ?? normalizeText(query.query))}%`;
    const compactQuery = `${escapeLikePattern(compactSelector(query.query) ?? normalizeText(query.query))}%`;
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM symbols
          WHERE ${filters.clause}
            AND (
              member_name_normalized LIKE ? ESCAPE '\\'
              OR COALESCE(objc_selector_normalized, '') LIKE ? ESCAPE '\\'
              OR COALESCE(objc_selector_compact, '') LIKE ? ESCAPE '\\'
            )
          ORDER BY framework ASC, COALESCE(class_name, '') ASC, member_name ASC
          LIMIT ?
        `
      )
      .all(
        ...filters.params,
        normalizedQuery,
        normalizedSelector,
        compactQuery,
        limit
      ) as SymbolRow[];

    return rows.map((row) => this.mapSearchResult(row, 'prefix', query.includeRawSignature));
  }

  private queryFts(query: SearchSymbolsQuery, limit: number): SearchResultItem[] {
    const ftsQuery = buildFtsQuery(query.query);

    if (!ftsQuery) {
      return [];
    }

    const filters = this.buildSymbolFilters(query, 's');
    const rows = this.db
      .prepare(
        `
          SELECT s.*
          FROM symbol_search
          JOIN symbols s ON s.id = CAST(symbol_search.symbol_id AS INTEGER)
          WHERE ${filters.clause}
            AND symbol_search MATCH ?
          ORDER BY bm25(symbol_search), s.framework ASC, COALESCE(s.class_name, '') ASC, s.member_name ASC
          LIMIT ?
        `
      )
      .all(...filters.params, ftsQuery, limit) as SymbolRow[];

    return rows.map((row) => this.mapSearchResult(row, 'fts', query.includeRawSignature));
  }

  private queryFuzzy(query: SearchSymbolsQuery, limit: number): SearchResultItem[] {
    const filters = this.buildSymbolFilters(query, 'symbols');
    const normalizedContains = `%${escapeLikePattern(normalizeText(query.query))}%`;
    const compactContains = `%${escapeLikePattern(compactSelector(query.query) ?? normalizeText(query.query))}%`;
    const normalizedPrefix = `${escapeLikePattern(normalizeText(query.query))}%`;
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM symbols
          WHERE ${filters.clause}
            AND (
              searchable_text LIKE ? ESCAPE '\\'
              OR COALESCE(objc_selector_compact, '') LIKE ? ESCAPE '\\'
              OR raw_signature_lower LIKE ? ESCAPE '\\'
            )
          ORDER BY
            CASE
              WHEN member_name_normalized LIKE ? ESCAPE '\\' THEN 0
              ELSE 1
            END,
            framework ASC,
            COALESCE(class_name, '') ASC,
            member_name ASC
          LIMIT ?
        `
      )
      .all(
        ...filters.params,
        normalizedContains,
        compactContains,
        normalizedContains,
        normalizedPrefix,
        limit
      ) as SymbolRow[];

    return rows.map((row) => this.mapSearchResult(row, 'fuzzy', query.includeRawSignature));
  }

  private buildSymbolFilters(
    query: Pick<SearchSymbolsQuery, 'kotlinVersion' | 'targets' | 'frameworks' | 'includeMetaClasses'>,
    alias: string
  ): { clause: string; params: Array<number | string> } {
    const clauses = [`${alias}.kotlin_version = ?`];
    const params: Array<number | string> = [query.kotlinVersion];

    if (query.targets.length > 0) {
      clauses.push(`${alias}.target IN (${query.targets.map(() => '?').join(', ')})`);
      params.push(...query.targets);
    }

    if (query.frameworks.length > 0) {
      clauses.push(`${alias}.framework IN (${query.frameworks.map(() => '?').join(', ')})`);
      params.push(...query.frameworks);
    }

    if (!query.includeMetaClasses) {
      clauses.push(`${alias}.is_meta_class = 0`);
    }

    return {
      clause: clauses.join(' AND '),
      params,
    };
  }

  private mapSearchResult(
    row: SymbolRow,
    matchType: SearchMatchType,
    includeRawSignature: boolean
  ): SearchResultItem {
    const declarationForm = resolveDeclarationForm(row.raw_signature);

    return {
      id: row.id,
      kotlinVersion: row.kotlin_version,
      konanHome: row.konan_home,
      target: row.target,
      framework: row.framework,
      packageName: row.package_name,
      className: row.class_name,
      memberName: row.member_name,
      objcSelector: row.objc_selector,
      memberKind: row.member_kind as SearchResultItem['memberKind'],
      declarationForm,
      isMetaClass: row.is_meta_class === 1,
      matchType,
      ...(includeRawSignature ? { rawSignature: row.raw_signature } : {}),
    };
  }
}

function resolveStages(matchMode: SearchMatchMode): SearchMatchType[] {
  switch (matchMode) {
    case 'exact':
      return ['exact'];
    case 'prefix':
      return ['prefix'];
    case 'fuzzy':
      return ['fts', 'fuzzy'];
    case 'auto':
    default:
      return ['exact', 'prefix', 'fts', 'fuzzy'];
  }
}

function buildSearchableText(record: ParsedSignatureRecord): string {
  return [
    record.packageName,
    record.className ?? '',
    record.memberSearchName,
    record.objcSelector ?? '',
    record.rawSignature,
  ]
    .join(' ')
    .toLowerCase();
}

function resolveDeclarationForm(rawSignature: string): SymbolDeclarationForm {
  if (/\|null\[\d+\]$/.test(rawSignature)) {
    return 'class';
  }

  if (/\|.+\.objc:[^\[]+\[\d+\]$/.test(rawSignature)) {
    return 'objc_bridge_extension';
  }

  return 'direct_member';
}