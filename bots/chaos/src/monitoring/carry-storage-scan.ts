import { isFinalClaimCheckpointBatch } from '@zoltar/statoblast-shared/escalationGame/claimCheckpoint'
import { encodeAbiParameters, keccak256, RpcError, toHex, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { escalationGameAbi, multicall3Abi, securityPoolAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import type { ForkedCarryWithdrawalSnapshot, ForkedClaimCheckpointSnapshot } from '../operations/carry-types.ts'
import { createCarryCheckpointReader } from './carry-checkpoint-scan.ts'
import { claimCheckpointWithdrawalCalls } from '../operations/statoblast/checkpoint-call.ts'
import { computeNullifierRootFromProof } from './carry-proof-index.ts'
import { loadCarryStorageCandidates, type CarryStorageRoute } from './carry-proof-storage.ts'
import { computeWinningEconomics } from './carry-withdrawal-economics.ts'
import { DISCOVERY_RPC_CONCURRENCY, drainConcurrent, mapWithConcurrency, type ChaosReadClient } from './discovery-client.ts'

function atomicCheckpointSimulationUnavailable(error: unknown) {
	if (!(error instanceof Error)) return false
	if (error.name === 'ContractFunctionZeroDataError') return true
	if (error.name !== 'ContractFunctionRevertedError') return false
	const visited = new Set<Error>()
	let cause = error.cause
	while (cause instanceof Error && !visited.has(cause)) {
		// Transport wrappers can contain programmer errors; only an actual RPC error code identifies a node rejection.
		if (cause instanceof RpcError && typeof cause.code === 'number' && Number.isInteger(cause.code)) return true
		visited.add(cause)
		cause = cause.cause
	}
	return false
}

export async function scanCarryStorage(context: {
	client: Pick<ChaosReadClient, 'readContract' | 'simulateContract' | 'getBlock'>
	escalationGames: readonly CarryStorageRoute[]
	wallet: Address
	securityPoolForker: Address
	anchorBlockNumber: bigint
	expectedAnchorHash: Hash
	maximumItems: number
	multicall3?: Address
}) {
	const { client, anchorBlockNumber: blockNumber } = context
	async function authenticateAnchor() {
		const block = await client.getBlock({ blockNumber })
		if (block.number !== blockNumber || block.hash?.toLowerCase() !== context.expectedAnchorHash.toLowerCase()) throw new Error('Carry storage scan anchor is not canonical')
	}
	await authenticateAnchor()
	const candidates = await loadCarryStorageCandidates(client, context.escalationGames, context.wallet, blockNumber, context.maximumItems)
	const withdrawalPresence = candidates.map(candidate => ({ pool: candidate.pool, game: candidate.game, sourceGame: candidate.sourceGame, claimSourceGame: candidate.claimSourceGame, outcome: candidate.outcome, parentDepositIndex: candidate.parentDepositIndex, sourceNodeId: candidate.sourceNodeId }))

	const reader = createCarryCheckpointReader({ client, blockNumber, securityPoolForker: context.securityPoolForker, ...(context.multicall3 === undefined ? {} : { multicall3: context.multicall3 }) })
	const checkpoints: ForkedClaimCheckpointSnapshot[] = await reader.checkpoints(candidates)
	if (context.multicall3 !== undefined) {
		for (const checkpoint of checkpoints) {
			if (checkpoint.preparationReason !== 'required' || !isFinalClaimCheckpointBatch({ nextSourceGame: checkpoint.nextSourceGame, pendingSteps: BigInt(checkpoint.pendingSteps) }, checkpoint.transforms.length)) continue
			const candidate = candidates.find(value => value.game.toLowerCase() === checkpoint.game.toLowerCase() && value.outcome === checkpoint.outcome && value.parentDepositIndex === checkpoint.parentDepositIndex)
			if (candidate?.proof === undefined || candidate.depositor.toLowerCase() !== context.wallet.toLowerCase()) continue
			checkpoint.finalWithdrawal = {
				multicall3: context.multicall3,
				proof: candidate.proof,
				resultingCarryRoot: candidate.state.currentCarryRoot,
				resultingNullifierRoot: computeNullifierRootFromProof(candidate.parentDepositIndex, candidate.proof.nullifierSiblings, toHex(1n, { size: 32 })),
				preflightExpectedResult: '0x',
			}
			const calls = claimCheckpointWithdrawalCalls(checkpoint)
			const simulation = await client.simulateContract({ abi: multicall3Abi, address: context.multicall3, account: context.wallet, args: [calls], blockNumber, functionName: 'aggregate3' }).catch((error: unknown) => {
				// Only normalized contract reverts or unavailable deployments permit standalone preparation.
				if (!atomicCheckpointSimulationUnavailable(error)) throw error
				return undefined
			})
			if (simulation === undefined) {
				checkpoint.settlement = 'separate'
				delete checkpoint.finalWithdrawal
				continue
			}
			const prepared = simulation.result[0]
			if (simulation.result.length !== 2 || simulation.result.some(value => !value.success) || prepared === undefined || prepared.returnData !== encodeAbiParameters([{ type: 'bool' }], [true]) || simulation.result[1]?.returnData !== '0x') throw new Error('Final checkpoint multicall did not complete atomically')
			checkpoint.settlement = 'atomic'
			checkpoint.finalWithdrawal.preflightExpectedResult = encodeAbiParameters(
				[
					{
						type: 'tuple[]',
						components: [
							{ name: 'success', type: 'bool' },
							{ name: 'returnData', type: 'bytes' },
						],
					},
				],
				[simulation.result],
			)
		}
	}
	const selected = candidates.filter(candidate => candidate.proof !== undefined)
	const economicsByGame = new Map<string, ReturnType<typeof readEconomics>>()
	async function readEconomics(candidate: (typeof candidates)[number]) {
		const [bindingCapital, nonDecisionThreshold, gameEnd, universeId, zoltar] = await drainConcurrent([
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'getBindingCapitalAttoRep' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'nonDecisionThresholdAttoRep' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'getEscalationGameEndDate' }),
			client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber, functionName: 'universeId' }),
			client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber, functionName: 'zoltar' }),
		])
		const [forkThreshold, forkTime] = await drainConcurrent([client.readContract({ abi: zoltarAbi, address: zoltar, args: [universeId], blockNumber, functionName: 'getForkThresholdAttoRep' }), client.readContract({ abi: zoltarAbi, address: zoltar, args: [universeId], blockNumber, functionName: 'getForkTime' })])
		return { bindingCapital, nonDecisionThreshold, gameEnd, forkThreshold, forkTime }
	}
	const verified = await mapWithConcurrency(selected, Math.min(2, DISCOVERY_RPC_CONCURRENCY), async (candidate): Promise<ForkedCarryWithdrawalSnapshot | undefined> => {
		if (!(await reader.finalReady(candidate)) || !(await reader.progress(candidate.game, reader.identity(candidate))).ready) return undefined
		const proof = candidate.proof
		if (proof === undefined) throw new Error('Selected carry candidate has no storage proof')
		const argument = {
			depositor: proof.depositor,
			amountAttoRep: BigInt(proof.amountAttoRep),
			cumulativeAmountAttoRep: BigInt(proof.cumulativeAmountAttoRep),
			parentDepositIndex: BigInt(proof.parentDepositIndex),
			sourceNodeId: BigInt(proof.sourceNodeId),
			leafIndex: BigInt(proof.leafIndex),
			merkleMountainRangePeakIndex: BigInt(proof.merkleMountainRangePeakIndex),
			merkleMountainRangeSiblings: proof.merkleMountainRangeSiblings,
			nullifierSiblings: proof.nullifierSiblings,
		}
		const key = `${candidate.game.toLowerCase()}:${candidate.pool.toLowerCase()}`
		let gameEconomics = economicsByGame.get(key)
		if (gameEconomics === undefined) {
			gameEconomics = readEconomics(candidate)
			economicsByGame.set(key, gameEconomics)
		}
		const [allocation, { bindingCapital, nonDecisionThreshold, gameEnd, forkThreshold, forkTime }, gameWithdrawal, simulation] = await drainConcurrent([
			client.readContract({ abi: escalationGameAbi, address: candidate.game, args: [candidate.outcome, argument.amountAttoRep, argument.cumulativeAmountAttoRep, argument.leafIndex], blockNumber, functionName: 'getInheritedClaimAllocation' }),
			gameEconomics,
			client.simulateContract({ abi: escalationGameAbi, address: candidate.game, account: candidate.pool, args: [argument, candidate.outcome], blockNumber, functionName: 'withdrawDeposit' }),
			client.simulateContract({ abi: securityPoolAbi, address: candidate.pool, account: context.wallet, args: [candidate.outcome, [argument]], blockNumber, functionName: 'withdrawForkedEscalationDeposits' }),
		])
		const economics = computeWinningEconomics({
			actualForkThresholdAttoRep: forkTime > gameEnd ? nonDecisionThreshold : forkThreshold,
			bindingCapitalAttoRep: bindingCapital,
			cumulativeAmountAttoRep: allocation.retainedCumulativeAttoRep,
			depositAmountAttoRep: allocation.rewardAmountAttoRep,
			principalAttoRep: allocation.retainedAmountAttoRep,
			nonDecisionThresholdAttoRep: nonDecisionThreshold,
			winningOutcomeBalanceAttoRep: candidate.state.balanceAttoRep,
		})
		if (simulation.result !== undefined || gameWithdrawal.result.depositor.toLowerCase() !== candidate.depositor.toLowerCase() || gameWithdrawal.result.originalDepositAmountAttoRep !== argument.amountAttoRep || gameWithdrawal.result.amountToWithdrawAttoRep !== economics.amountToWithdrawAttoRep)
			throw new Error('Carry storage withdrawal simulation differs from derived economics')
		return {
			pool: candidate.pool,
			game: candidate.game,
			sourcePool: candidate.sourcePool,
			sourceGame: candidate.sourceGame,
			claimSourceGame: candidate.claimSourceGame,
			outcome: candidate.outcome,
			depositor: candidate.depositor,
			amountAttoRep: candidate.amountAttoRep,
			parentDepositIndex: candidate.parentDepositIndex,
			sourceNodeId: candidate.sourceNodeId,
			proof,
			resultingCarryRoot: candidate.state.currentCarryRoot,
			resultingNullifierRoot: computeNullifierRootFromProof(candidate.parentDepositIndex, proof.nullifierSiblings, toHex(1n, { size: 32 })),
			amountToWithdrawAttoRep: economics.amountToWithdrawAttoRep.toString(),
			burnAmountAttoRep: economics.burnAmountAttoRep.toString(),
			preflightExpectedResult: '0x',
		}
	})
	await authenticateAnchor()
	const withdrawals = verified.filter(candidate => candidate !== undefined)
	return { complete: true, withdrawalPresence, withdrawals, checkpoints, withdrawalCandidateCount: candidates.length, digest: keccak256(toHex(JSON.stringify({ withdrawalPresence, withdrawals, checkpoints }))) }
}
