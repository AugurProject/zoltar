import { decodeItemsPage, isAccountTransaction, requiredArrayItem } from '../../../browser/api-decoding.ts'
import { shortIdentifier } from '../../../browser/identifier-format.ts'
import { demoTradingPnl } from '../demo-fixtures.ts'
import { demoAddress, demoHash } from './chain-fixtures.ts'
import type { DemoApi, DemoEnvironment } from './environment.ts'
import { demoOperations } from './operations.ts'

export async function demoAddressPortfolioRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context, counters } = env
	const { claimState } = env.settings
	const { demoRichList, claimPosition } = env.fixtures
	const request = new URL(path, location.origin)
	const chainId = request.searchParams.get('chainId') ?? '1'
	const address = request.searchParams.get('address')?.toLowerCase()
	const item = demoRichList.find(candidate => candidate.chain_id === chainId && candidate.address.toLowerCase() === address)
	const operations = demoOperations(env, chainId)
	const more = context.pageUrl.searchParams.get('portfolioMore') === '1'
	const lpCursor = request.searchParams.get('lpCursor')
	const forkCursor = request.searchParams.get('forkCursor')
	const reportCursor = request.searchParams.get('reportCursor')
	const continuationRequested = lpCursor !== null || forkCursor !== null || reportCursor !== null
	if (continuationRequested && context.pageUrl.searchParams.get('portfolioAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
	if (continuationRequested && context.pageUrl.searchParams.get('portfolioAppendError') === '1' && !counters.portfolioAppendErrorConsumed) {
		counters.portfolioAppendErrorConsumed = true
		throw new Error('Additional account evidence could not be loaded')
	}
	const lpPositions = [
		{
			market_address: lpCursor === null ? demoAddress('a7') : demoAddress('a8'),
			pool_address: demoAddress('7'),
			question_title: 'Will the protocol meet its launch reliability target?',
			balance: '4250000000000000000',
			transfer_count: 6,
		},
	]
	const forkParticipation = [
		{
			universe_identity: forkCursor === null ? '0' : '1',
			event_name: 'MigrationRepAdded',
			block_number: String(BigInt(operations.asOf.blockNumber) - BigInt(forkCursor === null ? 0 : 100)),
			block_hash: demoHash,
			tx_hash: forkCursor === null ? `0x${'a'.repeat(64)}` : `0x${'b'.repeat(64)}`,
			log_index: 1,
		},
	]
	const reportParticipation = [
		{
			open_oracle_address: demoAddress('9'),
			report_id: reportCursor === null ? '1842' : '1841',
			event_name: 'ReportSubmitted',
			round_number: '2',
			block_number: String(BigInt(operations.asOf.blockNumber) - BigInt(reportCursor === null ? 0 : 100)),
			block_hash: demoHash,
			tx_hash: reportCursor === null ? `0x${'c'.repeat(64)}` : `0x${'d'.repeat(64)}`,
			log_index: 2,
		},
	]
	return {
		chainId,
		asOf: operations.asOf,
		data: {
			...(item ?? {
				chain_id: chainId,
				address: address ?? demoAddress('1'),
				availability: 'Awaiting indexed evidence',
			}),
			share_positions: {
				items: [{ token: demoAddress('2'), universe_id: '0', invalid_atto_shares: '1000000000000000000', yes_atto_shares: '3000000000000000001', no_atto_shares: '2000000000000000000', complete_sets_atto_shares: '1000000000000000000', migration_locked: false }],
				truncated: false,
				basis: 'Canonical indexed transfers',
			},
			pending_refunds: [{ auction_address: demoAddress('8'), pending_atto_eth: '100000000000000001' }],
			escalation_payouts: {
				items: claimState === 'unavailable' ? [] : [{ game_address: demoAddress('7'), snapshot_block: operations.asOf.blockNumber, snapshot_block_hash: demoHash, position: claimPosition }],
				unavailable_games: claimState === 'unavailable' ? '1' : '0',
				truncated_games: '0',
				sampled_games: '1',
				truncated: false,
			},
			escalation_positions: [{ game_address: demoAddress('7'), deposit_index: '4', principal_atto_rep: '2000000000000000000', final_resolution: '1', outcome: '1', resolution_block: operations.asOf.blockNumber }],
			lp_positions: lpPositions,
			trading_pnl: demoTradingPnl(demoAddress('fa')),
			fork_participation: forkParticipation,
			report_participation: reportParticipation,
			portfolioPagination: {
				lp: {
					total: more ? 2 : 1,
					limit: 100,
					offset: lpCursor === null ? 0 : 1,
					hasMore: more && lpCursor === null,
					...(more && lpCursor === null ? { nextCursor: 'demo-lp-older' } : {}),
				},
				forks: {
					total: more ? 2 : 1,
					limit: 100,
					offset: forkCursor === null ? 0 : 1,
					hasMore: more && forkCursor === null,
					...(more && forkCursor === null ? { nextCursor: 'demo-fork-older' } : {}),
				},
				reports: {
					total: more ? 2 : 1,
					limit: 100,
					offset: reportCursor === null ? 0 : 1,
					hasMore: more && reportCursor === null,
					...(more && reportCursor === null ? { nextCursor: 'demo-report-older' } : {}),
				},
			},
		},
	}
}

export async function demoAddressTransactionsRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context, counters } = env
	const { demoNetworks, demoRichList, demoInitialTransactionCounts, demoNetworkBaselines } = env.fixtures
	const request = new URL(path, location.origin)
	const chainId = request.searchParams.get('chainId')
	const address = request.searchParams.get('address')?.toLowerCase()
	const cursor = request.searchParams.get('cursor')
	counters.transactionRequests++
	window.__demoTransactionRequests = counters.transactionRequests
	if (context.pageUrl.searchParams.get('transactionAppendDelay') === '1' && cursor !== null) await new Promise(resolve => setTimeout(resolve, 1_500))
	if (context.pageUrl.searchParams.get('transactionAppendErrorOnce') === '1' && cursor !== null && !counters.transactionAppendErrorConsumed) {
		counters.transactionAppendErrorConsumed = true
		throw new Error('The next transaction page could not be read')
	}
	if ((context.pageUrl.searchParams.get('transactionLiveRefreshDelay') === '1' || context.pageUrl.searchParams.get('transactionLiveRefreshDelayLong') === '1') && !context.canonicalRefreshRequired && cursor === null && counters.transactionRequests > 1)
		await new Promise(resolve => setTimeout(resolve, context.pageUrl.searchParams.get('transactionLiveRefreshDelayLong') === '1' ? 3_500 : 800))
	if (context.pageUrl.searchParams.get('transactionRestoreDelay') === '1' && context.canonicalRefreshRequired && cursor === null && counters.transactionRequests > 1) await new Promise(resolve => setTimeout(resolve, 800))
	if (context.pageUrl.searchParams.get('transactionRestoreErrorOnce') === '1' && cursor === null && counters.transactionRequests > 1 && !counters.transactionRestoreErrorConsumed) {
		counters.transactionRestoreErrorConsumed = true
		throw new Error('The account transactions could not be restored')
	}
	if (cursor !== null && ((context.pageUrl.searchParams.get('transactionCursor409') === '1' && !counters.transactionSnapshotInvalidated) || context.pageUrl.searchParams.get('transactionCursor409Always') === '1')) {
		if (context.pageUrl.searchParams.get('transactionCursor409Always') !== '1') counters.transactionSnapshotInvalidated = true
		const error = new Error('The transaction snapshot changed after a chain update')
		error.status = 409
		throw error
	}
	if (context.pageUrl.searchParams.get('transactionRefreshError') === '1' && cursor === null && counters.transactionRequests > 1) throw new Error('The newest account transactions could not be read')
	if (counters.reorgObserved && context.pageUrl.searchParams.get('evictTransactionOnReorg') === '1') counters.transactionSnapshotInvalidated = true
	const offset = cursor ? Number(JSON.parse(atob(cursor))) : 0
	const limit = Number(request.searchParams.get('limit') ?? 50)
	const owner = demoRichList.find(item => item.chain_id === chainId && item.address.toLowerCase() === address)
	const total = Math.max(0, Number(owner?.transaction_count ?? 0) - (counters.transactionSnapshotInvalidated ? 1 : 0))
	const network = demoNetworks.find(item => item.chain_id === chainId)
	const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, itemIndex) => {
		const index = offset + itemIndex + (counters.transactionSnapshotInvalidated ? 1 : 0)
		const initialTotal = demoInitialTransactionCounts.get(`${chainId}:${address}`) ?? total
		const ordinal = Number(owner?.transaction_count ?? 0) - index - 1
		const liveOrdinal = ordinal - initialTotal
		const baseline = chainId === null ? undefined : demoNetworkBaselines.get(chainId)
		const blockNumber = liveOrdinal >= 0 ? (baseline?.blockNumber ?? 0n) + BigInt(liveOrdinal + 1) : (baseline?.blockNumber ?? 0n) - BigInt(Math.max(0, initialTotal - ordinal - 1))
		const blockTimestamp = new Date((baseline?.timestamp ?? Date.now()) + (liveOrdinal >= 0 ? liveOrdinal + 1 : -(initialTotal - ordinal - 1)) * 14_000)
		const toAddress = ordinal % 2 === 0 ? '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db' : '0x7777777777777777777777777777777777777777'
		return {
			chain_id: chainId,
			tx_hash: `${demoHash.slice(0, -8)}${ordinal.toString(16).padStart(8, '0')}`,
			block_hash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
			block_number: String(blockNumber),
			block_timestamp: blockTimestamp.toISOString(),
			transaction_index: ordinal % 12,
			from_address: owner?.address,
			to_address: toAddress,
			to_label: ordinal % 2 === 0 ? 'OpenOracle' : 'Security Pool',
			to_kind: ordinal % 2 === 0 ? 'openOracle' : 'securityPool',
			value: ordinal % 4 === 0 ? '125000000000000000' : '0',
			status: 'success',
			gas_used: String(94_000 + ordinal * 117),
			function_name: ordinal % 2 === 0 ? 'report' : 'checkpointPoolAccounting',
			function_signature: ordinal % 2 === 0 ? 'report((...),bool,bool,(...))' : 'checkpointPoolAccounting(uint8)',
			action_summary: ordinal % 2 === 0 ? 'report · reportId=1842' : 'checkpointPoolAccounting · reason=Trade',
			action_arguments:
				ordinal % 2 === 0
					? {
							reporter: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
							recipients: ['0x7777777777777777777777777777777777777777', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
						}
					: { reason: '1' },
			action_display_arguments:
				ordinal % 2 === 0
					? {
							reporter: 'OpenOracle (0xc9b36e44643fc5d882654ffd9791ae7171b0e9db)',
							recipients: ['Security Pool (0x7777777777777777777777777777777777777777)', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
						}
					: { reason: 'Trade' },
			action_argument_schema:
				ordinal % 2 === 0
					? [
							{ index: 0, name: 'reporter', type: 'address' },
							{ index: 1, name: 'recipients', type: 'address[]' },
						]
					: [{ index: 0, name: 'reason', type: 'uint8' }],
			explorer_base_url: network?.explorer_base_url ?? '',
		}
	})
	const nextOffset = offset + items.length
	return { items, total, limit, snapshotBlock: network?.indexed_block, nextCursor: nextOffset < total ? btoa(JSON.stringify(nextOffset)) : undefined }
}

