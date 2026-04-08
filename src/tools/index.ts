import {
	type CallToolResult,
	fromJsonSchema,
	type JsonSchemaType,
	type McpServer,
} from '@modelcontextprotocol/server';

import type {
	LookupRequest,
	LookupResponse,
	RebuildRequest,
	RebuildResult,
	StatusResponse,
	ToolService,
} from '../types.js';

const emptyObjectSchema = fromJsonSchema({
	type: 'object',
	additionalProperties: false,
} satisfies JsonSchemaType);

const stringArraySchema = {
	type: 'array',
	items: { type: 'string' },
} satisfies JsonSchemaType;

const lookupInputSchema = fromJsonSchema<LookupRequest>({
	type: 'object',
	additionalProperties: false,
	properties: {
		query: { type: 'string', minLength: 1 },
		frameworks: stringArraySchema,
		kotlinVersion: { type: 'string' },
		target: { type: 'string' },
		detail: {
			type: 'string',
			enum: ['compact', 'full'],
		},
		queryKind: {
			type: 'string',
			enum: ['auto', 'class', 'member'],
		},
		limit: {
			type: 'integer',
			minimum: 1,
			maximum: 20,
		},
	},
	required: ['query'],
} satisfies JsonSchemaType);

const rebuildInputSchema = fromJsonSchema<RebuildRequest>({
	type: 'object',
	additionalProperties: false,
	properties: {
		kotlinVersion: { type: 'string' },
		konanHome: { type: 'string' },
		target: { type: 'string' },
		frameworks: stringArraySchema,
		force: { type: 'boolean' },
		dryRun: { type: 'boolean' },
		cleanBefore: { type: 'boolean' },
	},
} satisfies JsonSchemaType);

const lookupSymbolSignatureSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		name: { type: 'string' },
		kind: { type: 'string' },
		scope: { type: 'string' },
		declarationForm: { type: 'string' },
		kotlinSignature: { type: 'string' },
		objcSelector: { type: ['string', 'null'] },
		requiredImports: stringArraySchema,
	},
	required: [
		'name',
		'kind',
		'scope',
		'declarationForm',
		'kotlinSignature',
		'objcSelector',
		'requiredImports',
	],
} satisfies JsonSchemaType;

const lookupPropertyAccessorsSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		getter: { type: 'boolean' },
		setter: { type: 'boolean' },
	},
	required: ['getter', 'setter'],
} satisfies JsonSchemaType;

const lookupCompactCallableSummarySchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		name: { type: 'string' },
		kotlinSignatures: stringArraySchema,
		objcSelectors: stringArraySchema,
		requiredImports: stringArraySchema,
	},
	required: ['name', 'kotlinSignatures', 'objcSelectors', 'requiredImports'],
} satisfies JsonSchemaType;

const lookupCompactPropertySummarySchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		name: { type: 'string' },
		kotlinSignature: { type: 'string' },
		mutable: { type: 'boolean' },
		accessors: lookupPropertyAccessorsSchema,
		requiredImports: stringArraySchema,
	},
	required: ['name', 'kotlinSignature', 'mutable', 'accessors', 'requiredImports'],
} satisfies JsonSchemaType;

const lookupFullClassCardSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		framework: { type: 'string' },
		packageName: { type: 'string' },
		name: { type: 'string' },
		qualifiedName: { type: 'string' },
		detailLevel: { type: 'string', enum: ['full'] },
		kind: { type: 'string' },
		kotlinSignature: { type: 'string' },
		extendsType: { type: ['string', 'null'] },
		implementsTypes: stringArraySchema,
		requiredImports: stringArraySchema,
		totalConstructors: { type: 'integer' },
		totalMembers: { type: 'integer' },
		totalClassMembers: { type: 'integer' },
		omittedConstructors: { type: 'integer' },
		omittedMembers: { type: 'integer' },
		omittedClassMembers: { type: 'integer' },
		constructors: {
			type: 'array',
			items: lookupSymbolSignatureSchema,
		},
		members: {
			type: 'array',
			items: lookupSymbolSignatureSchema,
		},
		classMembers: {
			type: 'array',
			items: lookupSymbolSignatureSchema,
		},
	},
	required: [
		'framework',
		'packageName',
		'name',
		'qualifiedName',
		'detailLevel',
		'kind',
		'kotlinSignature',
		'extendsType',
		'implementsTypes',
		'requiredImports',
		'totalConstructors',
		'totalMembers',
		'totalClassMembers',
		'omittedConstructors',
		'omittedMembers',
		'omittedClassMembers',
		'constructors',
		'members',
		'classMembers',
	],
} satisfies JsonSchemaType;

const lookupCompactClassCardSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		framework: { type: 'string' },
		packageName: { type: 'string' },
		name: { type: 'string' },
		qualifiedName: { type: 'string' },
		detailLevel: { type: 'string', enum: ['compact'] },
		kind: { type: 'string' },
		kotlinSignature: { type: 'string' },
		extendsType: { type: ['string', 'null'] },
		implementsTypes: stringArraySchema,
		requiredImports: stringArraySchema,
		constructors: {
			type: 'array',
			items: lookupCompactCallableSummarySchema,
		},
		properties: {
			type: 'array',
			items: lookupCompactPropertySummarySchema,
		},
		methods: {
			type: 'array',
			items: lookupCompactCallableSummarySchema,
		},
		classMethods: {
			type: 'array',
			items: lookupCompactCallableSummarySchema,
		},
	},
	required: [
		'framework',
		'packageName',
		'name',
		'qualifiedName',
		'detailLevel',
		'kind',
		'kotlinSignature',
		'extendsType',
		'implementsTypes',
		'requiredImports',
		'constructors',
		'properties',
		'methods',
		'classMethods',
	],
} satisfies JsonSchemaType;

const lookupClassCardSchema = {
	oneOf: [lookupFullClassCardSchema, lookupCompactClassCardSchema],
} satisfies JsonSchemaType;

const lookupFullMemberCardSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		framework: { type: 'string' },
		packageName: { type: 'string' },
		ownerName: { type: 'string' },
		ownerQualifiedName: { type: 'string' },
		detailLevel: { type: 'string', enum: ['full'] },
		ownerKind: { type: 'string' },
		ownerKotlinSignature: { type: 'string' },
		extendsType: { type: ['string', 'null'] },
		implementsTypes: stringArraySchema,
		name: { type: 'string' },
		requiredImports: stringArraySchema,
		totalEntries: { type: 'integer' },
		omittedEntries: { type: 'integer' },
		entries: {
			type: 'array',
			items: lookupSymbolSignatureSchema,
		},
	},
	required: [
		'framework',
		'packageName',
		'ownerName',
		'ownerQualifiedName',
		'detailLevel',
		'ownerKind',
		'ownerKotlinSignature',
		'extendsType',
		'implementsTypes',
		'name',
		'requiredImports',
		'totalEntries',
		'omittedEntries',
		'entries',
	],
} satisfies JsonSchemaType;

const lookupCompactMemberCardSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		framework: { type: 'string' },
		packageName: { type: 'string' },
		ownerName: { type: 'string' },
		ownerQualifiedName: { type: 'string' },
		ownerKind: { type: 'string' },
		detailLevel: { type: 'string', enum: ['compact'] },
		name: { type: 'string' },
		requiredImports: stringArraySchema,
		kind: { type: 'string' },
		kotlinSignatures: stringArraySchema,
		objcSelectors: stringArraySchema,
		accessors: {
			oneOf: [{ type: 'null' }, lookupPropertyAccessorsSchema],
		},
		mutable: { type: ['boolean', 'null'] },
	},
	required: [
		'framework',
		'packageName',
		'ownerName',
		'ownerQualifiedName',
		'ownerKind',
		'detailLevel',
		'name',
		'requiredImports',
		'kind',
		'kotlinSignatures',
		'objcSelectors',
		'accessors',
		'mutable',
	],
} satisfies JsonSchemaType;

