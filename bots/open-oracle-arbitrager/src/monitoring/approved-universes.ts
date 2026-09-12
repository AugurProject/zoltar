import { approvedUniverseRepTokens, loadUniverseTreeBatched } from '@zoltar/bot-shared/monitoring/universe-policy'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { canonicalZoltar } from '#config/network'
import type { Configuration } from '#config/configuration'
import type { ReadClient } from '#core/operator-types'

export async function loadApprovedUniverses(readers: readonly ReadClient[], config: Configuration, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const universes = await settledQuorumValue(
		'approved universe REP identities',
		readers.map(async (reader, index) => ({
			endpoint: endpoints[index] ?? '',
			value: await loadUniverseTreeBatched(reader, canonicalZoltar(config.network.name), blockNumber, config.network.multicall3),
		})),
	)
	return { universes, approvedTokens: approvedUniverseRepTokens(universes, config.operatorSettings.approvedUniverses) }
}
