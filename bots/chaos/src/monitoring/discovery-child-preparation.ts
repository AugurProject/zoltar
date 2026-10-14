import { securityPoolFactoryAbi, securityPoolAbi, escalationGameAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { type Address, zeroAddress } from '@zoltar/bot-shared/ethereum'
import type { PoolSnapshot } from '../operations/types.ts'
import type { ChaosReadClient } from './discovery-client.ts'

export async function discoverChildPoolPreparations(client: ChaosReadClient, factory: Address, zoltar: Address, parent: Address, parentUniverseId: bigint, outcomes: readonly string[], blockNumber: bigint): Promise<PoolSnapshot['childPoolPreparations']> {
	if (outcomes.length === 0) return {}
	const [portfolio, originId] = await Promise.all([
		client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'getSecurityPoolPortfolio', args: [parent] }),
		client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'getSecurityPoolOriginId', args: [parent] }),
	])
	return Object.fromEntries(
		await Promise.all(
			outcomes.map(async outcome => {
				const childUniverseId = await client.readContract({ abi: zoltarAbi, address: zoltar, blockNumber, functionName: 'getChildUniverseId', args: [parentUniverseId, BigInt(outcome)] })
				const [dependencies, childPool, feed] = await Promise.all([
					client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'getChildPoolDependencies', args: [parent, BigInt(outcome)] }),
					client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'getSecurityPool', args: [originId, childUniverseId] }),
					portfolio === zeroAddress ? Promise.resolve(undefined) : client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'sharedPriceFeeds', args: [portfolio, childUniverseId] }),
				])
				const game = childPool === zeroAddress ? zeroAddress : await client.readContract({ abi: securityPoolAbi, address: childPool, blockNumber, functionName: 'escalationGame' })
				const continuation = game !== zeroAddress && (await client.readContract({ abi: escalationGameAbi, address: game, blockNumber, functionName: 'forkContinuation' }))
				const historyOutcomesInitialized = !continuation ? 0 : Number(await client.readContract({ abi: escalationGameAbi, address: game, blockNumber, functionName: 'forkCarrySnapshotOutcomesInitialized' }))
				const historyReady = childPool !== zeroAddress && (!continuation || historyOutcomesInitialized === 3)
				return [outcome, { portfolio, game, historyOutcomesInitialized, historyReady, childUniverseId: childUniverseId.toString(), childPool, feedRequired: feed === zeroAddress, dependenciesRequired: dependencies[0] === zeroAddress || dependencies[1] === zeroAddress }]
			}),
		),
	)
}
