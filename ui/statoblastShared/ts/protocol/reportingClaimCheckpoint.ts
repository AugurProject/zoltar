import { CLAIM_CHECKPOINT_MAX_STEPS, isFinalClaimCheckpointBatch, shouldInspectClaimCheckpointParent, planClaimCheckpointPreparation, prepareClaimCheckpointBatch, type ClaimCheckpointIdentity, type ClaimCheckpointNode } from '@zoltar/statoblast-shared/escalationGame/claimCheckpoint'
import { concatHex, encodeAbiParameters, encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate as claimArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '../contractArtifact.js'
import { statoblast_Multicall3_Multicall3 as multicallArtifact } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getMulticall3Address } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { AuthenticatedForkClaim, CarriedDepositProof } from '../types/contracts.js'
import { withClaimReadContext } from './claimReadContext.js'
import { claimStateChanged, isFailedClaimMulticall, isStaleClaimNullifier } from './claimActionState.js'
import { getCarrySnapshotRoot } from './reportingCarryProof.js'

async function readCheckpoint(client: Pick<WriteClient, 'readContract'>, game: Address, claim: ClaimCheckpointIdentity) {
	const args = [claim.outcomeIndex, claim.amountAttoRep, claim.cumulativeAmountAttoRep, claim.leafIndex] as const
	const [progress, state, segment] = await Promise.all([
		client.readContract({ address: game, abi: claimArtifact.abi, functionName: 'getClaimCheckpointProgress', args }),
		client.readContract({ address: game, abi: claimArtifact.abi, functionName: 'getClaimCheckpointState', args }),
		client.readContract({ address: game, abi: claimArtifact.abi, functionName: 'getClaimCheckpointWitnessSegment', args }),
	])
	return {
		progress: { nextSourceGame: progress[0], pendingSteps: progress[1], complete: progress[2], ready: progress[3] },
		state: { pendingCommitment: state[1], segmentSourceGame: segment[0], segmentPreviousCommitment: segment[1], firstStep: segment[2], steps: segment[3] },
	}
}

async function requireCurrentClaim(client: Pick<WriteClient, 'readContract'>, pool: Address, identity: AuthenticatedForkClaim) {
	const [game, snapshot] = await Promise.all([client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'escalationGame' }), client.readContract({ address: identity.escalationGame, abi: gameArtifact.abi, functionName: 'getOutcomeState', args: [getReportingOutcomeValue(identity.outcome)] })])
	if (!sameAddress(game, identity.escalationGame) || snapshot.snapshotLeafCount !== identity.snapshotLeafCount || getCarrySnapshotRoot(snapshot.snapshotLeafCount, snapshot.snapshotPeaks) !== identity.snapshotRoot) throw new Error('Inherited claim snapshot changed. Refresh the pool and retry.')
}

function snapshotKey(value: unknown) {
	return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item))
}

/** Retain authenticated membership between batches; mutable withdrawal proofs are built only for settlement. */
async function prepareCheckpointCall(client: WriteClient, pool: Address, identity: AuthenticatedForkClaim, settle: boolean) {
	const claim = { outcomeIndex: getReportingOutcomeValue(identity.outcome), amountAttoRep: identity.amountAttoRep, cumulativeAmountAttoRep: identity.cumulativeAmountAttoRep, leafIndex: identity.leafIndex }
	async function readPlan(includeWitness: boolean) {
		return await withClaimReadContext(client, async context => {
			await requireCurrentClaim(context, pool, identity)
			const terminal = await readCheckpoint(context, identity.escalationGame, claim)
			if (terminal.progress.ready) throw claimStateChanged('Claim preparation is complete. Settle the claim separately.')
			let game = identity.escalationGame
			if (!settle && shouldInspectClaimCheckpointParent(terminal.progress)) {
				const readNode = async (sourceGame: Address): Promise<ClaimCheckpointNode> => {
					const [local, frozen, progress] = await Promise.all([
						context.readContract({ address: sourceGame, abi: claimArtifact.abi, functionName: 'getClaimIntervalTransform', args: [claim.outcomeIndex, claim.leafIndex] }),
						context.readContract({ address: sourceGame, abi: claimArtifact.abi, functionName: 'isClaimHistoryFrozen' }),
						context.readContract({ address: sourceGame, abi: claimArtifact.abi, functionName: 'getClaimCheckpointProgress', args: [claim.outcomeIndex, claim.amountAttoRep, claim.cumulativeAmountAttoRep, claim.leafIndex] }),
					])
					return { parentGame: local[0], historyFrozen: frozen, progress: { nextSourceGame: progress[0], pendingSteps: progress[1], complete: progress[2], ready: progress[3] } }
				}
				const [job] = await planClaimCheckpointPreparation({ claims: [{ game, claim }], readNode, maxAncestorReads: 2 })
				if (job !== undefined) game = job.game
			}
			const snapshot = sameAddress(game, identity.escalationGame) ? terminal : await readCheckpoint(context, game, claim)
			if (settle && !isFinalClaimCheckpointBatch(snapshot.progress)) throw claimStateChanged('More claim preparation is required before combined settlement.')
			const batch = includeWitness
				? await prepareClaimCheckpointBatch({
						game,
						claim,
						...snapshot,
						readTransform: async sourceGame => {
							const [parentGame, transform] = await context.readContract({ address: sourceGame, abi: claimArtifact.abi, functionName: 'getClaimIntervalTransform', args: [claim.outcomeIndex, claim.leafIndex] })
							return { sourceGame: parentGame, transform }
						},
					})
				: undefined
			return { game, snapshot, batch }
		})
	}
	for (let attempt = 0; attempt < 2; attempt++) {
		const plan = await readPlan(true)
		const refreshed = await readPlan(false)
		if (snapshotKey([plan.game, plan.snapshot]) !== snapshotKey([refreshed.game, refreshed.snapshot])) continue
		if (plan.batch === undefined) throw new Error('Claim checkpoint witness is unavailable.')
		return {
			address: plan.game,
			abi: claimArtifact.abi,
			functionName: 'processClaimCheckpoint',
			args: [claim.outcomeIndex, claim.amountAttoRep, claim.cumulativeAmountAttoRep, claim.leafIndex, CLAIM_CHECKPOINT_MAX_STEPS, plan.batch.baseCommitment, plan.batch.transforms],
			reviewTitle: 'Prepare inherited claim',
			reviewDescription: sameAddress(plan.game, identity.escalationGame) ? 'Prepare up to eight ancestry steps for this deposit.' : 'Finish a reusable parent checkpoint for this deposit.',
		} as const
	}
	throw new Error('Claim preparation changed while loading. Refresh and retry.')
}

