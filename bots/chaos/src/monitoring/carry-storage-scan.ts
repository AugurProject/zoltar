import { keccak256, toHex, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { escalationGameAbi, securityPoolAbi, securityPoolForkerAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import type { ForkedCarryWithdrawalSnapshot } from '../operations/types.ts'
import { computeNullifierRootFromProof } from './carry-proof-index.ts'
import { CARRY_STORAGE_MAXIMUM_WITHDRAWALS, loadCarryStorageCandidates, type CarryStorageRoute } from './carry-proof-storage.ts'
import { computeWinningEconomics } from './carry-withdrawal-economics.ts'
import { DISCOVERY_RPC_CONCURRENCY, drainConcurrent, mapWithConcurrency, type ChaosReadClient } from './discovery.ts'

export async function scanCarryStorage(context: { client: Pick<ChaosReadClient, 'readContract' | 'simulateContract' | 'getBlock'>; escalationGames: readonly CarryStorageRoute[]; wallet: Address; securityPoolForker: Address; anchorBlockNumber: bigint; expectedAnchorHash: Hash; maximumItems: number }) {
	const { client, anchorBlockNumber: blockNumber } = context
	async function authenticateAnchor() {
		const block = await client.getBlock({ blockNumber })
		if (block.number !== blockNumber || block.hash?.toLowerCase() !== context.expectedAnchorHash.toLowerCase()) throw new Error('Carry storage scan anchor is not canonical')
	}
	await authenticateAnchor()
	const candidates = await loadCarryStorageCandidates(client, context.escalationGames, context.wallet, blockNumber, context.maximumItems)
	const withdrawalPresence = candidates.map(candidate => ({ pool: candidate.pool, game: candidate.game, sourceGame: candidate.sourceGame, claimSourceGame: candidate.claimSourceGame, outcome: candidate.outcome, parentDepositIndex: candidate.parentDepositIndex, sourceNodeId: candidate.sourceNodeId }))
	// Rotate simulation work while retaining presence for every unconsumed wallet claim.
	const start = candidates.length === 0 ? 0 : Number(blockNumber % BigInt(candidates.length))
	const selected = Array.from({ length: Math.min(candidates.length, CARRY_STORAGE_MAXIMUM_WITHDRAWALS) }, (_, offset) => {
		const candidate = candidates[(start + offset) % candidates.length]
		if (candidate === undefined) throw new Error('Missing carry storage candidate')
		return candidate
	})
	const verified = await mapWithConcurrency(selected, Math.min(2, DISCOVERY_RPC_CONCURRENCY), async (candidate): Promise<ForkedCarryWithdrawalSnapshot | undefined> => {
		if (candidate.forker.toLowerCase() !== context.securityPoolForker.toLowerCase()) throw new Error('Carry storage pool uses an unexpected forker')
		const [poolState, resolved, initialized, resolution, poolOutcome] = await drainConcurrent([
			client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber, functionName: 'systemState' }),
			client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber, functionName: 'isEscalationResolved' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'forkCarrySnapshotInitialized' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'getFinalQuestionResolution' }),
			client.readContract({ abi: securityPoolForkerAbi, address: context.securityPoolForker, args: [candidate.pool], blockNumber, functionName: 'getQuestionOutcome' }),
		])
		if (BigInt(poolState) !== 0n || !resolved || !initialized || Number(resolution) !== candidate.outcome || Number(poolOutcome) !== candidate.outcome) return undefined
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
		const [retainedDeposit, retainedCumulative, bindingCapital, nonDecisionThreshold, gameEnd, universeId, zoltar, gameWithdrawal, simulation] = await drainConcurrent([
			client.readContract({ abi: escalationGameAbi, address: candidate.game, args: [argument.amountAttoRep, argument.parentDepositIndex], blockNumber, functionName: 'applyInheritedClaimRetention' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, args: [argument.cumulativeAmountAttoRep, argument.parentDepositIndex], blockNumber, functionName: 'applyInheritedClaimRetention' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'getBindingCapitalAttoRep' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'nonDecisionThresholdAttoRep' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'getEscalationGameEndDate' }),
			client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber, functionName: 'universeId' }),
			client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber, functionName: 'zoltar' }),
			client.simulateContract({ abi: escalationGameAbi, address: candidate.game, account: candidate.pool, args: [argument, candidate.outcome], blockNumber, functionName: 'withdrawDeposit' }),
			client.simulateContract({ abi: securityPoolAbi, address: candidate.pool, account: context.wallet, args: [candidate.outcome, [argument]], blockNumber, functionName: 'withdrawForkedEscalationDeposits' }),
		])
		const [forkThreshold, forkTime] = await drainConcurrent([client.readContract({ abi: zoltarAbi, address: zoltar, args: [universeId], blockNumber, functionName: 'getForkThresholdAttoRep' }), client.readContract({ abi: zoltarAbi, address: zoltar, args: [universeId], blockNumber, functionName: 'getForkTime' })])
		const economics = computeWinningEconomics({
			actualForkThresholdAttoRep: forkTime > gameEnd ? nonDecisionThreshold : forkThreshold,
			bindingCapitalAttoRep: bindingCapital,
			cumulativeAmountAttoRep: retainedCumulative,
			depositAmountAttoRep: retainedDeposit,
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
	return { complete: true, withdrawalPresence, withdrawals, withdrawalCandidateCount: candidates.length, digest: keccak256(toHex(JSON.stringify({ withdrawalPresence, withdrawals }))) }
}
