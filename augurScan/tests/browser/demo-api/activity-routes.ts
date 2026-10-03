import { requiredArrayItem } from '../../../browser/api-decoding.ts'
import { demoAddress } from './chain-fixtures.ts'
import type { DemoEnvironment } from './environment.ts'

export async function demoSearchRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { demoLogs } = env.fixtures
	const request = new URL(path, location.origin)
	const query = request.searchParams.get('q')?.toLowerCase() ?? ''
	const chainId = request.searchParams.get('chainId') ?? '1'
	const items = [
		...demoLogs
			.filter(log => log.chain_id === chainId && log.tx_hash.toLowerCase().includes(query))
			.slice(0, 1)
			.map(log => ({ type: 'transaction', label: log.tx_hash, href: `/tx/${log.tx_hash}?chainId=${chainId}` })),
		...demoLogs
			.filter(log => log.chain_id === chainId && log.block_number.includes(query))
			.slice(0, 1)
			.map(log => ({ type: 'block', label: `Block #${log.block_number}`, href: `/block/${log.block_number}?chainId=${chainId}` })),
	]
	return { items, query, chainId }
}

export async function demoTransactionRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { demoLogs } = env.fixtures
	const [, , , , chainId, hash] = path.split('/')
	const log = demoLogs.find(item => item.chain_id === chainId && item.tx_hash === hash)
	if (log === undefined) throw new Error('Transaction not found')
	return {
		transaction: {
			hash,
			block_hash: log.block_hash,
			block_number: log.block_number,
			block_timestamp: log.block_timestamp,
			from_address: log.origin_address,
			to_address: log.emitter_address,
			status: 'success',
			value: '1000000000000000001',
			receipt:
				env.context.pageUrl.searchParams.get('traceStatus') === 'not-requested'
					? { selectionSource: 'protocol-log', callTraceStatus: 'not-requested' }
					: { callTraceStatus: 'available', callTrace: { type: 'CALL', from: log.origin_address, to: log.emitter_address, value: '0xde0b6b3a7640001', calls: [{ type: 'CALL', from: log.emitter_address, to: demoAddress('7'), value: '0x1', error: 'execution reverted' }] } },
			gas_used: '184220',
			action_summary: log.action_summary,
			explorer_base_url: 'https://etherscan.io',
		},
		logs: demoLogs.filter(item => item.tx_hash === hash).map(item => ({ ...item, emitter_address: item.emitter_address })),
	}
}

export async function demoBlockRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context } = env
	const { demoLogs } = env.fixtures
	const [, , , , chainId, number] = path.split('/')
	const logs = demoLogs.filter(item => item.chain_id === chainId && item.block_number === number)
	if (logs.length === 0) throw new Error('Block not found')
	const sample = context.pageUrl.searchParams.get('block251') === '1'
	const transactions = sample ? Array.from({ length: 250 }, (_, index) => ({ hash: `0x${index.toString(16).padStart(64, '0')}`, action_summary: 'Indexed transaction' })) : logs.map(item => ({ hash: item.tx_hash, action_summary: item.action_summary }))
	return {
		block: { number, hash: logs[0]?.block_hash, timestamp: logs[0]?.block_timestamp, parent_hash: '0x' + '0'.repeat(64), finalized: true, explorer_base_url: 'https://etherscan.io' },
		transactions,
		hasMore: sample,
		sampleLimit: 250,
	}
}

const demoNetworkItems = (env: DemoEnvironment) => {
	const { networkState } = env.settings
	const { demoNetworks } = env.fixtures
	if (networkState === 'stale') return demoNetworks.map(network => ({ ...network, last_success_at: new Date(Date.now() - 120_000).toISOString() }))
	if (networkState === 'stale-head')
		return demoNetworks.map(network => ({
			...network,
			indexed_block: network.observed_block,
			indexed_timestamp: new Date(Date.now() - 120_000).toISOString(),
			phase: 'live',
		}))
	if (networkState !== 'future-start') return demoNetworks
	return demoNetworks.map(network => ({
		...network,
		start_block: (BigInt(network.observed_block) + 1n).toString(),
		indexed_block: null,
		indexed_hash: null,
		indexed_timestamp: null,
		phase: 'live',
	}))
}

