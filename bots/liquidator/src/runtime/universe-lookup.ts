import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { sharedQuorumReadTargets, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { loadUniverseTree, parseApprovedUniverses } from '@zoltar/bot-shared/monitoring/universe-policy'
import type { LiquidatorRuntime } from './liquidator-runtime.ts'

/** Operator-requested discovery is independent of the latency-sensitive scan. */
export async function lookupUniverseLineages(runtime: LiquidatorRuntime, ids: readonly bigint[]) {
	const { client, settings } = runtime
	const readers = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ endpoint, client: createPublicClient({ chain: runtime.chain, transport: runtime.readPool.transportFor(endpoint) }) }))
	const pinned = await sharedQuorumReadTargets(readers, settings.connectivity.rpcQuorum)
	const result = await settledQuorumValue(
		'universe lookup',
		pinned.readers.map(async ({ client: reader, endpoint }) => {
			const before = await reader.getBlock({ blockNumber: pinned.blockNumber })
			if (before.hash === undefined) throw new Error('Universe lookup requires a canonical block')
			const universes = await loadUniverseTree(reader, settings.deployment.zoltar, pinned.blockNumber, ids)
			if ((await reader.getBlock({ blockNumber: pinned.blockNumber })).hash !== before.hash) throw new Error('Universe lookup block changed')
			return { endpoint, value: { hash: before.hash, universes } }
		}),
		settings.connectivity.rpcQuorum,
	)
	if (runtime.client !== client || runtime.settings.network.chainId !== settings.network.chainId) throw new Error('Universe lookup network changed')
	const universes = result.universes
	return universes
}

export async function lookupUniverse(runtime: LiquidatorRuntime, value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Universe lookup requires an ID')
	const ids = parseApprovedUniverses([Reflect.get(value, 'universeId')])
	const universes = await lookupUniverseLineages(runtime, ids)
	return { universes: universes.map(universe => ({ id: universe.id.toString(), parentId: universe.parentId?.toString(), outcomeIndex: universe.outcomeIndex?.toString(), forkQuestionId: universe.forkQuestionId.toString(), repToken: universe.repToken })) }
}
