import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor, isJsonArray } from '../cursor-codec.ts'
import { riskCatalogData } from '../repositories/operations.ts'
import { riskHistoryRows } from '../repositories/risk.ts'
import { snapshotBoundary } from './entity-details.ts'
import {
	ApiRequestError,
	cursorTimestamp,
	integer,
	isCursorTimestamp,
	isNonNegativeSafeInteger,
	isPostgresBigint,
	isPostgresInteger,
	json,
	jsonRecord,
	postgresBigint,
	routeInteger,
} from './shared.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'
import { rejectRawSnapshotOffset } from './trading-catalog.ts'

type RiskStatePosition = readonly [blockNumber: string, observedAt: string, id: string]
type RiskEventPosition = readonly [blockNumber: string, logIndex: number, txHash: string, blockHash: string]
type RiskLiquidationPosition = readonly [blockNumber: string, logIndex: number, txHash: string, blockHash: string, entityType: string, entityIdentity: string]
type RiskHistoryPositions = {
	readonly state?: RiskStatePosition
	readonly accounting?: RiskEventPosition
	readonly lifecycle?: RiskEventPosition
	readonly liquidations?: RiskLiquidationPosition
}
type RiskHistoryCursor = readonly [
	version: 1,
	chainId: number,
	domain: 'risk-history',
	identity: string,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	offset: number,
	positions: RiskHistoryPositions,
]

const riskEventPosition = (value: unknown): RiskEventPosition | undefined => {
	if (!Array.isArray(value) || value.length !== 4 || !isPostgresBigint(value[0]) || !isPostgresInteger(value[1])) return undefined
	if (typeof value[2] !== 'string' || !/^0x[0-9a-f]{64}$/.test(value[2]) || typeof value[3] !== 'string' || !/^0x[0-9a-f]{64}$/.test(value[3])) return undefined
	return [value[0], value[1], value[2], value[3]]
}

const riskHistoryPositions = (value: unknown): RiskHistoryPositions | undefined => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const fields = jsonRecord(value)
	const stateValue = fields['state']
	const state =
		stateValue === undefined
			? undefined
			: Array.isArray(stateValue) &&
					stateValue.length === 3 &&
					isPostgresBigint(stateValue[0]) &&
					typeof stateValue[1] === 'string' &&
					isCursorTimestamp(stateValue[1]) &&
					isPostgresBigint(stateValue[2])
				? ([stateValue[0], stateValue[1], stateValue[2]] as const)
				: undefined
	if (stateValue !== undefined && state === undefined) return undefined
	const accounting = riskEventPosition(fields['accounting'])
	if (fields['accounting'] !== undefined && accounting === undefined) return undefined
	const lifecycle = riskEventPosition(fields['lifecycle'])
	if (fields['lifecycle'] !== undefined && lifecycle === undefined) return undefined
	const liquidationValue = fields['liquidations']
	const liquidationBase = riskEventPosition(Array.isArray(liquidationValue) ? liquidationValue.slice(0, 4) : undefined)
	const liquidations =
		liquidationValue === undefined
			? undefined
			: Array.isArray(liquidationValue) &&
					liquidationValue.length === 6 &&
					liquidationBase !== undefined &&
					typeof liquidationValue[4] === 'string' &&
					typeof liquidationValue[5] === 'string'
				? ([...liquidationBase, liquidationValue[4], liquidationValue[5]] as const)
				: undefined
	if (liquidationValue !== undefined && liquidations === undefined) return undefined
	return {
		...(state === undefined ? {} : { state }),
		...(accounting === undefined ? {} : { accounting }),
		...(lifecycle === undefined ? {} : { lifecycle }),
		...(liquidations === undefined ? {} : { liquidations }),
	}
}

