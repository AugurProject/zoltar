import { prepareClaimCheckpointBatch } from '@zoltar/statoblast-shared/escalationGame/claimCheckpoint'
import { zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate as artifact } from '../../../../types/contractArtifact'
import type { WriteClient } from '../clients'

export type ClaimCheckpointTuple = readonly [number, bigint, bigint, bigint]

export async function readClaimCheckpointBatch(client: WriteClient, game: Address, tuple: ClaimCheckpointTuple, maxSteps = 8n) {
	const progress = await client.readContract({ abi: artifact.abi, address: game, functionName: 'getClaimCheckpointProgress', args: tuple })
	if (progress[0] !== '0x0000000000000000000000000000000000000000' || progress[1] === 0n || progress[2]) return { baseCommitment: zeroHash, transforms: [] }
	const state = await client.readContract({ abi: artifact.abi, address: game, functionName: 'getClaimCheckpointState', args: tuple })
	const segment = await client.readContract({ abi: artifact.abi, address: game, functionName: 'getClaimCheckpointWitnessSegment', args: tuple })
	let reads = 0
	const batch = await prepareClaimCheckpointBatch({
		game,
		maxSteps,
		claim: { outcomeIndex: tuple[0], amountAttoRep: tuple[1], cumulativeAmountAttoRep: tuple[2], leafIndex: tuple[3] },
		progress: { nextSourceGame: progress[0], pendingSteps: progress[1], complete: progress[2], ready: progress[3] },
		state: { pendingCommitment: state[1], segmentSourceGame: segment[0], segmentPreviousCommitment: segment[1], firstStep: segment[2], steps: segment[3] },
		readTransform: async source => {
			reads += 1
			const next = await client.readContract({ abi: artifact.abi, address: source, functionName: 'getClaimIntervalTransform', args: [tuple[0], tuple[3]] })
			return { sourceGame: next[0], transform: next[1] }
		},
	})
	if (reads > 8) throw new Error(`Claim checkpoint recovery exceeded eight canonical reads: ${reads}`)
	return batch
}
