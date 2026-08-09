import { createPublicClient, defineChain, getAddress, http } from '@zoltar/bot-shared/ethereum'
import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
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

export async function canonicalBlockHash(settings: OperatorSettings, blockNumber: bigint) {
	const currentChain = chainFor(settings)
	const observations = await Promise.all(
		[settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(async endpoint => {
			const block = await createPublicClient({ chain: currentChain, transport: http(endpoint) }).getBlock({ blockNumber })
			if (block.hash === undefined) throw new Error('Canonical block is missing its hash')
			return { endpoint, value: block.hash }
		}),
	)
	return quorumValue('market evidence canonical block', observations)
}

export async function desiredPoolStatus(settings: OperatorSettings, desired: DesiredPoolSettings) {
	const currentChain = chainFor(settings)
	const observations = await Promise.all(
		[settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(async endpoint => {
			const client = createPublicClient({ chain: currentChain, transport: http(endpoint) })
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
	const address = quorumValue('desired origin security pool', observations)
	return { address, desired }
}
