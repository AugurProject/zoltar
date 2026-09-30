import { requiredArrayItem } from '../../../browser/api-decoding.ts'
import type { DemoEnvironment } from './environment.ts'

export async function demoCatalogRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context, counters } = env
	const { demoState } = env.settings
	const { demoCatalog } = env.fixtures
	counters.catalogRequests++
	if (counters.reorgObserved && context.pageUrl.searchParams.get('canonicalRouteRefreshError') === '1' && !counters.canonicalRouteRefreshErrorConsumed) {
		counters.canonicalRouteRefreshErrorConsumed = true
		throw new Error('The system state could not be refreshed')
	}
	if (demoState === 'error' && !counters.errorConsumed) {
		counters.errorConsumed = true
		throw new Error('The state catalog could not be read from the database')
	}
	if (demoState === 'loading') return await new Promise(() => {})
	if (demoState === 'delayed') await new Promise(resolve => setTimeout(resolve, 300))
	const request = new URL(path, location.origin)
	const chainId = request.searchParams.get('chainId')
	let catalogSize: number | undefined
	if (context.pageUrl.searchParams.get('entity5001') === '1') catalogSize = 5_001
	else if (context.pageUrl.searchParams.get('entity1201') === '1') catalogSize = 1_201
	else if (context.pageUrl.searchParams.get('entity501') === '1') catalogSize = 501
	if (context.pageUrl.searchParams.get('catalogDual501') === '1' && chainId === '1') {
		const poolTemplate = requiredArrayItem(demoCatalog.pools, 0, 'Demo pool')
		const questionTemplate = requiredArrayItem(demoCatalog.questions, 0, 'Demo question')
		const limit = Math.min(Math.max(Number(request.searchParams.get('limit') ?? 500), 1), 1_000)
		const offset = Number(request.searchParams.get('offset') ?? 0)
		if (offset > 0) counters.dualCatalogShifted = true
		const interiorReplace = context.pageUrl.searchParams.get('catalogInteriorReplace') === '1'
		const allPools = Array.from({ length: 501 }, (_, index) => ({ ...poolTemplate, pool_address: `0x${((index + 1) * (interiorReplace ? 2 : 1)).toString(16).padStart(40, '0')}` }))
		if (counters.dualCatalogShifted && interiorReplace) allPools[99] = { ...poolTemplate, pool_address: `0x${(201).toString(16).padStart(40, '0')}` }
		else if (counters.dualCatalogShifted) {
			allPools.shift()
			allPools.push({ ...poolTemplate, pool_address: `0x${(502).toString(16).padStart(40, '0')}` })
		}
		const allQuestions = Array.from({ length: 501 }, (_, index) => ({ ...questionTemplate, question_id: String(index + 1), title: `Question ${index + 1}` }))
		return {
			...demoCatalog,
			catalogVersion: counters.dualCatalogShifted ? '1'.repeat(32) : demoCatalog.catalogVersion,
			pools: allPools.slice(offset, offset + limit),
			questions: allQuestions.slice(offset, offset + limit),
			vaults: demoCatalog.vaults.slice(offset, offset + limit),
			universes: demoCatalog.universes.slice(offset, offset + limit),
			poolStates: [],
			limit,
			offset,
			totals: { pools: 501, vaults: demoCatalog.vaults.length, questions: 501, universes: demoCatalog.universes.length },
			truncated: { pools: offset + limit < 501, vaults: false, questions: offset + limit < 501, universes: false },
		}
	}
	if (context.pageUrl.searchParams.get('pool501') === '1' && chainId === '1') {
		const template = requiredArrayItem(demoCatalog.pools, 0, 'Demo pool')
		const limit = 500
		const offset = Number(request.searchParams.get('offset') ?? 0)
		const interiorReplace = context.pageUrl.searchParams.get('pool501LiveInterior') === '1'
		if (offset > 0 && (context.pageUrl.searchParams.get('pool501LiveShift') === '1' || interiorReplace) && counters.liveSequence >= 2) counters.poolLiveShifted = true
		const allPools = Array.from({ length: 501 }, (_, index) => ({ ...template, pool_address: `0x${((index + 1) * (interiorReplace ? 2 : 1)).toString(16).padStart(40, '0')}` }))
		if (counters.poolLiveShifted && interiorReplace) allPools[99] = { ...template, pool_address: `0x${(201).toString(16).padStart(40, '0')}` }
		else if (counters.poolLiveShifted) {
			allPools.shift()
			allPools.push({ ...template, pool_address: `0x${(502).toString(16).padStart(40, '0')}` })
		}
		const pools = allPools.slice(offset, offset + limit)
		const refreshedTail = offset > 0 && context.pageUrl.searchParams.get('pool501Live') === '1' && counters.liveSequence >= 2
		return {
			...demoCatalog,
			catalogVersion: counters.poolLiveShifted ? '1'.repeat(32) : demoCatalog.catalogVersion,
			pools,
			vaults: demoCatalog.vaults.slice(offset, offset + limit),
			questions: demoCatalog.questions.slice(offset, offset + limit),
			universes: demoCatalog.universes.slice(offset, offset + limit),
			poolStates: pools.map(pool => ({
				chain_id: pool.chain_id,
				pool_address: pool.pool_address,
				event_name: 'CurrentDemoState',
				state: { systemState: refreshedTail ? '3' : '2', awaitingForkContinuation: false, totalRepBackingUnits: String((refreshedTail ? 84n : 42n) * 10n ** 18n), shareTokenSupplyAttoShares: String(10n * 10n ** 18n) },
				block_number: '100',
				log_index: 0,
			})),
			limit,
			offset,
			totals: { pools: 501, vaults: demoCatalog.vaults.length, questions: demoCatalog.questions.length, universes: demoCatalog.universes.length },
			truncated: { pools: offset + limit < 501, vaults: false, questions: false, universes: false, poolStates: false },
		}
	}
	if (catalogSize !== undefined && chainId === '1') {
		const template = requiredArrayItem(demoCatalog.questions, 0, 'Demo question')
		const limit = Math.min(Math.max(Number(request.searchParams.get('limit') ?? 500), 1), 1_000)
		const offset = Number(request.searchParams.get('offset') ?? 0)
		const query = request.searchParams.get('q')?.toLowerCase()
		const shiftMode = context.pageUrl.searchParams.get('catalogShiftOnMore')
		if (offset > 0 && (shiftMode === '1' || shiftMode === 'replace')) counters.catalogShifted = true
		const allQuestions = Array.from({ length: catalogSize }, (_, index) => ({ ...template, question_id: String(index + 1), title: `Question ${index + 1}` })).slice(counters.catalogShifted ? 1 : 0)
		if (counters.catalogShifted && shiftMode === 'replace') allQuestions.push({ ...template, question_id: String(catalogSize + 1), title: `Question ${catalogSize + 1}` })
		const matching = query ? allQuestions.filter(item => item.title.toLowerCase().includes(query) || item.question_id.includes(query)) : allQuestions
		const questions = matching.slice(offset, offset + limit)
		const selectedIdentity = request.searchParams.get('selectedType') === 'questions' && !query ? request.searchParams.get('selectedIdentity') : null
		if (selectedIdentity !== null && !questions.some(item => item.question_id === selectedIdentity)) {
			const selected = allQuestions.find(item => item.question_id === selectedIdentity)
			if (selected !== undefined) questions.push(selected)
		}
		return {
			...demoCatalog,
			catalogVersion: counters.catalogShifted ? '1'.repeat(32) : demoCatalog.catalogVersion,
			pools: demoCatalog.pools.slice(offset, offset + limit),
			vaults: demoCatalog.vaults.slice(offset, offset + limit),
			questions,
			universes: demoCatalog.universes.slice(offset, offset + limit),
			limit,
			offset,
			totals: { pools: demoCatalog.pools.length, vaults: demoCatalog.vaults.length, questions: allQuestions.length, universes: demoCatalog.universes.length },
			truncated: { pools: false, vaults: false, questions: offset + limit < matching.length, universes: false },
		}
	}
	return {
		catalogVersion: demoCatalog.catalogVersion,
		pools: demoCatalog.pools.filter(item => !chainId || item.chain_id === chainId),
		vaults: demoCatalog.vaults.filter(item => !chainId || item.chain_id === chainId),
		questions: demoCatalog.questions.filter(item => !chainId || item.chain_id === chainId),
		universes: demoCatalog.universes.filter(item => !chainId || item.chain_id === chainId),
		totals: {
			pools: demoCatalog.pools.filter(item => !chainId || item.chain_id === chainId).length,
			vaults: demoCatalog.vaults.filter(item => !chainId || item.chain_id === chainId).length,
			questions: demoCatalog.questions.filter(item => !chainId || item.chain_id === chainId).length,
			universes: demoCatalog.universes.filter(item => !chainId || item.chain_id === chainId).length,
		},
	}
}
