import { securityPoolFactoryAbi, securityPoolAbi, escalationGameAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { type Address, zeroAddress } from '@zoltar/bot-shared/ethereum'
import type { PoolSnapshot } from '../operations/types.ts'
import type { ChaosReadClient } from './discovery-client.ts'

const portfolioClockAbi = [{ type: 'function', name: 'clocks', stateMutability: 'view', inputs: [{ name: 'universeId', type: 'uint248' }], outputs: [{ type: 'uint48' }, { type: 'uint48' }, { type: 'bool' }, { type: 'bool' }] }] as const
const portfolioSourceAbi = [
	{
		type: 'function',
		name: 'sourceGame',
		stateMutability: 'view',
		inputs: [
			{ name: 'universeId', type: 'uint248' },
			{ name: 'questionId', type: 'uint256' },
		],
		outputs: [{ type: 'address' }],
	},
] as const

export async function discoverChildPoolPreparations(client: ChaosReadClient, factory: Address, zoltar: Address, parent: Address, parentUniverseId: bigint, outcomes: readonly string[], blockNumber: bigint): Promise<PoolSnapshot['childPoolPreparations']> {
	if (outcomes.length === 0) return {}
	const [portfolio, originId] = await Promise.all([
		client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'getSecurityPoolPortfolio', args: [parent] }),
		client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'getSecurityPoolOriginId', args: [parent] }),
	])
	const questionId = portfolio === zeroAddress ? undefined : await client.readContract({ abi: securityPoolAbi, address: parent, blockNumber, functionName: 'questionId' })
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
				const bound = portfolio !== zeroAddress
				const childOperational = childPool !== zeroAddress && (!bound || (await client.readContract({ abi: securityPoolAbi, address: childPool, blockNumber, functionName: 'systemState' })) === 0n)
				const historyReady = childOperational && (!continuation || historyOutcomesInitialized === 3)
				const branchReady =
					!bound || ((await client.readContract({ abi: portfolioClockAbi, address: portfolio, blockNumber, functionName: 'clocks', args: [childUniverseId] }))[3] && (await client.readContract({ abi: zoltarAbi, address: zoltar, blockNumber, functionName: 'getForkTime', args: [childUniverseId] })) === 0n)
				const sourceGame = questionId === undefined || !branchReady ? zeroAddress : await client.readContract({ abi: portfolioSourceAbi, address: portfolio, blockNumber, functionName: 'sourceGame', args: [childUniverseId, questionId] })
				const sourcePool = sourceGame === zeroAddress ? parent : await client.readContract({ abi: escalationGameAbi, address: sourceGame, blockNumber, functionName: 'securityPool' })
				return [
					outcome,
					{ portfolio, branchReady, sourcePool, sourceGame, game, historyOutcomesInitialized, historyReady, childUniverseId: childUniverseId.toString(), childPool, feedRequired: !bound && feed === zeroAddress, dependenciesRequired: !bound && (dependencies[0] === zeroAddress || dependencies[1] === zeroAddress) },
				]
			}),
		),
	)
}