export async function submitClaimCheckpoint(client: WriteClient, pool: Address, identity: AuthenticatedForkClaim) {
	const call = await prepareCheckpointCall(client, pool, identity, false)
	return await writeContractAndWait(client, () => call)
}

function requireMatchingProof(identity: AuthenticatedForkClaim, proof: CarriedDepositProof) {
	if (proof.leafIndex !== identity.leafIndex || proof.parentDepositIndex !== identity.parentDepositIndex || proof.amountAttoRep !== identity.amountAttoRep || proof.cumulativeAmountAttoRep !== identity.cumulativeAmountAttoRep || !sameAddress(proof.depositor, identity.depositor))
		throw new Error('Settlement proof does not match the selected inherited claim.')
}

export async function submitClaimCheckpointAndSettlement(client: WriteClient, pool: Address, identity: AuthenticatedForkClaim, initialProof: CarriedDepositProof, rebuildProof: () => Promise<CarriedDepositProof>) {
	let proof = initialProof
	for (let attempt = 0; attempt < 2; attempt++) {
		requireMatchingProof(identity, proof)
		const checkpoint = await prepareCheckpointCall(client, pool, identity, true)
		const calls = [
			{ target: checkpoint.address, allowFailure: false, callData: encodeFunctionData(checkpoint) },
			{
				target: pool,
				allowFailure: false,
				callData: encodeFunctionData({ abi: poolArtifact.abi, functionName: 'withdrawForkedEscalationDeposits', args: [getReportingOutcomeValue(identity.outcome), [{ ...proof, merkleMountainRangeSiblings: Array.from(proof.merkleMountainRangeSiblings), nullifierSiblings: Array.from(proof.nullifierSiblings) }]] }),
			},
		]
		const call = { address: getMulticall3Address(), abi: multicallArtifact.abi, functionName: 'aggregate3', args: [calls] } as const
		try {
			await client.simulateContract({ ...call, account: client.account })
			const gas = await client.estimateGas({ account: client.account, to: call.address, data: encodeFunctionData(call) })
			if (gas > 5_000_000n) throw new Error('Combined claim exceeds the transaction budget. Prepare the claim separately.')
		} catch (error) {
			if (!isStaleClaimNullifier(error)) {
				if (!isFailedClaimMulticall(error)) throw error
				// aggregate3 masks inner revert reasons. Diagnose without submitting or relaxing the actual call.
				const diagnostic = await client.simulateContract({ ...call, args: [calls.map(item => ({ ...item, allowFailure: true }))], account: client.account })
				const [preparation, settlement] = diagnostic.result
				if (diagnostic.result.length !== 2) throw error
				if (preparation?.success === false) {
					await withClaimReadContext(client, async context => {
						await requireCurrentClaim(context, pool, identity)
						const claim = { outcomeIndex: getReportingOutcomeValue(identity.outcome), amountAttoRep: identity.amountAttoRep, cumulativeAmountAttoRep: identity.cumulativeAmountAttoRep, leafIndex: identity.leafIndex }
						const current = await readCheckpoint(context, identity.escalationGame, claim)
						if (current.progress.ready) throw claimStateChanged('Claim preparation is complete. Settle the claim separately.')
					})
				}
				const consumedData = concatHex(['0x08c379a0', encodeAbiParameters([{ type: 'string' }], ['Parent deposit claimed'])])
				if (preparation?.success === true && settlement?.success === false && settlement.returnData.toLowerCase() === consumedData) throw claimStateChanged(`Parent deposit #${identity.parentDepositIndex} is already settled.`)
				const staleNullifierData = concatHex(['0x08c379a0', encodeAbiParameters([{ type: 'string' }], ['Bad nullifier proof'])])
				if (preparation?.success !== true || settlement?.success !== false || settlement.returnData.toLowerCase() !== staleNullifierData) throw error
			}
			if (attempt > 0) throw claimStateChanged('Inherited claim changed again while loading. Refresh and retry.')
			proof = await rebuildProof()
			continue
		}
		// Recovery ends before send; a wallet rejection or broadcast failure must never resubmit.
		return await writeContractAndWait(client, () => ({ ...call, reviewTitle: 'Prepare and settle inherited claim', reviewDescription: 'Finish preparation and pay this deposit to its recorded depositor in one transaction.' }))
	}
	throw new Error('Inherited claim could not be prepared.')
}
