import { createPublicClient, defineChain, getAddress, http } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum/rpc-resilience'
import { securityPoolFactoryAbi } from '#contracts/abi'
import type { DesiredPoolSettings, OperatorSettings } from '#config/settings'

export function chainFor(settings: OperatorSettings) {
	return defineChain({
		id: settings.network.chainId,
		name: settings.network.name,
		nativeCurrency: {
			decimals: 18,
			name: 'Ether',
			symbol: 'ETH',
		},
		rpcUrls: {
			default: {
				http: [settings.connectivity.readRpcUrl],
			},
		},
	})
}

export async function canonicalBlockHash(settings: OperatorSettings, blockNumber: bigint, pool?: ReturnType<typeof createRpcEndpointPool>) {
	const currentChain = chainFor(settings)
	return settledQuorumValue(
		'market evidence canonical block',
		[settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(async endpoint => {
			const block = await createPublicClient({ chain: currentChain, transport: pool?.transportFor(endpoint) ?? http(endpoint) }).getBlock({ blockNumber })
			if (block.hash === undefined) throw new Error('Canonical block is missing its hash')
			return { endpoint, value: block.hash }
		}),
	)
}

export async function desiredPoolStatus(settings: OperatorSettings, desired: DesiredPoolSettings, pool?: ReturnType<typeof createRpcEndpointPool>) {
	const currentChain = chainFor(settings)
	const address = await settledQuorumValue(
		'desired origin security pool',
		[settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(async endpoint => {
			const client = createPublicClient({ chain: currentChain, transport: pool?.transportFor(endpoint) ?? http(endpoint) })
			const originId = await client.readContract({
				abi: securityPoolFactoryAbi,
				address: settings.deployment.securityPoolFactory,
				args: [desired.universeId, desired.questionId, desired.statoblastSecurityMultiplierBps, desired.initialReportPriorityFeeAttoEthPerGas],
				functionName: 'getOriginId',
			})
			return {
				endpoint,
				value: getAddress(
					await client.readContract({
						abi: securityPoolFactoryAbi,
						address: settings.deployment.securityPoolFactory,
						args: [originId, desired.universeId],
						functionName: 'getSecurityPool',
					}),
				),
			}
		}),
	)
	return { address, desired }
}
