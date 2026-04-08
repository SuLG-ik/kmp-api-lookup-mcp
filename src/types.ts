export type SearchMatchMode = 'auto' | 'exact' | 'prefix' | 'fuzzy';
export type SearchMatchType = 'exact' | 'prefix' | 'fts' | 'fuzzy';
export type SymbolDeclarationForm = 'class' | 'direct_member' | 'objc_bridge_extension';
export type IndexedMemberKind = 'class' | 'constructor' | 'member';
export type LookupQueryKind = 'auto' | 'class' | 'member';
export type LookupDetailLevel = 'compact' | 'full';
export type LookupResultKind = 'class' | 'member' | 'ambiguous' | 'not_found';
export type LookupMemberKind = 'constructor' | 'function' | 'property';
export type LookupClassKind = 'class' | 'interface' | 'object' | 'companion';
export type LookupMemberScope = 'instance' | 'class';

export interface DiscoveredInstallation {
  readonly kotlinVersion: string;
  readonly konanHome: string;
  readonly klibBinaryPath: string;
  readonly platformRootPath: string;
  readonly availableTargets: string[];
  readonly sources: string[];
}

export interface FrameworkSource {
  readonly name: string;
  readonly directoryPath: string;
  readonly sourceMtimeMs: number;
}

export interface ParsedSignatureRecord {
  readonly framework: string;
  readonly packageName: string;
  readonly className: string | null;
  readonly memberName: string;
  readonly memberSearchName: string;
  readonly memberKind: IndexedMemberKind;
  readonly declarationForm: SymbolDeclarationForm;
  readonly objcSelector: string | null;
  readonly objcSelectorNormalized: string | null;
  readonly objcSelectorCompact: string | null;
  readonly rawSignature: string;
  readonly isMetaClass: boolean;
}

export interface LookupRequest {
  readonly query: string;
  readonly frameworks?: string[];
  readonly kotlinVersion?: string;
  readonly target?: string;
  readonly queryKind?: LookupQueryKind;
  readonly detail?: LookupDetailLevel;
  readonly limit?: number;
}

export interface LookupSymbolSignature {
  readonly name: string;
  readonly kind: LookupMemberKind;
  readonly scope: LookupMemberScope;
  readonly declarationForm: Exclude<SymbolDeclarationForm, 'class'>;
  readonly kotlinSignature: string;
  readonly objcSelector: string | null;
  readonly requiredImports: string[];
}

export interface LookupPropertyAccessors {
  readonly getter: boolean;
  readonly setter: boolean;
}

export interface LookupCompactCallableSummary {
  readonly name: string;
  readonly kotlinSignatures: string[];
  readonly objcSelectors: string[];
  readonly requiredImports: string[];
}

export interface LookupCompactPropertySummary {
  readonly name: string;
  readonly kotlinSignature: string;
  readonly mutable: boolean;
  readonly accessors: LookupPropertyAccessors;
  readonly requiredImports: string[];
}

interface LookupClassCardBase {
  readonly framework: string;
  readonly packageName: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: LookupClassKind;
  readonly kotlinSignature: string;
  readonly extendsType: string | null;
  readonly implementsTypes: string[];
  readonly requiredImports: string[];
}

export interface LookupFullClassCard extends LookupClassCardBase {
  readonly detailLevel: 'full';
  readonly totalConstructors: number;
  readonly totalMembers: number;
  readonly totalClassMembers: number;
  readonly omittedConstructors: number;
  readonly omittedMembers: number;
  readonly omittedClassMembers: number;
  readonly constructors: LookupSymbolSignature[];
  readonly members: LookupSymbolSignature[];
  readonly classMembers: LookupSymbolSignature[];
}

export interface LookupCompactClassCard extends LookupClassCardBase {
  readonly detailLevel: 'compact';
  readonly constructors: LookupCompactCallableSummary[];
  readonly properties: LookupCompactPropertySummary[];
  readonly methods: LookupCompactCallableSummary[];
  readonly classMethods: LookupCompactCallableSummary[];
}

export type LookupClassCard = LookupFullClassCard | LookupCompactClassCard;

interface LookupMemberCardBase {
  readonly framework: string;
  readonly packageName: string;
  readonly ownerName: string;
  readonly ownerQualifiedName: string;
  readonly ownerKind: LookupClassKind;
  readonly detailLevel: LookupDetailLevel;
  readonly name: string;
  readonly requiredImports: string[];
}

export interface LookupFullMemberCard extends LookupMemberCardBase {
  readonly detailLevel: 'full';
  readonly ownerKotlinSignature: string;
  readonly extendsType: string | null;
  readonly implementsTypes: string[];
  readonly totalEntries: number;
  readonly omittedEntries: number;
  readonly entries: LookupSymbolSignature[];
}

export interface LookupCompactMemberCard extends LookupMemberCardBase {
  readonly detailLevel: 'compact';
  readonly kind: LookupMemberKind;
  readonly kotlinSignatures: string[];
  readonly objcSelectors: string[];
  readonly accessors: LookupPropertyAccessors | null;
  readonly mutable: boolean | null;
}

export type LookupMemberCard = LookupFullMemberCard | LookupCompactMemberCard;

