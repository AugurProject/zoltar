import type { Configuration } from '#config/configuration'
import { canonicalSecurityPoolFactory } from '#config/network'
import { loadCoordinatorPolicies } from '#config/runtime-deployment'
import type { ReadClient } from '#core/operator-types'
import type { CoordinatorGamePolicy } from '#core/game-policy'
import { securityPoolAbi, securityPoolFactoryAbi, openOraclePriceCoordinatorAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { rpcFailureWithContext, zeroAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { endpointLabel } from '@zoltar/bot-shared/monitoring/connectivity'

type DiscoveryConfiguration = Pick<Configuration, 'network' | 'openOracle' | 'operatorSettings' | 'execute' | 'connectivity' | 'quorumRpcUrls' | 'rpcQuorum'>

/** The canonical factory registry authenticates pool provenance; the pool binds its operation coordinator and price feed immutably. */
export async function discoverCoordinatorPolicies(clients: readonly ReadClient[], config: DiscoveryConfiguration, blockNumber: bigint, blockHash: Hex, retainedReportIds: readonly bigint[] = []) {
	const approved = config.operatorSettings.approvedUniverses
	if (approved.length === 0) return []
	const factory = canonicalSecurityPoolFactory(config.network.name)
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		'authenticated pool price feeds',
		clients.map(async (client, index) => {
			const endpoint = endpointLabel(endpoints[index] ?? '')
			try {
				const assertBlock = async () => {
					const block = await client.getBlock({ blockNumber })
					if (block.hash?.toLowerCase() !== blockHash.toLowerCase()) throw new Error('Coordinator discovery block differs from the selected canonical block')
				}
				await assertBlock()
				if (config.execute) {
					const code = await client.getCode({ address: factory, blockNumber })
					if (code === undefined || code === '0x') throw new Error('Canonical security pool factory is not deployed')
				}
				const count = await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'securityPoolDeploymentCount', blockNumber })
				if (count > 10_000n) throw new Error('Security pool registry exceeds the discovery limit')
				const priceFeeds = new Set<`0x${string}`>()
				const sharedFeeds = new Set<string>()
				for (let start = 0n; start < count; start += 100n) {
					const pageSize = count - start < 100n ? count - start : 100n
					const deployments = await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'securityPoolDeploymentsRange', args: [start, pageSize], blockNumber })
					if (BigInt(deployments.length) !== pageSize) throw new Error('Security pool registry returned an incomplete page')
					for (const deployment of deployments) {
						if (!approved.includes(deployment.universeId)) continue
						const [coordinator, universeId] = await Promise.all([
							client.readContract({ address: deployment.securityPool, abi: securityPoolAbi, functionName: 'openOraclePriceCoordinator', blockNumber }),
							client.readContract({ address: deployment.securityPool, abi: securityPoolAbi, functionName: 'universeId', blockNumber }),
						])
						if (universeId !== deployment.universeId || coordinator.toLowerCase() !== deployment.openOraclePriceCoordinator.toLowerCase()) throw new Error('Registered security pool has an inconsistent coordinator or universe')
						const priceFeed = await client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'priceFeed', blockNumber })
						priceFeeds.add(priceFeed)
						if (priceFeed.toLowerCase() !== coordinator.toLowerCase()) sharedFeeds.add(priceFeed.toLowerCase())
					}
				}
				const templates = await loadCoordinatorPolicies(client, { network: config.network, openOracle: config.openOracle, coordinatorAddresses: [...priceFeeds].sort() }, blockNumber)
				const policies: CoordinatorGamePolicy[] = await Promise.all(
					templates.map(async policy => {
						if (!sharedFeeds.has(policy.coordinator.toLowerCase())) return policy
						const pendingId = await client.readContract({ address: policy.coordinator, abi: sharedPoolPriceFeedAbi, functionName: 'pendingReportId', blockNumber })
						const reportEscrows: Record<string, Address> = {}
						for (const reportId of new Set([pendingId, ...retainedReportIds])) {
							if (reportId === 0n) continue
							const candidate = await client.readContract({ address: policy.coordinator, abi: sharedPoolPriceFeedAbi, functionName: 'reportCandidates', args: [reportId], blockNumber })
							if (candidate[0].toLowerCase() !== zeroAddress) reportEscrows[reportId.toString()] = candidate[0]
							else if (reportId === pendingId) throw new Error('Shared feed pending report has no authenticated escrow')
						}
						return { ...policy, reportEscrows }
					}),
				)
				await assertBlock()
				return { endpoint, value: policies }
			} catch (error) {
				throw rpcFailureWithContext(error, endpoint, 'coordinator discovery')
			}
		}),
		config.execute ? config.rpcQuorum : 1,
	)
}
