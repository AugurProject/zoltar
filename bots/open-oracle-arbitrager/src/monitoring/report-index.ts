import type { Configuration } from '#config/configuration'
import { batchRead, batchValue } from '#core/batch-read'
import type { ReadClient } from '#core/operator-types'
import { requiredBigint, requiredRpcAddress, requiredTuple } from '#core/rpc-validation'
import { openOracleAbi } from '#contracts/abi'
import { zeroAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import { endpointLabel } from '@zoltar/bot-shared/monitoring/connectivity'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'

const PAGE_SIZE = 128n
export type ReportIndexCursor = { historicalEnd: bigint; nextNewId: bigint }

/** @internal Pagination tests verify new reports and historical reports each receive a page, so neither can starve the other. */
export function reportIndexPage(nextReportId: bigint, cursor?: ReportIndexCursor) {
	if (nextReportId < 1n) throw new Error('Invalid OpenOracle report counter')
	const previous = cursor === undefined || cursor.nextNewId > nextReportId ? { historicalEnd: nextReportId, nextNewId: nextReportId } : cursor
	const historicalStart = previous.historicalEnd > PAGE_SIZE ? previous.historicalEnd - PAGE_SIZE : 1n
	const newEnd = previous.nextNewId + PAGE_SIZE < nextReportId ? previous.nextNewId + PAGE_SIZE : nextReportId
	const ids = new Set<bigint>()
	for (let id = historicalStart; id < previous.historicalEnd; id++) ids.add(id)
	for (let id = previous.nextNewId; id < newEnd; id++) ids.add(id)
	// Prioritize the newest reports even while a burst is being caught up.
	for (let id = nextReportId > PAGE_SIZE ? nextReportId - PAGE_SIZE : 1n; id < nextReportId; id++) ids.add(id)
	return { ids: [...ids], cursor: { historicalEnd: historicalStart, nextNewId: newEnd } }
}

type IndexConfiguration = Pick<Configuration, 'network' | 'openOracle' | 'execute' | 'connectivity' | 'quorumRpcUrls' | 'rpcQuorum'>

/** Stored helpers exist for every shared-feed report, including reports older than the log lookback. */
export async function discoverStoredReports(clients: readonly ReadClient[], config: IndexConfiguration, blockNumber: bigint, blockHash: Hex, cursor?: ReportIndexCursor, retainedReportIds: readonly bigint[] = []) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		'OpenOracle report index',
		clients.map(async (client, index) => {
			const assertBlock = async () => {
				if ((await client.getBlock({ blockNumber })).hash?.toLowerCase() !== blockHash.toLowerCase()) throw new Error('Report index block differs from canonical head')
			}
			await assertBlock()
			const count = await client.readContract({ address: config.openOracle, abi: openOracleAbi, functionName: 'nextReportId', blockNumber })
			const page = reportIndexPage(count, cursor)
			if (retainedReportIds.some(id => id < 1n || id >= count)) throw new Error('Retained report is outside the canonical report index')
			const ids = [...new Set([...page.ids, ...retainedReportIds])]
			const results = await batchRead(
				client,
				config.network.multicall3,
				ids.flatMap(id => [
					{ address: config.openOracle, abi: openOracleAbi, functionName: 'storedHelper', args: [id] },
					{ address: config.openOracle, abi: openOracleAbi, functionName: 'storedGame', args: [id] },
				]),
				blockNumber,
			)
			const reports = ids.flatMap((reportId, index) => {
				const helper = requiredTuple(batchValue(results[index * 2], 'Indexed report helper'), 3, 'Indexed report helper')
				const game = requiredTuple(batchValue(results[index * 2 + 1], 'Indexed report game'), 20, 'Indexed report game')
				const creator = requiredRpcAddress(helper[0], 'Indexed report creator')
				return creator === zeroAddress || (requiredBigint(game[4], 'Indexed report settlement timestamp') !== 0n && !retainedReportIds.includes(reportId)) ? [] : [{ reportId, creator }]
			})
			await assertBlock()
			return { endpoint: endpointLabel(endpoints[index] ?? ''), value: { reports, cursor: page.cursor } }
		}),
		config.execute ? config.rpcQuorum : 1,
	)
}