const lookupMemberCardSchema = {
	oneOf: [lookupFullMemberCardSchema, lookupCompactMemberCardSchema],
} satisfies JsonSchemaType;

const lookupOutputSchema = fromJsonSchema<LookupResponse>({
	type: 'object',
	additionalProperties: false,
	properties: {
		query: { type: 'string' },
		effectiveKotlinVersion: { type: 'string' },
		effectiveTarget: { type: 'string' },
		detailLevel: { type: 'string' },
		resultKind: { type: 'string' },
		classCard: {
			oneOf: [{ type: 'null' }, lookupFullClassCardSchema, lookupCompactClassCardSchema],
		},
		memberCard: {
			oneOf: [{ type: 'null' }, lookupFullMemberCardSchema, lookupCompactMemberCardSchema],
		},
		alternatives: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					resultKind: { type: 'string' },
					framework: { type: 'string' },
					packageName: { type: 'string' },
					ownerName: { type: ['string', 'null'] },
					symbolName: { type: 'string' },
				},
				required: ['resultKind', 'framework', 'packageName', 'ownerName', 'symbolName'],
			},
		},
	},
	required: [
		'query',
		'effectiveKotlinVersion',
		'effectiveTarget',
		'detailLevel',
		'resultKind',
		'classCard',
		'memberCard',
		'alternatives',
	],
} satisfies JsonSchemaType);

const rebuildOutputSchema = fromJsonSchema<RebuildResult>({
	type: 'object',
	additionalProperties: false,
	properties: {
		kotlinVersion: { type: 'string' },
		target: { type: 'string' },
		selectedFrameworks: stringArraySchema,
		rebuiltFrameworks: stringArraySchema,
		skippedFrameworks: stringArraySchema,
		dryRun: { type: 'boolean' },
		indexedAt: { type: ['string', 'null'] },
		totalRecordsWritten: { type: 'integer' },
		reports: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					framework: { type: 'string' },
					action: { type: 'string' },
					lineCount: { type: 'integer' },
					symbolCount: { type: 'integer' },
					reason: { type: 'string' },
				},
				required: ['framework', 'action', 'lineCount', 'symbolCount'],
			},
		},
	},
	required: [
		'kotlinVersion',
		'target',
		'selectedFrameworks',
		'rebuiltFrameworks',
		'skippedFrameworks',
		'dryRun',
		'indexedAt',
		'totalRecordsWritten',
		'reports',
	],
} satisfies JsonSchemaType);

const statusOutputSchema = fromJsonSchema<StatusResponse>({
	type: 'object',
	additionalProperties: false,
	properties: {
		ready: { type: 'boolean' },
		discoveredInstallations: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					kotlinVersion: { type: 'string' },
					availableTargets: stringArraySchema,
					sources: stringArraySchema,
				},
				required: ['kotlinVersion', 'availableTargets', 'sources'],
			},
		},
		indexedDatasets: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					kotlinVersion: { type: 'string' },
					target: { type: 'string' },
					indexedAt: { type: 'string' },
					recordCount: { type: 'integer' },
					frameworkCount: { type: 'integer' },
					frameworks: stringArraySchema,
				},
				required: [
					'kotlinVersion',
					'target',
					'indexedAt',
					'recordCount',
					'frameworkCount',
					'frameworks',
				],
			},
		},
		recordCounts: {
			type: 'object',
			additionalProperties: false,
			properties: {
				datasets: { type: 'integer' },
				frameworks: { type: 'integer' },
				symbols: { type: 'integer' },
			},
			required: ['datasets', 'frameworks', 'symbols'],
		},
		lastRebuildAt: { type: ['string', 'null'] },
	},
	required: ['ready', 'discoveredInstallations', 'indexedDatasets', 'recordCounts', 'lastRebuildAt'],
} satisfies JsonSchemaType);

