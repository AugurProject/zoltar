import { demoTimelineEvidenceStatus } from '../../../browser/history-evidence.ts'
import { demoAddress, demoHash } from './chain-fixtures.ts'
import type { DemoEnvironment } from './environment.ts'
import { demoOperations } from './operations.ts'
import { demoOperationsDetail } from './operations-detail.ts'

export async function demoOperationsRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { demoState } = env.settings
	if (demoState === 'loading') return await new Promise(() => {})
	if (demoState === 'error') throw new Error('Operations could not be loaded')
	return demoOperations(env, new URL(path, location.origin).searchParams.get('chainId') ?? '1')
}

export async function demoRiskCatalogRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context } = env
	const { demoState } = env.settings
	if (demoState === 'loading') return await new Promise(() => {})
	if (demoState === 'error') throw new Error('Risk catalog could not be loaded')
	const request = new URL(path, location.origin)
	const chainId = request.searchParams.get('chainId') ?? '1'
	const operations = demoOperations(env, chainId, request.searchParams.get('atBlock') ?? undefined)
	const baseRisk = operations.data.risk
	const more = context.pageUrl.searchParams.get('catalogMore') === '1'
	const poolCursor = request.searchParams.get('poolCursor')
	const vaultCursor = request.searchParams.get('vaultCursor')
	if ((poolCursor !== null || vaultCursor !== null) && context.pageUrl.searchParams.get('catalogAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
	if ((poolCursor !== null || vaultCursor !== null) && context.pageUrl.searchParams.get('catalogAppendError') === '1') throw new Error('Additional risk records could not be loaded')
	const pools = poolCursor === null ? baseRisk.pools : baseRisk.pools.map(pool => ({ ...pool, pool_address: demoAddress('98'), block_number: String(BigInt(operations.asOf.blockNumber) - 100n) }))
	const vaults = vaultCursor === null ? baseRisk.vaults : baseRisk.vaults.map(vault => ({ ...vault, vault_address: demoAddress('c8'), block_number: String(BigInt(operations.asOf.blockNumber) - 100n) }))
	return {
		chainId,
		asOf: operations.asOf,
		data: {
			...baseRisk,
			pools,
			vaults,
			pagination: {
				poolTotal: more ? 2 : pools.length,
				vaultTotal: more ? 2 : vaults.length,
				poolHasMore: more && poolCursor === null,
				vaultHasMore: more && vaultCursor === null,
				...(more && poolCursor === null ? { poolNextCursor: 'demo-pool-older' } : {}),
				...(more && vaultCursor === null ? { vaultNextCursor: 'demo-vault-older' } : {}),
			},
		},
	}
}

export async function demoOperationsCatalogRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context } = env
	const { demoState } = env.settings
	const { demoPools } = env.fixtures
	if (demoState === 'loading') return await new Promise(() => {})
	if (demoState === 'error') throw new Error('Operations catalog could not be loaded')
	const request = new URL(path, location.origin)
	const chainId = request.searchParams.get('chainId') ?? '1'
	const operations = demoOperations(env, chainId, request.searchParams.get('atBlock') ?? undefined)
	const section = request.pathname.split('/').at(-1)
	const timelineFixture = [
		{
			entity_type: 'open-oracle-report',
			entity_identity: '0x529dcaC57677451CBfe766d88CcC133D082500df:1842',
			semantic_event_kind: 'ReportDisputed',
			source_contract: '0x529dcaC57677451CBfe766d88CcC133D082500df',
			block_number: operations.asOf.blockNumber,
			block_hash: operations.asOf.blockHash,
			tx_hash: demoHash,
			log_index: 7,
			canonical: true,
			evidence_status: demoTimelineEvidenceStatus(true),
		},
		{
			entity_type: 'reporter',
			entity_identity: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
			semantic_event_kind: 'ReportDisputed',
			source_contract: '0x529dcaC57677451CBfe766d88CcC133D082500df',
			block_number: operations.asOf.blockNumber,
			block_hash: operations.asOf.blockHash,
			tx_hash: demoHash,
			log_index: 7,
			canonical: true,
			evidence_status: demoTimelineEvidenceStatus(true),
		},
		{
			entity_type: 'open-oracle-report',
			entity_identity: '0x529dcaC57677451CBfe766d88CcC133D082500df:1842',
			semantic_event_kind: 'ReportDisputed',
			source_contract: '0x529dcaC57677451CBfe766d88CcC133D082500df',
			block_number: operations.asOf.blockNumber,
			block_hash: `0x${'4d'.repeat(32)}`,
			tx_hash: `0x${'9b'.repeat(32)}`,
			log_index: 7,
			canonical: false,
			evidence_status: demoTimelineEvidenceStatus(false, 'chain-reorg'),
			invalidation_reason: 'chain-reorg',
		},
	]
	const demoTradingFixture = [
		{
			pair_address: demoAddress('fa'),
			pool_address: demoPools[0]?.pool_address,
			question_title: demoPools[0]?.question_title,
			conditional_yes_bps: '5100',
			swap_count: 63,
			lp_holder_count: 4,
			price_block_number: operations.asOf.blockNumber,
			eth_volume_atto_eth: '48250000000000000000',
			eth_volume_24h_atto_eth: '6400000000000000000',
			eth_volume_7d_atto_eth: '21700000000000000000',
			eth_trade_count: 41,
			eth_trade_count_24h: 5,
		},
	]
	const integrityCombinedCauses = context.pageUrl.searchParams.get('integrityCombinedCauses') === '1'
	const demoIntegrityFixture = [
		{
			id: '1',
			reason: integrityCombinedCauses ? 'projection-rebuild' : 'chain-reorg',
			depth: '2',
			previous_block: operations.asOf.blockNumber,
			previous_hash: demoHash,
			ancestor_block: String(BigInt(operations.asOf.blockNumber) - 2n),
			ancestor_hash: `0x${'1834a6d2b779c501'.repeat(4)}`,
			causes: integrityCombinedCauses ? ['abi-redecode', 'manifest-reset', 'projection-rebuild'] : ['chain-reorg'],
			occurrence_counts: { block: '2', transaction: '9', log: '24', 'entity-state': '6' },
			indexer_run_id: '1',
			abi_source_hash: demoHash.slice(2),
			application_source_hash: `sha256:${demoHash.slice(2)}`,
			projection_source_hash: `sha256:${demoHash.slice(2)}`,
			detected_at: '2026-08-26T12:34:57.814Z',
		},
	]
	const catalogFixtures = new Map<string, () => readonly Readonly<Record<string, unknown>>[]>([
		['reports', () => operations.data.reports],
		['escalations', () => operations.data.escalations],
		['auctions', () => operations.data.auctions],
		['forks', () => operations.data.forks],
		['trading', () => demoTradingFixture],
		['timeline', () => timelineFixture.filter(item => request.searchParams.get('canonical') === 'all' || item.canonical)],
	])
	const fixtureItems = catalogFixtures.get(section ?? '')?.() ?? demoIntegrityFixture
	const items = context.pageUrl.searchParams.get('catalogEmpty') === '1' ? [] : fixtureItems
	const continuationFixture = context.pageUrl.searchParams.get('catalogMore') === '1'
	const cursor = request.searchParams.get('cursor')
	if (continuationFixture && cursor !== null) {
		if (context.pageUrl.searchParams.get('catalogAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
		if (context.pageUrl.searchParams.get('catalogAppendError') === '1') throw new Error('Older canonical records could not be loaded')
		const older = items.at(-1)
		return {
			chainId,
			asOf: operations.asOf,
			data: {
				items: older === undefined ? [] : [{ ...older, block_number: String(BigInt(operations.asOf.blockNumber) - 100n) }],
				...(section === 'forks' || section === 'timeline' ? { total: items.length + 1 } : {}),
				limit: 100,
				hasMore: false,
			},
		}
	}
	return {
		chainId,
		asOf: operations.asOf,
		data: {
			items,
			...(section === 'forks' || section === 'timeline' ? { total: items.length + (continuationFixture ? 1 : 0) } : {}),
			limit: 100,
			hasMore: continuationFixture,
			...(continuationFixture ? { nextCursor: 'demo-older' } : {}),
			...(section === 'integrity'
				? {
						migrations: [{ schema_version: '2', description: 'Historical integrity', applied_at: '2026-08-26T12:30:01.042Z' }],
						runs: [
							{
								id: '1',
								schema_version: '2',
								app_version: '1.0.0',
								abi_source_hash: demoHash.slice(2),
								application_source_hash: `sha256:${demoHash.slice(2)}`,
								projection_source_hash: `sha256:${demoHash.slice(2)}`,
								indexer_enabled: true,
								started_at: '2026-08-26T12:31:04.771Z',
								stopped_at: null,
							},
						],
					}
				: {}),
		},
	}
}

export async function demoOperationsDetailRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context, counters } = env
	const { demoState } = env.settings
	if (demoState === 'loading') return await new Promise(() => {})
	if (demoState === 'error') throw new Error('Operations detail could not be loaded')
	const request = new URL(path, location.origin)
	const riskHistoryContinuation = request.pathname.includes('/risk/') && request.searchParams.has('cursor')
	if (riskHistoryContinuation && context.pageUrl.searchParams.get('riskHistoryAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
	if (riskHistoryContinuation && context.pageUrl.searchParams.get('riskHistoryAppendError') === '1' && !counters.riskHistoryAppendErrorConsumed) {
		counters.riskHistoryAppendErrorConsumed = true
		throw new Error('Older risk history could not be loaded')
	}
	if (request.searchParams.has('cursor') && context.pageUrl.searchParams.get('detailAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
	if (request.searchParams.has('cursor') && context.pageUrl.searchParams.get('detailAppendError') === '1') throw new Error('Older canonical evidence could not be loaded')
	return demoOperationsDetail(env, path)
}
