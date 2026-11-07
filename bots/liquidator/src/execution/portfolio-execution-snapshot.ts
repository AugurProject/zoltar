import type { OperatorSettings } from '#config/settings'
import { totalManagedPrincipalAttoRep } from '#core/portfolio-exposure'
import { loadManagedPortfolioObservations, type PortfolioObservation } from '#monitoring/portfolio-monitor'
import type { ReadClient } from '#monitoring/read-client'
import { createPublicClient, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue, sharedQuorumReadTargets } from '@zoltar/bot-shared/monitoring/read-quorum'

export type PortfolioExecutionContext = { client: ReadClient; blockNumber: bigint; observation: PortfolioObservation; totalPrincipal: bigint }

/** All portfolio writes authenticate the same managed exposure at one quorum-agreed height. */
export async function readPortfolioExecutionSnapshot<T>(
	wallet: WalletClient<Transport, Chain, Account>,
	settings: OperatorSettings,
	pool: ReturnType<typeof createRpcEndpointPool>,
	requests: Parameters<typeof loadManagedPortfolioObservations>[3],
	selection: PortfolioObservation['selection'],
	read: (context: PortfolioExecutionContext) => Promise<T>,
	readers: readonly { endpoint: string; client: ReadClient }[] = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ endpoint, client: createPublicClient({ chain: wallet.chain, transport: pool.transportFor(endpoint) }) })),
) {
	const pinned = await sharedQuorumReadTargets(readers, settings.connectivity.rpcQuorum)
	return settledQuorumValue(
		'portfolio execution snapshot',
		pinned.readers.map(async ({ client, endpoint }) => {
			const block = await client.getBlock({ blockNumber: pinned.blockNumber })
			if (block.number !== pinned.blockNumber || block.hash === undefined) throw new Error('Portfolio execution requires a confirmed block')
			const observations = await loadManagedPortfolioObservations(client, settings, wallet.account.address, requests, block.number)
			const observation = observations.find(item => item.selection.address === selection.address && item.selection.universeId === selection.universeId)
			if (observation === undefined) throw new Error('Portfolio disappeared from managed exposure history')
			const totalPrincipal = totalManagedPrincipalAttoRep(observations)
			const details = await read({ client, blockNumber: block.number, observation, totalPrincipal })
			if (observation.snapshot.blockHash !== block.hash || (await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Portfolio execution snapshot was replaced')
			return { endpoint, value: { observation, totalPrincipal, details } }
		}),
		settings.connectivity.rpcQuorum,
	)
}
