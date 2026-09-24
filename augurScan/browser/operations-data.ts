import type { OperationsDetailRoute, PagedOperationsCatalogSection } from './browser-types.ts'
import { decodeOperationsResponseValue, isJsonRecord, operationRecords, operationsCatalogRecords, operationsRiskPagination, operationsRiskRecords, type JsonRecord, type OperationsResponse } from './api-validation.ts'
import { collectCanonicalPages, collectCursorCollections, collectDualCursorCollections, operationsCatalogRecordKey, operationsDetailRecordKey, riskPaginationForCollectedCursors } from './live-update.ts'

export const operationsRiskHistoryKeys = ['stateSnapshots', 'accountingSnapshots', 'lifecycleEvents', 'liquidations'] as const
export const operationsHistoryOffset = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined)

export const createOperationsData = (api: (path: string) => Promise<unknown>, requiredChainId: () => string, getPageUrl: () => URL) => {
	const decodeOperationsResponse = decodeOperationsResponseValue
	const operationsCatalogEndpoint = (section: PagedOperationsCatalogSection, cursor?: string, limit = 100): string => {
		const query = new URLSearchParams({ chainId: requiredChainId(), limit: String(limit) })
		if (section === 'timeline')
			for (const parameter of ['q', 'entityType', 'event', 'address', 'fromBlock', 'toBlock', 'canonical'] as const) {
				const value = getPageUrl().searchParams.get(parameter)
				if (value !== null && value !== '') query.set(parameter, value)
			}
		if (cursor !== undefined) query.set('cursor', cursor)
		return `/api/v1/state/${section}?${query.toString()}`
	}

	const operationsRiskCatalogEndpoint = (poolCursor?: string, vaultCursor?: string, limit = 100): string => {
		const query = new URLSearchParams({ chainId: requiredChainId(), limit: String(limit) })
		const atBlock = getPageUrl().searchParams.get('atBlock')
		if (atBlock !== null && atBlock !== '') query.set('atBlock', atBlock)
		if (poolCursor !== undefined) query.set('poolCursor', poolCursor)
		if (vaultCursor !== undefined) query.set('vaultCursor', vaultCursor)
		return `/api/v1/state/risk?${query.toString()}`
	}

	const catalogOperationsResponse = (response: OperationsResponse, section: PagedOperationsCatalogSection, items: readonly JsonRecord[]): OperationsResponse => ({
		...response,
		data: { ...response.data, [section]: items, _catalogPage: response.data },
	})

	const riskCatalogOperationsResponse = (response: OperationsResponse, pools: readonly JsonRecord[], vaults: readonly JsonRecord[]): OperationsResponse => ({
		...response,
		data: {
			risk: { ...response.data, pools, vaults },
			_riskCatalogPage: response.data,
			totals: {
				pools: isJsonRecord(response.data['pagination']) && typeof response.data['pagination']['poolTotal'] === 'number' ? response.data['pagination']['poolTotal'] : pools.length,
				vaults: isJsonRecord(response.data['pagination']) && typeof response.data['pagination']['vaultTotal'] === 'number' ? response.data['pagination']['vaultTotal'] : vaults.length,
			},
		},
	})

	const OPERATIONS_DETAIL_RESOURCES: Record<OperationsDetailRoute['kind'], string> = {
		auction: 'auctions',
		escalation: 'escalations',
		fork: 'forks',
		pool: 'risk/pools',
		report: 'reports',
		trading: 'trading',
		vault: 'risk/vaults',
	}

	const operationsDetailEndpoint = (route: OperationsDetailRoute, cursor?: string, limit = 100, decisionCursor?: string, decisionLimit = 100): string => {
		const chainId = encodeURIComponent(requiredChainId())
		const identity = route.identity.map(encodeURIComponent).join('/')
		const resource = OPERATIONS_DETAIL_RESOURCES[route.kind]
		const query = new URLSearchParams({ limit: String(limit) })
		const atBlock = getPageUrl().searchParams.get('atBlock')
		if ((route.kind === 'pool' || route.kind === 'vault') && atBlock !== null && atBlock !== '') query.set('atBlock', atBlock)
		if (cursor !== undefined) query.set('cursor', cursor)
		if (route.kind === 'report') {
			query.set('decisionLimit', String(decisionLimit))
			if (decisionCursor !== undefined) query.set('decisionCursor', decisionCursor)
		}
		return `/api/v1/state/${resource}/${chainId}/${identity}?${query.toString()}`
	}

	const detailPageRecord = (data: JsonRecord, key: string): JsonRecord => (isJsonRecord(data[key]) ? data[key] : {})

	const loadOperationsCatalog = async (section: PagedOperationsCatalogSection, retainedCount: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		const snapshot = await collectCanonicalPages(
			async (cursor?: string, limit = 100) => {
				const response = decodeOperationsResponse(await api(operationsCatalogEndpoint(section, cursor, limit)))
				first ??= response
				last = response
				return {
					items: operationsCatalogRecords(section, response.data['items'], true),
					...(response.data['hasMore'] === true && typeof response.data['nextCursor'] === 'string' ? { nextCursor: response.data['nextCursor'] } : {}),
				}
			},
			retainedCount,
			item => operationsCatalogRecordKey(section, item),
		)
		if (first === undefined || last === undefined) throw new Error('Operations catalog returned no page')
		return catalogOperationsResponse(
			{
				...first,
				data: { ...last.data, hasMore: snapshot.nextCursor !== undefined, ...(snapshot.nextCursor === undefined ? {} : { nextCursor: snapshot.nextCursor }) },
			},
			section,
			snapshot.items,
		)
	}

	const loadOperationsRiskCatalog = async (poolTargetCount: number, vaultTargetCount: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		let snapshotIdentity: string | undefined
		const collected = await collectDualCursorCollections(
			async ({ leftCursor, rightCursor, limit }) => {
				const response = decodeOperationsResponse(await api(operationsRiskCatalogEndpoint(leftCursor, rightCursor, limit)))
				const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
				if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity) throw new Error('Risk catalog changed while older evidence was loading; retry from the latest available block')
				snapshotIdentity ??= responseIdentity
				first ??= response
				last = response
				const pagination = operationsRiskPagination(response.data['pagination'], true)
				return {
					left: operationsRiskRecords('pools', response.data['pools'], true),
					right: operationsRiskRecords('vaults', response.data['vaults'], true),
					...(pagination['poolHasMore'] === true && typeof pagination['poolNextCursor'] === 'string' ? { leftNextCursor: pagination['poolNextCursor'] } : {}),
					...(pagination['vaultHasMore'] === true && typeof pagination['vaultNextCursor'] === 'string' ? { rightNextCursor: pagination['vaultNextCursor'] } : {}),
				}
			},
			poolTargetCount,
			vaultTargetCount,
			item => String(item['pool_address'] ?? ''),
			item => `${String(item['pool_address'] ?? '')}:${String(item['vault_address'] ?? '')}`,
		)
		if (first === undefined || last === undefined) throw new Error('Risk catalog returned no page')
		const pagination = isJsonRecord(last.data['pagination']) ? last.data['pagination'] : {}
		return riskCatalogOperationsResponse(
			{
				...first,
				data: {
					...last.data,
					pagination: riskPaginationForCollectedCursors(pagination, collected.leftNextCursor, collected.rightNextCursor),
				},
			},
			collected.left,
			collected.right,
		)
	}

	const loadOperationsRiskDetail = async (route: OperationsDetailRoute, throughOffset: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		let snapshotIdentity: string | undefined
		const collected = await collectCursorCollections(
			async cursor => {
				const response = decodeOperationsResponse(await api(operationsDetailEndpoint(route, cursor, 100)))
				const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
				if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity) throw new Error('Risk history changed while older evidence was loading; retry from the latest available block')
				snapshotIdentity ??= responseIdentity
				first ??= response
				last = response
				const history = detailPageRecord(response.data, 'history')
				const offset = operationsHistoryOffset(history['offset'])
				const nextCursor = history['nextCursor']
				if (offset === undefined) throw new Error('Risk history page offset is malformed')
				if (history['truncated'] === true && typeof nextCursor !== 'string') throw new Error('Risk history continuation is malformed')
				if (history['truncated'] !== true && nextCursor !== undefined) throw new Error('Risk history completion is malformed')
				return {
					collections: {
						stateSnapshots: operationRecords(history['stateSnapshots']),
						accountingSnapshots: operationRecords(history['accountingSnapshots']),
						lifecycleEvents: operationRecords(history['lifecycleEvents']),
						liquidations: operationRecords(history['liquidations']),
					},
					offset,
					...(history['truncated'] === true && typeof nextCursor === 'string' ? { nextCursor } : {}),
				}
			},
			operationsRiskHistoryKeys,
			throughOffset,
		)
		if (first === undefined || last === undefined) throw new Error('Risk detail returned no page')
		const lastHistory = detailPageRecord(last.data, 'history')
		return {
			...first,
			data: {
				...first.data,
				history: {
					...lastHistory,
					...collected.collections,
					offset: 0,
					loadedOffset: collected.loadedOffset,
					truncated: collected.nextCursor !== undefined,
					...(collected.nextCursor === undefined ? {} : { nextCursor: collected.nextCursor }),
				},
			},
		}
	}

	const loadOperationsReportDetail = async (route: OperationsDetailRoute, roundTargetCount: number, decisionTargetCount: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let lastRoundPage: Record<string, unknown> = {}
		let lastDecisionPage: Record<string, unknown> = {}
		let snapshotIdentity: string | undefined
		const fetchPage = async (cursor: string | undefined, limit: number, collection: 'decisions' | 'rounds') => {
			const response = decodeOperationsResponse(await api(operationsDetailEndpoint(route, collection === 'rounds' ? cursor : undefined, collection === 'rounds' ? limit : 1, collection === 'decisions' ? cursor : undefined, collection === 'decisions' ? limit : 1)))
			const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
			if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity) throw new Error('Report evidence changed while older evidence was loading; retry from the latest available block')
			snapshotIdentity ??= responseIdentity
			first ??= response
			const page = detailPageRecord(response.data, collection === 'rounds' ? 'rounds' : 'coordinatorDecisions')
			if (collection === 'rounds') lastRoundPage = page
			else lastDecisionPage = page
			return {
				items: operationRecords(page['items']),
				...(page['hasMore'] === true && typeof page['nextCursor'] === 'string' ? { nextCursor: page['nextCursor'] } : {}),
			}
		}
		const [rounds, decisions] = await Promise.all([collectCanonicalPages((cursor, limit = 100) => fetchPage(cursor, limit, 'rounds'), roundTargetCount, operationsDetailRecordKey), collectCanonicalPages((cursor, limit = 100) => fetchPage(cursor, limit, 'decisions'), decisionTargetCount, operationsDetailRecordKey)])
		if (first === undefined) throw new Error('Report detail returned no page')
		return {
			...first,
			data: {
				...first.data,
				rounds: {
					...lastRoundPage,
					items: rounds.items,
					hasMore: rounds.nextCursor !== undefined,
					...(rounds.nextCursor === undefined ? {} : { nextCursor: rounds.nextCursor }),
				},
				coordinatorDecisions: {
					...lastDecisionPage,
					items: decisions.items,
					hasMore: decisions.nextCursor !== undefined,
					...(decisions.nextCursor === undefined ? {} : { nextCursor: decisions.nextCursor }),
				},
			},
		}
	}

	const loadOperationsDetail = async (route: OperationsDetailRoute, retainedCount: number, riskHistoryThroughOffset = 0, decisionTargetCount = 0): Promise<OperationsResponse> => {
		if (route.kind === 'pool' || route.kind === 'vault') return await loadOperationsRiskDetail(route, riskHistoryThroughOffset)
		if (route.kind === 'report') return await loadOperationsReportDetail(route, retainedCount, decisionTargetCount)
		const pageKey = 'events'
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		const snapshot = await collectCanonicalPages(
			async (cursor?: string, limit = 100) => {
				const response = decodeOperationsResponse(await api(operationsDetailEndpoint(route, cursor, limit)))
				first ??= response
				last = response
				const page = detailPageRecord(response.data, pageKey)
				return {
					items: operationRecords(page['items']),
					...(page['hasMore'] === true && typeof page['nextCursor'] === 'string' ? { nextCursor: page['nextCursor'] } : {}),
				}
			},
			retainedCount,
			operationsDetailRecordKey,
		)
		if (first === undefined || last === undefined) throw new Error('Operations detail returned no page')
		const lastPage = detailPageRecord(last.data, pageKey)
		return {
			...first,
			data: {
				...first.data,
				[pageKey]: {
					...lastPage,
					items: snapshot.items,
					hasMore: snapshot.nextCursor !== undefined,
					...(snapshot.nextCursor === undefined ? {} : { nextCursor: snapshot.nextCursor }),
				},
			},
		}
	}

	return { loadOperationsCatalog, loadOperationsRiskCatalog, loadOperationsDetail }
}