export async function demoAddressInteractionsRoute(path: string, api: DemoApi): Promise<unknown> {
	const transactions = decodeItemsPage(await api(path.replace('/address-interactions', '/address-transactions')), isAccountTransaction, 'Address transactions')
	return {
		...transactions,
		items: transactions.items
			.filter((_, index) => index % 3 === 0)
			.map((transaction, index) => ({
				...transaction,
				roles: ['referenced'],
				pool_addresses: index % 2 === 0 ? ['0x7777777777777777777777777777777777777777'] : [],
			})),
	}
}

export async function demoAddressIdentityRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { demoRichList, demoPools, demoUniverses } = env.fixtures
	const request = new URL(path, location.origin)
	const chainId = request.searchParams.get('chainId')
	const address = request.searchParams.get('address')?.toLowerCase()
	const owner = demoRichList.find(item => item.chain_id === chainId && item.address.toLowerCase() === address)
	const fixedIdentities: Record<string, readonly [string, string]> = {
		'0xc9b36e44643fc5d882654ffd9791ae7171b0e9db': ['OpenOracle', 'openOracle'],
		'0x7777777777777777777777777777777777777777': ['Security Pool', 'securityPool'],
	}
	const fixedIdentity = address === undefined ? undefined : fixedIdentities[address]
	const catalogIdentity = [
		...demoPools.flatMap(pool => [
			[pool.chain_id, pool.pool_address, 'Security Pool', 'securityPool'],
			[pool.chain_id, pool.share_token_address, 'Share token', 'shareToken'],
			[pool.chain_id, pool.coordinator_address, 'Price coordinator', 'priceCoordinator'],
			[pool.chain_id, pool.truth_auction_address, 'Truth auction', 'truthAuction'],
		]),
		...demoUniverses.map(universe => [universe.chain_id, universe.reputation_token_address, universe.universe_id === '0' ? 'Genesis REP' : `Child REP · universe ${shortIdentifier(universe.universe_id)}`, 'reputationToken']),
		...demoRichList.flatMap(item => [...(item.rep_balances ?? []), ...(item.weth_balances ?? [])].map(token => [item.chain_id, token.address, 'contractLabel' in token ? token.contractLabel : token.name, 'universeId' in token ? 'reputationToken' : 'weth'])),
	].find((identity): identity is [string, string, string, string] => identity.length === 4 && typeof identity[0] === 'string' && typeof identity[1] === 'string' && typeof identity[3] === 'string' && identity[0] === chainId && identity[1].toLowerCase() === address)
	return {
		chainId: Number(chainId),
		address: address ?? '',
		label: owner?.label ?? fixedIdentity?.[0] ?? catalogIdentity?.[2],
		kind: owner?.kind ?? fixedIdentity?.[1] ?? catalogIdentity?.[3],
	}
}