const parseRiskHistoryCursor = (value: string | null, chainId: number, identity: string): RiskHistoryCursor | undefined => {
	if (value === null) return undefined
	try {
		const decoded = decodeOpaqueCursor(value)
		const parts = isJsonArray(decoded) ? decoded : []
		const positions = riskHistoryPositions(parts[11])
		if (
			parts.length !== 12 ||
			parts[0] !== 1 ||
			parts[1] !== chainId ||
			parts[2] !== 'risk-history' ||
			parts[3] !== identity ||
			!isPostgresBigint(parts[4]) ||
			typeof parts[5] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[5]) ||
			!isPostgresBigint(parts[6]) ||
			!parts.slice(7, 10).every((part) => typeof part === 'string') ||
			!isNonNegativeSafeInteger(parts[10]) ||
			positions === undefined
		)
			throw new Error('shape')
		return [
			1,
			chainId,
			'risk-history',
			identity,
			String(parts[4]),
			String(parts[5]),
			String(parts[6]),
			String(parts[7]),
			String(parts[8]),
			String(parts[9]),
			Number(parts[10]),
			positions,
		]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

const riskHistoryCursorFor = (chainId: number, identity: string, asOf: Record<string, unknown>, offset: number, positions: RiskHistoryPositions): string =>
	encodeOpaqueCursor([1, chainId, 'risk-history', identity, ...snapshotBoundary(asOf), offset, positions] satisfies RiskHistoryCursor)

export const riskDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const kind = parts[0]
	const chainId = routeInteger(parts[1])
	const poolAddress = parts[2]?.toLowerCase()
	const vaultAddress = parts[3]?.toLowerCase()
	if (
		chainId === undefined ||
		(kind !== 'pools' && kind !== 'vaults') ||
		poolAddress === undefined ||
		!/^0x[0-9a-f]{40}$/.test(poolAddress) ||
		(kind === 'pools' ? parts.length !== 3 : parts.length !== 4 || vaultAddress === undefined || !/^0x[0-9a-f]{40}$/.test(vaultAddress))
	)
		return json({ error: 'Invalid risk entity identifier' }, 400)
	rejectRawSnapshotOffset(url)
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 250
	const limit = Math.min(Math.max(requestedLimit, 1), 1_000)
	const entityIdentity = kind === 'pools' ? poolAddress : `${poolAddress}:${vaultAddress}`
	const historyIdentity = `${kind}:${entityIdentity}`
	const cursor = parseRiskHistoryCursor(url.searchParams.get('cursor'), chainId, historyIdentity)
	const asOf = await operationsAsOfForContinuations(
		sql,
		chainId,
		cursor === undefined ? [] : [{ parts: cursor, offset: 4 }],
		postgresBigint(url.searchParams.get('atBlock'), 'atBlock'),
	)
	const offset = cursor?.[10] ?? 0
	const positions = cursor?.[11] ?? {}
	const risk = await riskCatalogData(sql, chainId, {
		poolAddress,
		...(kind === 'vaults' && vaultAddress !== undefined ? { vaultAddress } : {}),
		limit: 1,
		snapshotBlock: String(asOf['blockNumber']),
	})
	const entity =
		kind === 'pools'
			? risk.pools.find((row: Record<string, unknown>) => row['pool_address'] === poolAddress)
			: risk.vaults.find((row: Record<string, unknown>) => row['pool_address'] === poolAddress && row['vault_address'] === vaultAddress)
	if (entity === undefined) return json({ error: `${kind === 'pools' ? 'Pool' : 'Vault'} risk state not found` }, 404)
	const entityType = kind === 'pools' ? 'pool' : 'vault'
	const { stateSnapshots, accountingSnapshots, lifecycleEvents, liquidations } = await riskHistoryRows(sql, {
		chainId,
		kind,
		poolAddress,
		...(vaultAddress === undefined ? {} : { vaultAddress }),
		entityType,
		entityIdentity,
		asOfBlock: String(asOf['blockNumber']),
		positions,
		limit,
	})
	const historyTruncated = [stateSnapshots, accountingSnapshots, lifecycleEvents, liquidations].some((rows) => rows.length > limit)
	const statePageRows = stateSnapshots.slice(0, limit)
	const pageRows = {
		stateSnapshots: statePageRows.map((row: Record<string, unknown>) =>
			Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'cursor_observed_at')),
		),
		accountingSnapshots: accountingSnapshots.slice(0, limit),
		lifecycleEvents: lifecycleEvents.slice(0, limit),
		liquidations: liquidations.slice(0, limit),
	}
	const lastState = statePageRows.at(-1)
	const lastAccounting = pageRows.accountingSnapshots.at(-1)
	const lastLifecycle = pageRows.lifecycleEvents.at(-1)
	const lastLiquidation = pageRows.liquidations.at(-1)
	const nextPositions: RiskHistoryPositions = {
		...positions,
		...(lastState === undefined
			? {}
			: { state: [String(lastState['block_number']), cursorTimestamp(lastState['cursor_observed_at']), String(lastState['id'])] as const }),
		...(lastAccounting === undefined
			? {}
			: {
					accounting: [
						String(lastAccounting['block_number']),
						Number(lastAccounting['log_index']),
						String(lastAccounting['tx_hash']),
						String(lastAccounting['block_hash']),
					] as const,
				}),
		...(lastLifecycle === undefined
			? {}
			: {
					lifecycle: [
						String(lastLifecycle['block_number']),
						Number(lastLifecycle['log_index']),
						String(lastLifecycle['tx_hash']),
						String(lastLifecycle['block_hash']),
					] as const,
				}),
		...(lastLiquidation === undefined
			? {}
			: {
					liquidations: [
						String(lastLiquidation['block_number']),
						Number(lastLiquidation['log_index']),
						String(lastLiquidation['tx_hash']),
						String(lastLiquidation['block_hash']),
						String(lastLiquidation['entity_type']),
						String(lastLiquidation['entity_identity']),
					] as const,
				}),
	}
	return json({
		chainId,
		asOf,
		data: {
			...entity,
			approvalEvents: risk.approvalEvents,
			history: {
				...pageRows,
				limit,
				offset,
				truncated: historyTruncated,
				nextCursor: historyTruncated ? riskHistoryCursorFor(chainId, historyIdentity, asOf, offset + limit, nextPositions) : undefined,
			},
		},
	})
}
