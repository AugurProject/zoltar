import { planClaimCheckpointPreparation, prepareClaimCheckpointBatch, type ClaimCheckpointIdentity, type ClaimCheckpointSettlement } from '@zoltar/statoblast-shared/escalationGame/claimCheckpoint'
import { zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { escalationGameAbi, securityPoolAbi, securityPoolForkerAbi } from '@zoltar/bot-shared/contracts/abi'
import type { ForkedClaimCheckpointSnapshot } from '../operations/carry-types.ts'
import type { loadCarryStorageCandidates } from './carry-proof-storage.ts'
import { DISCOVERY_RPC_CONCURRENCY, drainConcurrent, mapWithConcurrency, type ChaosReadClient } from './discovery-client.ts'

type Candidate = Awaited<ReturnType<typeof loadCarryStorageCandidates>>[number]

export function createCarryCheckpointReader(context: { client: Pick<ChaosReadClient, 'readContract'>; blockNumber: bigint; securityPoolForker: Address; multicall3?: Address }) {
	const { client, blockNumber } = context
	// These promise caches live only inside one authenticated canonical-block scan.
	const games = new Map<string, ReturnType<typeof readGame>>()
	async function readGame(game: Address) {
		const pool = await client.readContract({ abi: escalationGameAbi, address: game, blockNumber, functionName: 'securityPool' })
		const [actualGame, parent, forker, frozen] = await drainConcurrent([
			client.readContract({ abi: securityPoolAbi, address: pool, blockNumber, functionName: 'escalationGame' }),
			client.readContract({ abi: securityPoolAbi, address: pool, blockNumber, functionName: 'parent' }),
			client.readContract({ abi: securityPoolAbi, address: pool, blockNumber, functionName: 'securityPoolForker' }),
			client.readContract({ abi: escalationGameAbi, address: game, blockNumber, functionName: 'isClaimHistoryFrozen' }),
		])
		if (actualGame.toLowerCase() !== game.toLowerCase() || forker.toLowerCase() !== context.securityPoolForker.toLowerCase()) throw new Error('Claim checkpoint canonical game/pool route mismatch')
		const parentGame = parent === zeroAddress ? zeroAddress : await client.readContract({ abi: securityPoolAbi, address: parent, blockNumber, functionName: 'escalationGame' })
		return { pool, parentGame, frozen }
	}
	function gameInfo(game: Address) {
		const key = game.toLowerCase()
		let value = games.get(key)
		if (value === undefined) {
			value = readGame(game)
			games.set(key, value)
		}
		return value
	}
	const transforms = new Map<string, ReturnType<typeof readTransform>>()
	function readTransform(game: Address, claim: ClaimCheckpointIdentity) {
		return client.readContract({ abi: escalationGameAbi, address: game, args: [claim.outcomeIndex, claim.leafIndex], blockNumber, functionName: 'getClaimIntervalTransform' })
	}
	function transform(game: Address, claim: ClaimCheckpointIdentity) {
		const key = `${game.toLowerCase()}:${claim.outcomeIndex}:${claim.leafIndex}`
		let value = transforms.get(key)
		if (value === undefined) {
			value = readTransform(game, claim)
			transforms.set(key, value)
		}
		return value
	}
	const progresses = new Map<string, ReturnType<typeof readProgress>>()
	function readProgress(game: Address, claim: ClaimCheckpointIdentity) {
		return client.readContract({ abi: escalationGameAbi, address: game, args: [claim.outcomeIndex, claim.amountAttoRep, claim.cumulativeAmountAttoRep, claim.leafIndex], blockNumber, functionName: 'getClaimCheckpointProgress' })
	}
	function progress(game: Address, claim: ClaimCheckpointIdentity) {
		const key = `${game.toLowerCase()}:${claim.outcomeIndex}:${claim.amountAttoRep}:${claim.cumulativeAmountAttoRep}:${claim.leafIndex}`
		let value = progresses.get(key)
		if (value === undefined) {
			value = readProgress(game, claim)
			progresses.set(key, value)
		}
		return value
	}
	const readyGames = new Map<string, ReturnType<typeof readFinalReady>>()
	async function readFinalReady(candidate: Candidate) {
		const [poolState, resolved, initialized, resolution, poolOutcome] = await drainConcurrent([
			client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber, functionName: 'systemState' }),
			client.readContract({ abi: securityPoolAbi, address: candidate.pool, blockNumber, functionName: 'isEscalationResolved' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'forkCarrySnapshotInitialized' }),
			client.readContract({ abi: escalationGameAbi, address: candidate.game, blockNumber, functionName: 'getFinalQuestionResolution' }),
			client.readContract({ abi: securityPoolForkerAbi, address: context.securityPoolForker, args: [candidate.pool], blockNumber, functionName: 'getQuestionOutcome' }),
		])
		return BigInt(poolState) === 0n && resolved && initialized && Number(resolution) === candidate.outcome && Number(poolOutcome) === candidate.outcome
	}
	function finalReady(candidate: Candidate) {
		if (candidate.forker.toLowerCase() !== context.securityPoolForker.toLowerCase()) throw new Error('Carry storage pool uses an unexpected forker')
		const key = `${candidate.game.toLowerCase()}:${candidate.outcome}`
		let value = readyGames.get(key)
		if (value === undefined) {
			value = readFinalReady(candidate)
			readyGames.set(key, value)
		}
		return value
	}
	const identity = (candidate: Candidate): ClaimCheckpointIdentity => ({ outcomeIndex: candidate.outcome, amountAttoRep: BigInt(candidate.amountAttoRep), cumulativeAmountAttoRep: BigInt(candidate.cumulativeAmountAttoRep), leafIndex: BigInt(candidate.leafIndex) })
	// A currently missing rotating proof does not rule out atomic settlement in a later scan.
	const settlement: ClaimCheckpointSettlement = context.multicall3 === undefined ? 'separate' : 'unknown'
	async function checkpoints(candidates: readonly Candidate[]) {
		const targets = (await mapWithConcurrency(candidates, DISCOVERY_RPC_CONCURRENCY, async candidate => ((await finalReady(candidate)) && !(await progress(candidate.game, identity(candidate))).ready ? candidate : undefined))).filter(candidate => candidate !== undefined)
		const jobs = await planClaimCheckpointPreparation({
			claims: targets.map(candidate => ({ game: candidate.game, claim: identity(candidate), settlement })),
			readNode: async (game, claim) => {
				const [info, local, checkpoint] = await drainConcurrent([gameInfo(game), transform(game, claim), progress(game, claim)])
				if (local.sourceGame !== zeroAddress && local.sourceGame.toLowerCase() !== info.parentGame.toLowerCase()) throw new Error('Claim checkpoint canonical ancestor mismatch')
				return { parentGame: local.sourceGame, historyFrozen: info.frozen, progress: checkpoint }
			},
		})
		return mapWithConcurrency(jobs, DISCOVERY_RPC_CONCURRENCY, async job => {
			const candidate = targets.find(
				candidate =>
					candidate.game.toLowerCase() === job.targetGame.toLowerCase() &&
					candidate.outcome === job.claim.outcomeIndex &&
					candidate.amountAttoRep === job.claim.amountAttoRep.toString() &&
					candidate.cumulativeAmountAttoRep === job.claim.cumulativeAmountAttoRep.toString() &&
					candidate.leafIndex === job.claim.leafIndex.toString(),
			)
			if (candidate === undefined) throw new Error('Checkpoint plan lost its authenticated claim')
			const args = [job.claim.outcomeIndex, job.claim.amountAttoRep, job.claim.cumulativeAmountAttoRep, job.claim.leafIndex] as const
			const [checkpoint, state, segment, info] = await drainConcurrent([
				progress(job.game, job.claim),
				client.readContract({ abi: escalationGameAbi, address: job.game, args, blockNumber, functionName: 'getClaimCheckpointState' }),
				client.readContract({ abi: escalationGameAbi, address: job.game, args, blockNumber, functionName: 'getClaimCheckpointWitnessSegment' }),
				gameInfo(job.game),
			])
			const batch = await prepareClaimCheckpointBatch({
				game: job.game,
				claim: job.claim,
				progress: checkpoint,
				state: { pendingCommitment: state.pendingCommitment, segmentSourceGame: segment.sourceGame, segmentPreviousCommitment: segment.previousCommitment, firstStep: segment.firstStep, steps: segment.steps },
				readTransform: source => transform(source, job.claim),
			})
			return {
				pool: info.pool,
				game: job.game,
				targetGame: job.targetGame,
				preparationReason: job.reason,
				settlement,
				sourceGame: info.parentGame,
				claimSourceGame: candidate.claimSourceGame,
				outcome: candidate.outcome,
				parentDepositIndex: candidate.parentDepositIndex,
				sourceNodeId: candidate.sourceNodeId,
				amountAttoRep: candidate.amountAttoRep,
				cumulativeAmountAttoRep: candidate.cumulativeAmountAttoRep,
				leafIndex: candidate.leafIndex,
				nextSourceGame: checkpoint.nextSourceGame,
				pendingSteps: checkpoint.pendingSteps.toString(),
				pendingCommitment: state.pendingCommitment,
				baseCommitment: batch.baseCommitment,
				transforms: batch.transforms.map(value => ({ repBeforeAttoRep: value.repBeforeAttoRep.toString(), repRemainingAttoRep: value.repRemainingAttoRep.toString(), consumedBeforeAttoRep: value.consumedBeforeAttoRep.toString() })),
			} satisfies ForkedClaimCheckpointSnapshot
		})
	}
	return { checkpoints, finalReady, progress, identity }
}
