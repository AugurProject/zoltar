import { securityPoolFactoryAbi, questionLedgerAbi, escalationGameAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { type Address, zeroAddress } from '@zoltar/bot-shared/ethereum'
import type { PoolSnapshot } from '../operations/types.ts'
import type { ChaosReadClient } from './discovery-client.ts'

const securityPoolClockAbi = [{ type: 'function', name: 'clocks', stateMutability: 'view', inputs: [{ name: 'universeId', type: 'uint248' }], outputs: [{ type: 'uint48' }, { type: 'uint48' }, { type: 'bool' }, { type: 'bool' }] }] as const
const securityPoolSourceAbi = [
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
	const [securityPool, originId] = await Promise.all([
		client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'securityPoolOf', args: [parent] }),
		client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'getQuestionLedgerOriginId', args: [parent] }),
	])
	const questionId = securityPool === zeroAddress ? undefined : await client.readContract({ abi: questionLedgerAbi, address: parent, blockNumber, functionName: 'questionId' })
	return Object.fromEntries(
		await Promise.all(
			outcomes.map(async outcome => {
				const childUniverseId = await client.readContract({ abi: zoltarAbi, address: zoltar, blockNumber, functionName: 'getChildUniverseId', args: [parentUniverseId, BigInt(outcome)] })
				const [childPool, feed] = await Promise.all([
					client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'getQuestionLedger', args: [originId, childUniverseId] }),
					securityPool === zeroAddress ? Promise.resolve(undefined) : client.readContract({ abi: securityPoolFactoryAbi, address: factory, blockNumber, functionName: 'sharedPriceFeeds', args: [securityPool, childUniverseId] }),
				])
				const game = childPool === zeroAddress ? zeroAddress : await client.readContract({ abi: questionLedgerAbi, address: childPool, blockNumber, functionName: 'escalationGame' })
				const continuation = game !== zeroAddress && (await client.readContract({ abi: escalationGameAbi, address: game, blockNumber, functionName: 'forkContinuation' }))
				const historyOutcomesInitialized = !continuation ? 0 : Number(await client.readContract({ abi: escalationGameAbi, address: game, blockNumber, functionName: 'forkCarrySnapshotOutcomesInitialized' }))
				const bound = securityPool !== zeroAddress
				const childOperational = childPool !== zeroAddress && (!bound || (await client.readContract({ abi: questionLedgerAbi, address: childPool, blockNumber, functionName: 'systemState' })) === 0n)
				const historyReady = childOperational && (!continuation || historyOutcomesInitialized === 3)
				const branchReady =
					!bound || ((await client.readContract({ abi: securityPoolClockAbi, address: securityPool, blockNumber, functionName: 'clocks', args: [childUniverseId] }))[3] && (await client.readContract({ abi: zoltarAbi, address: zoltar, blockNumber, functionName: 'getForkTime', args: [childUniverseId] })) === 0n)
				const sourceGame = questionId === undefined || !branchReady ? zeroAddress : await client.readContract({ abi: securityPoolSourceAbi, address: securityPool, blockNumber, functionName: 'sourceGame', args: [childUniverseId, questionId] })
				const sourcePool = sourceGame === zeroAddress ? parent : await client.readContract({ abi: escalationGameAbi, address: sourceGame, blockNumber, functionName: 'questionLedger' })
				return [outcome, { securityPool, branchReady, sourcePool, sourceGame, game, historyOutcomesInitialized, historyReady, childUniverseId: childUniverseId.toString(), childPool, feedRequired: !bound && feed === zeroAddress, dependenciesRequired: false }]
			}),
		),
	)
}
