import type { Configuration } from '#config/configuration'
import { authenticateDeploymentManifest } from '#config/deployment-auth'
import { canonicalSecurityPoolFactory } from '#config/network'
import { loadCoordinatorPolicies } from '#config/runtime-deployment'
import type { ReadClient } from '#core/operator-types'
import { securityPoolAbi, securityPoolFactoryAbi } from '@zoltar/bot-shared/contracts/abi'
import { rpcFailureWithContext, type Hex } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { rpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { endpointLabel } from '#monitoring/connectivity'

type DiscoveryConfiguration = Pick<Configuration, 'network' | 'openOracle' | 'operatorSettings' | 'execute' | 'deploymentManifest' | 'connectivity' | 'quorumRpcUrls'>

/** The canonical factory registry authenticates pool provenance; the pool binds its coordinator immutably. */
export async function discoverCoordinatorPolicies(clients: readonly ReadClient[], config: DiscoveryConfiguration, blockNumber: bigint, blockHash: Hex) {
	const approved = config.operatorSettings.approvedUniverses
	if (approved.length === 0) return []
	const factory = canonicalSecurityPoolFactory(config.network.name)
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	return settledQuorumValue(
		'authenticated pool coordinators',
		clients.map(async (client, index) => {
			const endpoint = endpointLabel(endpoints[index] ?? '')
			try {
				const assertBlock = async () => {
					const block = await client.getBlock({ blockNumber })
					if (block.hash?.toLowerCase() !== blockHash.toLowerCase()) throw new Error('Coordinator discovery block differs from the selected canonical block')
				}
				await assertBlock()
				if (config.execute) {
					if (config.deploymentManifest === undefined) throw new Error('Pool discovery requires an authenticated factory manifest')
					await authenticateDeploymentManifest(config.deploymentManifest, { chainId: config.network.chain.id, network: config.network.name, required: [{ address: factory, role: 'security-pool-factory' }], readCode: address => client.getCode({ address, blockNumber }) })
				}
				const count = await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'securityPoolDeploymentCount', blockNumber })
				if (count > 10_000n) throw new Error('Security pool registry exceeds the discovery limit')
				const coordinators = new Set<`0x${string}`>()
				for (let start = 0n; start < count; start += 100n) {
					const pageSize = count - start < 100n ? count - start : 100n
					const deployments = await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'securityPoolDeploymentsRange', args: [start, pageSize], blockNumber })
					if (BigInt(deployments.length) !== pageSize) throw new Error('Security pool registry returned an incomplete page')
					for (const deployment of deployments) {
						if (!approved.includes(deployment.universeId)) continue
						const [coordinator, universeId] = await Promise.all([
							client.readContract({ address: deployment.securityPool, abi: securityPoolAbi, functionName: 'priceOracleManagerAndOperatorQueuer', blockNumber }),
							client.readContract({ address: deployment.securityPool, abi: securityPoolAbi, functionName: 'universeId', blockNumber }),
						])
						if (universeId !== deployment.universeId || coordinator.toLowerCase() !== deployment.priceOracleManagerAndOperatorQueuer.toLowerCase()) throw new Error('Registered security pool has an inconsistent coordinator or universe')
						coordinators.add(coordinator)
					}
				}
				const policies = await loadCoordinatorPolicies(client, { network: config.network, openOracle: config.openOracle, coordinatorAddresses: [...coordinators].sort() }, blockNumber)
				await assertBlock()
				return { endpoint, value: policies }
			} catch (error) {
				throw rpcFailureWithContext(error, endpoint, 'coordinator discovery')
			}
		}),
		config.execute ? rpcQuorumRequirement() : 1,
	)
}
