import type { ForkedCarryWithdrawalSnapshot } from '../operations/carry-types.ts'
import { keccak256, toHex, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { escalationGameAbi, questionLedgerAbi, questionForkerAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { computeNullifierRootFromProof } from './carry-proof-index.ts'
import { loadCarryStorageCandidates, type CarryStorageRoute } from './carry-proof-storage.ts'
import { computeWinningEconomics } from './carry-withdrawal-economics.ts'
import { DISCOVERY_RPC_CONCURRENCY, drainConcurrent, mapWithConcurrency, type ChaosReadClient } from './discovery-client.ts'

export async function scanCarryStorage(context: {
	client: Pick<ChaosReadClient, 'readContract' | 'simulateContract' | 'getBlock'>
	escalationGames: readonly CarryStorageRoute[]
	wallet: Address
	questionForker: Address
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

	const selected = candidates.filter(candidate => candidate.proof !== undefined)
	const economicsByGame = new Map<string, ReturnType<typeof readEconomics>>()
	async function readEconomics(candidate: (typeof candidates)[number]) {
		const [bindingCapital, nonDecisionThreshold, gameEnd, universeId, zoltar, frozenForkThreshold] = await drainConcurrent([
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'getBindingCapitalAttoRep' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'nonDecisionThresholdAttoRep' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'getEscalationGameEndDate' }),
			client.readContract({ abi: questionLedgerAbi, address: candidate.pool, blockNumber, functionName: 'universeId' }),
			client.readContract({ abi: questionLedgerAbi, address: candidate.pool, blockNumber, functionName: 'zoltar' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'settlementForkThresholdAttoRep' }),
		])
		const [forkThreshold, forkTime] = await drainConcurrent([client.readContract({ abi: zoltarAbi, address: zoltar, args: [universeId], blockNumber, functionName: 'getForkThresholdAttoRep' }), client.readContract({ abi: zoltarAbi, address: zoltar, args: [universeId], blockNumber, functionName: 'getForkTime' })])
		return { bindingCapital, nonDecisionThreshold, gameEnd, forkThreshold, forkTime, frozenForkThreshold }
	}
	const verified = await mapWithConcurrency(selected, Math.min(2, DISCOVERY_RPC_CONCURRENCY), async (candidate): Promise<ForkedCarryWithdrawalSnapshot | undefined> => {
		if (candidate.forker.toLowerCase() !== context.questionForker.toLowerCase()) throw new Error('Carry storage pool uses an unexpected forker')
		const [poolState, resolved, initialized, resolution, poolOutcome] = await drainConcurrent([
			client.readContract({ abi: questionLedgerAbi, address: candidate.pool, blockNumber, functionName: 'systemState' }),
			client.readContract({ abi: questionLedgerAbi, address: candidate.pool, blockNumber, functionName: 'isEscalationResolved' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'forkCarrySnapshotInitialized' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'getFinalQuestionResolution' }),
			client.readContract({ abi: questionForkerAbi, address: context.questionForker, args: [candidate.pool], blockNumber, functionName: 'getQuestionOutcome' }),
		])
		if (Number(poolState) !== 0 || !resolved || !initialized || Number(resolution) !== candidate.outcome || Number(poolOutcome) !== candidate.outcome) return undefined
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
		const [{ bindingCapital, nonDecisionThreshold, gameEnd, forkThreshold, forkTime, frozenForkThreshold }, gameWithdrawal, simulation] = await drainConcurrent([
			gameEconomics,
			client.simulateContract({ abi: escalationGameAbi, address: candidate.game, account: candidate.pool, args: [argument, candidate.outcome], blockNumber, functionName: 'withdrawDeposit' }),
			client.simulateContract({ abi: questionLedgerAbi, address: candidate.pool, account: context.wallet, args: [candidate.outcome, [argument]], blockNumber, functionName: 'withdrawForkedEscalationDeposits' }),
		])
		const liveForkThreshold = forkTime > gameEnd ? nonDecisionThreshold : forkThreshold
		const economics = computeWinningEconomics({
			// A resumed carried game records the threshold at resume and on every deposit; zero means it never changed.
			actualForkThresholdAttoRep: frozenForkThreshold === 0n ? liveForkThreshold : frozenForkThreshold,
			bindingCapitalAttoRep: bindingCapital,
			cumulativeAmountAttoRep: argument.cumulativeAmountAttoRep,
			depositAmountAttoRep: argument.amountAttoRep,
			principalAttoRep: argument.amountAttoRep,
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
			resultingNullifierRoot: computeNullifierRootFromProof(proof.leafIndex, proof.nullifierSiblings, toHex(1n, { size: 32 })),
			amountToWithdrawAttoRep: economics.amountToWithdrawAttoRep.toString(),
			burnAmountAttoRep: economics.burnAmountAttoRep.toString(),
			preflightExpectedResult: '0x',
		}
	})
	await authenticateAnchor()
	const withdrawals = verified.filter(candidate => candidate !== undefined)
	return { complete: true, withdrawalPresence, withdrawals, withdrawalCandidateCount: candidates.length, digest: keccak256(toHex(JSON.stringify({ withdrawalPresence, withdrawals }))) }
}