export function registerTools(server: McpServer, service: ToolService): void {
	server.registerTool(
		'lookup_symbol',
		{
			description:
				'Resolve a Kotlin/Native Apple platform class or member into a development card. Compact detail is returned by default; set detail=full to include the full class surface.',
			inputSchema: lookupInputSchema,
			outputSchema: lookupOutputSchema,
		},
		async (args) => handleToolCall(() => service.lookup(args as LookupRequest), formatLookupSummary)
	);

	server.registerTool(
		'rebuild_klib_index',
		{
			description:
				'Build or refresh the local Kotlin/Native klib index. By default, the server picks the latest discovered installation and a preferred iOS target.',
			inputSchema: rebuildInputSchema,
			outputSchema: rebuildOutputSchema,
		},
		async (args) => handleToolCall(() => service.rebuild(args as RebuildRequest), formatRebuildSummary)
	);

	server.registerTool(
		'get_klib_index_status',
		{
			description:
				'Return a compact summary of discovered Kotlin/Native installations, indexed datasets, counts, and last rebuild time.',
			inputSchema: emptyObjectSchema,
			outputSchema: statusOutputSchema,
		},
		async () => handleToolCall(() => service.getStatus(), formatStatusSummary)
	);
}

async function handleToolCall<T>(
	action: () => Promise<T>,
	formatSummary: (result: T) => string
): Promise<CallToolResult> {
	try {
		const result = await action();

		return {
			content: [{ type: 'text', text: formatSummary(result) }],
			structuredContent: result as Record<string, unknown>,
		};
	} catch (error) {
		return {
			isError: true,
			content: [{ type: 'text', text: toErrorMessage(error) }],
		};
	}
}

function formatLookupSummary(result: LookupResponse): string {
	switch (result.resultKind) {
		case 'class':
			if (result.classCard?.detailLevel === 'compact') {
				return `Resolved class ${result.classCard.qualifiedName} in compact mode with ${result.classCard.properties.length} propert(ies), ${result.classCard.methods.length} method group(s), ${result.classCard.classMethods.length} class method group(s), and ${result.classCard.constructors.length} constructor group(s).`;
			}

			return `Resolved class ${result.classCard?.qualifiedName} in full mode with ${result.classCard?.constructors.length ?? 0}/${result.classCard?.totalConstructors ?? 0} constructor(s), ${result.classCard?.members.length ?? 0}/${result.classCard?.totalMembers ?? 0} member(s), and ${result.classCard?.classMembers.length ?? 0}/${result.classCard?.totalClassMembers ?? 0} class member(s).`;
		case 'member':
			if (result.memberCard?.detailLevel === 'compact') {
				return `Resolved ${result.memberCard.kind} ${result.memberCard.ownerQualifiedName}.${result.memberCard.name} in compact mode with ${result.memberCard.kotlinSignatures.length} signature(s).`;
			}

			return `Resolved member ${result.memberCard?.ownerQualifiedName}.${result.memberCard?.name} in full mode with ${result.memberCard?.entries.length ?? 0}/${result.memberCard?.totalEntries ?? 0} signature(s).`;
		case 'ambiguous':
			return `Query "${result.query}" is ambiguous. ${result.alternatives.length} candidate(s) returned.`;
		case 'not_found':
		default:
			return `No symbol matched "${result.query}".`;
	}
}

function formatRebuildSummary(result: RebuildResult): string {
	if (result.dryRun) {
		return `Dry run complete for ${result.kotlinVersion} ${result.target}: ${result.rebuiltFrameworks.length} framework(s) would rebuild and ${result.skippedFrameworks.length} would be skipped.`;
	}

	return `Rebuild complete for ${result.kotlinVersion} ${result.target}: ${result.rebuiltFrameworks.length} framework(s) rebuilt, ${result.totalRecordsWritten} symbol record(s) written.`;
}

function formatStatusSummary(result: StatusResponse): string {
	return `Index ready: ${result.ready}. Datasets: ${result.recordCounts.datasets}, frameworks: ${result.recordCounts.frameworks}, symbols: ${result.recordCounts.symbols}.`;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}