export async function demoNetworksRoute(env: DemoEnvironment): Promise<unknown> {
	const { context, counters } = env
	const { networkState } = env.settings
	if (networkState === 'error') throw new Error('Network status could not be refreshed')
	counters.networkRequests++
	const items = demoNetworkItems(env)
	return {
		items: context.pageUrl.searchParams.get('networkFallbackAfterLoad') === '1' && counters.networkRequests > 1 ? items.filter(network => network.chain_id !== '1') : items,
	}
}

export async function demoContractsRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { deploymentState } = env.settings
	const { demoContracts } = env.fixtures
	const chainId = new URL(path, location.origin).searchParams.get('chainId')
	const items = demoContracts.filter(contract => contract.chain_id === chainId)
	if (deploymentState === 'bounded' && items[0] !== undefined)
		items[0] = {
			...items[0],
			deployment_block: '0',
			deployment_block_exact: false,
			deployment_timestamp: '2021-10-03T13:24:41.000Z',
		}
	if (deploymentState === 'absent' && items[0] !== undefined) items[0] = { ...items[0], deployment_block: null, deployment_block_exact: null, deployment_timestamp: null, deployment_checked_block: '0' }
	return { items }
}

export async function demoLogDetailRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context, counters } = env
	const { detailState } = env.settings
	const { demoNetworks, demoLogs } = env.fixtures
	if (detailState === 'error' && !counters.detailErrorConsumed) {
		counters.detailErrorConsumed = true
		throw new Error('The receipt could not be read from the RPC')
	}
	if (detailState === 'loading') return await new Promise(() => {})
	const [, , , , requestedChainId, , requestedTransactionHash, requestedLogIndex] = path.split('/')
	if (counters.reorgObserved && context.pageUrl.searchParams.get('logRemovedOnReorg') === '1') {
		const error = new Error('The log was replaced after a chain update')
		error.status = 404
		throw error
	}
	const detailLog = demoLogs.find(item => item.chain_id === requestedChainId && item.tx_hash === requestedTransactionHash && item.log_index === Number(requestedLogIndex)) ?? requiredArrayItem(demoLogs, 0, 'Demo log detail')
	const detailNetwork = demoNetworks.find(network => network.chain_id === detailLog.chain_id)
	return {
		...detailLog,
		block_timestamp: detailLog.block_timestamp,
		origin_address: '0x1A620F3dC4Dba34F365C9233C34A22f8F48D2D34',
		to_address: '0x7777777777777777777777777777777777777777',
		value: '0',
		input: '0x4f8b2f2d',
		gas_used: '184220',
		contract_provenance: context.pageUrl.searchParams.get('detailLiveDemo') === '1' ? `Security Pool Factory.DeploySecurityPool · indexed block ${detailNetwork?.indexed_block}` : 'Security Pool Factory.DeploySecurityPool',
		explorer_base_url: detailNetwork?.id === 'sepolia' ? 'https://sepolia.etherscan.io' : 'https://etherscan.io',
		action_arguments: {
			reason: '1',
			route: ['0xc9b36e44643fc5d882654ffd9791ae7171b0e9db', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
		},
		action_display_arguments: {
			reason: 'Trade',
			route: ['OpenOracle (0xc9b36e44643fc5d882654ffd9791ae7171b0e9db)', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
		},
		action_argument_schema: [
			{ index: 0, name: 'reason', type: 'uint8' },
			{ index: 1, name: 'route', type: 'address[]' },
		],
		receipt: {
			transactionHash: detailLog.tx_hash,
			blockHash: detailLog.block_hash,
			blockNumber: detailLog.block_number,
			status: 'success',
			gasUsed: '184220',
			logs: demoLogs.slice(0, 4).map(({ emitter_address: address, topics, data, log_index: logIndex }) => ({ address, topics, data, logIndex })),
		},
		event_signature: 'event PoolAccountingCheckpoint(address indexed securityPool, uint256 totalRepBackingUnits)',
		function_signature: 'checkpoint(uint8,address[])',
		action_summary: 'checkpoint(reason=Trade)',
		relatedLogs: demoLogs.slice(0, 4),
	}
}

export async function demoLogsRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context, counters } = env
	const { demoState } = env.settings
	const { demoLogs } = env.fixtures
	counters.logRequests++
	const activityRefreshErrorRequest = Number(context.pageUrl.searchParams.get('routeRefreshErrorRequest'))
	if (((context.pageUrl.searchParams.get('routeRefreshErrorAfterLoad') === '1' && counters.logRequests > 1) || (Number.isInteger(activityRefreshErrorRequest) && activityRefreshErrorRequest > 0 && counters.logRequests === activityRefreshErrorRequest)) && !counters.routeRefreshErrorConsumed) {
		counters.routeRefreshErrorConsumed = true
		throw new Error('The newest activity could not be read')
	}
	if (context.pageUrl.searchParams.get('networkFallbackRouteError') === '1' && context.selectedChainId() !== '1' && !counters.networkFallbackErrorConsumed) {
		counters.networkFallbackErrorConsumed = true
		throw new Error('Activity could not be loaded for the fallback network')
	}
	if (context.pageUrl.searchParams.get('reorgRefreshError') === '1' && counters.logRequests > 1 && !counters.reorgRefreshErrorConsumed) {
		counters.reorgRefreshErrorConsumed = true
		throw new Error('Activity could not be refreshed after the chain changed')
	}
	if (demoState === 'error' && !counters.errorConsumed) {
		counters.errorConsumed = true
		throw new Error('RPC history is temporarily unavailable')
	}
	if (demoState === 'loading') return await new Promise(() => {})
	if (demoState === 'delayed-logs') {
		counters.routeRequestsInFlight++
		counters.maxRouteRequestsInFlight = Math.max(counters.maxRouteRequestsInFlight, counters.routeRequestsInFlight)
		window.__demoMaxRouteRequestsInFlight = counters.maxRouteRequestsInFlight
		window.__demoRouteRequestsInFlight = counters.routeRequestsInFlight
		try {
			await new Promise(resolve => setTimeout(resolve, 800))
		} finally {
			counters.routeRequestsInFlight--
			window.__demoRouteRequestsInFlight = counters.routeRequestsInFlight
		}
	}
	const request = new URL(path, location.origin)
	if (context.pageUrl.searchParams.get('logRouteRefreshDelayAfterLoad') === '1' && counters.logRequests > 1 && !request.searchParams.has('cursor')) {
		counters.routeRequestsInFlight++
		window.__demoRouteRequestsInFlight = counters.routeRequestsInFlight
		try {
			await new Promise(resolve => setTimeout(resolve, 1_500))
		} finally {
			counters.routeRequestsInFlight--
			window.__demoRouteRequestsInFlight = counters.routeRequestsInFlight
		}
	}
	const chainId = request.searchParams.get('chainId')
	const event = request.searchParams.get('event')?.toLowerCase()
	const address = request.searchParams.get('address')?.toLowerCase()
	if (context.pageUrl.searchParams.get('logAppendDelay') === '1' && request.searchParams.has('cursor')) await new Promise(resolve => setTimeout(resolve, 3_500))
	if (address && !/^0x[0-9a-f]{40}$/.test(address)) throw new Error('Address filter is invalid')
	const filtered = demoState === 'empty' ? [] : demoLogs.filter(item => (!chainId || item.chain_id === chainId) && (event === undefined || item.event_name?.toLowerCase().includes(event) === true) && (!address || [item.emitter_address, item.origin_address].some(candidate => candidate?.toLowerCase() === address)))
	if (context.pageUrl.searchParams.get('logPaginationDemo') !== '1' || filtered.length === 0) return { items: filtered }
	const expanded = Array.from({ length: 220 }, (_, index) => {
		const ordinal = demoPaginationOrdinal(index, counters.reorgObserved)
		const template = requiredArrayItem(filtered, ordinal % filtered.length, 'Demo activity pagination template')
		return {
			...template,
			block_number: String(23_184_711 - Math.min(ordinal, 219)),
			block_hash: `0x${BigInt(50_000 + ordinal)
				.toString(16)
				.padStart(64, '0')}`,
			tx_hash: `0x${BigInt(100_000 + ordinal)
				.toString(16)
				.padStart(64, '0')}`,
			log_index: ordinal,
			summary: ordinal === 10_000 ? 'Canonical replacement after chain reorganization' : template.summary,
		}
	})
	const encodedCursor = request.searchParams.get('cursor')
	const offset = encodedCursor === null ? 0 : Number(JSON.parse(atob(encodedCursor)))
	const limit = Number(request.searchParams.get('limit') ?? 100)
	const nextOffset = offset + limit
	return { items: expanded.slice(offset, nextOffset), nextCursor: nextOffset < expanded.length ? btoa(JSON.stringify(nextOffset)) : undefined }
}

const demoPaginationOrdinal = (index: number, reorgObserved: boolean) => {
	if (!reorgObserved) return index
	return index === 0 ? 10_000 : index - 1
}
