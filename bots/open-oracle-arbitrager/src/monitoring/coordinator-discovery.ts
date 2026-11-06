import type { Configuration } from '#config/configuration'
import { canonicalSecurityPoolFactory } from '#config/network'
import { loadCoordinatorPolicies } from '#config/runtime-deployment'
import type { ReadClient } from '#core/operator-types'
import type { CoordinatorGamePolicy } from '#core/game-policy'
import { securityPoolFactoryAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, isAddress, rpcFailureWithContext, zeroAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { batchRead } from '#core/batch-read'
import { endpointLabel } from '@zoltar/bot-shared/monitoring/connectivity'

type ObservedReport = { reportId: bigint; creator: Address }
const escrowFeedAbi = [{ type: 'function', name: 'feed', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const

type DiscoveryConfiguration = Pick<Configuration, 'network' | 'openOracle' | 'operatorSettings' | 'execute' | 'connectivity' | 'quorumRpcUrls' | 'rpcQuorum'>

/** Authenticate indexed reports through the canonical portfolio/universe feed binding, independent of question count. */
export async function discoverCoordinatorPolicies(clients: readonly ReadClient[], config: DiscoveryConfiguration, blockNumber: bigint, blockHash: Hex, retainedReportIds: readonly bigint[] = [], observedReports: readonly ObservedReport[] = []) {
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
				const priceFeeds = new Set<Address>()
				const sharedFeeds = new Set<string>()
				// Reports are discoverable before the first question exists. Untrusted
				// creators are probed through allow-failure calls; factory custody is
				// the authority, not a creator's self-reported feed address.
				const observedIds = new Map<string, Set<bigint>>()
				const byCreator = new Map<Address, Set<bigint>>()
				for (const report of observedReports) {
					const creator = getAddress(report.creator)
					const ids = byCreator.get(creator) ?? new Set<bigint>()
					ids.add(report.reportId)
					byCreator.set(creator, ids)
				}
				const creators = [...byCreator.keys()]
				const escrowFeeds = await batchRead(
					client,
					config.network.multicall3,
					creators.map(address => ({ address, abi: escrowFeedAbi, functionName: 'feed' })),
					blockNumber,
				)
				for (const [index, creator] of creators.entries()) {
					const result = escrowFeeds[index]
					if (result?.status !== 'success' || typeof result.result !== 'string' || !isAddress(result.result) || result.result === zeroAddress) continue
					const feed = getAddress(result.result)
					const key = feed.toLowerCase()
					if (!observedIds.has(key)) {
						const bindings = await batchRead(
							client,
							config.network.multicall3,
							[
								{ address: feed, abi: sharedPoolPriceFeedAbi, functionName: 'portfolio' },
								{ address: feed, abi: sharedPoolPriceFeedAbi, functionName: 'universeId' },
							],
							blockNumber,
						)
						const portfolio = bindings[0]
						const universe = bindings[1]
						if (portfolio?.status !== 'success' || typeof portfolio.result !== 'string' || !isAddress(portfolio.result) || universe?.status !== 'success' || typeof universe.result !== 'bigint' || !approved.includes(universe.result)) continue
						const registered = await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'sharedPriceFeeds', args: [getAddress(portfolio.result), universe.result], blockNumber })
						if (registered.toLowerCase() !== key) continue
						observedIds.set(key, new Set())
						priceFeeds.add(feed)
						sharedFeeds.add(key)
					}
					for (const reportId of byCreator.get(creator) ?? []) observedIds.get(key)?.add(reportId)
				}
				const templates = await loadCoordinatorPolicies(client, { network: config.network, openOracle: config.openOracle, coordinatorAddresses: [...priceFeeds].sort() }, blockNumber)
				const policies: CoordinatorGamePolicy[] = await Promise.all(
					templates.map(async policy => {
						if (!sharedFeeds.has(policy.coordinator.toLowerCase())) return policy
						const pendingId = await client.readContract({ address: policy.coordinator, abi: sharedPoolPriceFeedAbi, functionName: 'pendingReportId', blockNumber })
						const reportEscrows: Record<string, Address> = {}
						for (const reportId of new Set([pendingId, ...retainedReportIds, ...(observedIds.get(policy.coordinator.toLowerCase()) ?? [])])) {
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
