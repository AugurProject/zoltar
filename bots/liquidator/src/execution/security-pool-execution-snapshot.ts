import type { OperatorSettings } from '#config/settings'
import { totalManagedPrincipalAttoRep } from '#core/security-pool-exposure'
import { loadManagedSecurityPoolObservations, type SecurityPoolObservation } from '#monitoring/security-pool-monitor'
import type { ReadClient } from '#monitoring/read-client'
import { createPublicClient, type Account, type Chain, type Transport, type WalletClient, type createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue, sharedQuorumReadTargets } from '@zoltar/bot-shared/monitoring/read-quorum'

export type SecurityPoolExecutionContext = { client: ReadClient; blockNumber: bigint; observation: SecurityPoolObservation; totalPrincipal: bigint | undefined }

/** All security pool writes authenticate the same managed exposure at one quorum-agreed height. */
export async function readSecurityPoolExecutionSnapshot<T>(
	wallet: WalletClient<Transport, Chain, Account>,
	settings: OperatorSettings,
	pool: ReturnType<typeof createRpcEndpointPool>,
	requests: Parameters<typeof loadManagedSecurityPoolObservations>[3],
	selection: SecurityPoolObservation['selection'],
	read: (context: SecurityPoolExecutionContext) => Promise<T>,
	readers: readonly { endpoint: string; client: ReadClient }[] = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(endpoint => ({ endpoint, client: createPublicClient({ chain: wallet.chain, transport: pool.transportFor(endpoint) }) })),
) {
	const pinned = await sharedQuorumReadTargets(readers, settings.connectivity.rpcQuorum)
	return settledQuorumValue(
		'security pool execution snapshot',
		pinned.readers.map(async ({ client, endpoint }) => {
			const block = await client.getBlock({ blockNumber: pinned.blockNumber })
			if (block.number !== pinned.blockNumber || block.hash === undefined) throw new Error('Security pool execution requires a confirmed block')
			const observations = await loadManagedSecurityPoolObservations(client, settings, wallet.account.address, requests, block.number)
			const observation = observations.find(item => item.selection.address === selection.address && item.selection.universeId === selection.universeId)
			if (observation === undefined) throw new Error('Security pool disappeared from managed exposure history')
			const totalPrincipal = totalManagedPrincipalAttoRep(observations)
			const details = await read({ client, blockNumber: block.number, observation, totalPrincipal })
			if (observation.snapshot.blockHash !== block.hash || (await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Security pool execution snapshot was replaced')
			return { endpoint, value: { observation, totalPrincipal, details } }
		}),
		settings.connectivity.rpcQuorum,
	)
}