export interface LookupAlternative {
  readonly resultKind: 'class' | 'member';
  readonly framework: string;
  readonly packageName: string;
  readonly ownerName: string | null;
  readonly symbolName: string;
}

export interface LookupResponse {
  readonly query: string;
  readonly effectiveKotlinVersion: string;
  readonly effectiveTarget: string;
  readonly detailLevel: LookupDetailLevel;
  readonly resultKind: LookupResultKind;
  readonly classCard: LookupClassCard | null;
  readonly memberCard: LookupMemberCard | null;
  readonly alternatives: LookupAlternative[];
}

export interface IndexedDatasetSummary {
  readonly kotlinVersion: string;
  readonly konanHome: string;
  readonly target: string;
  readonly indexedAt: string;
  readonly recordCount: number;
  readonly frameworkCount: number;
  readonly frameworks: string[];
}

export interface SearchRequest {
  readonly query: string;
  readonly frameworks?: string[];
  readonly kotlinVersion?: string;
  readonly target?: string;
  readonly matchMode?: SearchMatchMode;
  readonly limit?: number;
  readonly includeMetaClasses?: boolean;
  readonly includeRawSignature?: boolean;
}

export interface SearchResultItem {
  readonly id: number;
  readonly kotlinVersion: string;
  readonly konanHome: string;
  readonly target: string;
  readonly framework: string;
  readonly packageName: string;
  readonly className: string | null;
  readonly memberName: string;
  readonly objcSelector: string | null;
  readonly memberKind: IndexedMemberKind;
  readonly declarationForm: SymbolDeclarationForm;
  readonly isMetaClass: boolean;
  readonly matchType: SearchMatchType;
  readonly rawSignature?: string;
}

export interface SearchResponse {
  readonly query: string;
  readonly effectiveKotlinVersion: string;
  readonly effectiveTargets: string[];
  readonly availableTargets: string[];
  readonly selectedFrameworks: string[];
  readonly matchMode: SearchMatchMode;
  readonly limit: number;
  readonly includeMetaClasses: boolean;
  readonly includeRawSignature: boolean;
  readonly totalResults: number;
  readonly noResults: boolean;
  readonly results: SearchResultItem[];
}

export interface ExplainResponse {
  readonly query: string;
  readonly effectiveKotlinVersion: string;
  readonly effectiveTargets: string[];
  readonly matchMode: SearchMatchMode;
  readonly includeMetaClasses: boolean;
  readonly noResults: boolean;
  readonly symbol: SearchResultItem | null;
}

export interface DiscoveryResponse {
  readonly explicitKonanHome: string | null;
  readonly installations: DiscoveredInstallation[];
}

export interface RecordCounts {
  readonly datasets: number;
  readonly frameworks: number;
  readonly symbols: number;
}

export interface ServerConfigSummary {
  readonly serverName: string;
  readonly version: string;
  readonly cacheDir: string;
  readonly dbPath: string;
  readonly metadataPath: string;
  readonly konanScanRoot: string;
  readonly defaultSearchLimit: number;
  readonly defaultMatchMode: SearchMatchMode;
  readonly defaultIncludeMetaClasses: boolean;
  readonly defaultIncludeRawSignature: boolean;
  readonly storageDriver: string;
  readonly freshnessStrategy: string;
  readonly autoIndexing: 'manual-error';
  readonly searchTargetFallback: 'all-indexed-targets';
  readonly searchVersionFallback: 'latest-indexed-version';
}

export interface RebuildRequest {
  readonly kotlinVersion?: string;
  readonly konanHome?: string;
  readonly target?: string;
  readonly frameworks?: string[];
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly cleanBefore?: boolean;
}

export interface FrameworkRebuildReport {
  framework: string;
  action: 'rebuild' | 'skip-fresh';
  lineCount: number;
  symbolCount: number;
  reason?: string;
}

export interface RebuildResult {
  readonly kotlinVersion: string;
  readonly target: string;
  readonly selectedFrameworks: string[];
  readonly rebuiltFrameworks: string[];
  readonly skippedFrameworks: string[];
  readonly dryRun: boolean;
  readonly indexedAt: string | null;
  readonly totalRecordsWritten: number;
  readonly reports: FrameworkRebuildReport[];
}

export interface StoredState {
  readonly lastRebuildAt: string | null;
  readonly lastRebuild: RebuildResult | null;
}

export interface StatusResponse {
  readonly ready: boolean;
  readonly discoveredInstallations: Array<{
    readonly kotlinVersion: string;
    readonly availableTargets: string[];
    readonly sources: string[];
  }>;
  readonly indexedDatasets: Array<{
    readonly kotlinVersion: string;
    readonly target: string;
    readonly indexedAt: string;
    readonly recordCount: number;
    readonly frameworkCount: number;
    readonly frameworks: string[];
  }>;
  readonly recordCounts: RecordCounts;
  readonly lastRebuildAt: string | null;
}

export interface ToolService {
  lookup(request: LookupRequest): Promise<LookupResponse>;
  getStatus(): Promise<StatusResponse>;
  rebuild(request: RebuildRequest): Promise<RebuildResult>;
}