export async function demoRichListRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context, counters } = env
	const { demoRichList } = env.fixtures
	counters.richListRequests++
	const request = new URL(path, location.origin)
	if (context.pageUrl.searchParams.get('richRouteRefreshDelayAfterLoad') === '1' && counters.richListRequests > 1 && Number(request.searchParams.get('offset') ?? 0) === 0) {
		counters.routeRequestsInFlight++
		window.__demoRouteRequestsInFlight = counters.routeRequestsInFlight
		try {
			await new Promise(resolve => setTimeout(resolve, 1_500))
		} finally {
			counters.routeRequestsInFlight--
			window.__demoRouteRequestsInFlight = counters.routeRequestsInFlight
		}
	}
	const richRefreshErrorRequest = Number(context.pageUrl.searchParams.get('routeRefreshErrorRequest'))
	if (((context.pageUrl.searchParams.get('routeRefreshErrorAfterLoad') === '1' && counters.richListRequests > 1) || (Number.isInteger(richRefreshErrorRequest) && richRefreshErrorRequest > 0 && counters.richListRequests === richRefreshErrorRequest)) && !counters.routeRefreshErrorConsumed) {
		counters.routeRefreshErrorConsumed = true
		throw new Error('The newest account rankings could not be read')
	}
	if (counters.reorgObserved && context.pageUrl.searchParams.get('canonicalRouteRefreshError') === '1' && !counters.canonicalRouteRefreshErrorConsumed) {
		counters.canonicalRouteRefreshErrorConsumed = true
		throw new Error('The account state could not be refreshed')
	}
	const chainId = request.searchParams.get('chainId')
	const address = request.searchParams.get('address')?.toLowerCase()
	const offset = Number(request.searchParams.get('offset') ?? 0)
	const limit = Number(request.searchParams.get('limit') ?? 50)
	if (context.pageUrl.searchParams.get('richAppendDelay') === '1' && offset > 0) await new Promise(resolve => setTimeout(resolve, 1_500))
	const filtered = demoRichList.filter(item => (!chainId || item.chain_id === chainId) && (!address || item.address.toLowerCase() === address) && !(counters.reorgObserved && context.pageUrl.searchParams.get('evictAccountOnReorg') === '1' && item.address.toLowerCase() === counters.evictedAddress))
	const ranked =
		context.pageUrl.searchParams.get('richPaginationDemo') === '1' && address === undefined && filtered.length > 0
			? Array.from({ length: 120 }, (_, index) => ({
					...requiredArrayItem(filtered, index % filtered.length, 'Demo rich-list pagination template'),
					address: `0x${BigInt(index + 1)
						.toString(16)
						.padStart(40, '0')}`,
				}))
			: filtered
	return { items: ranked.slice(offset, offset + limit), total: ranked.length, limit, offset }
}
