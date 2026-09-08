import type { Address, Hash } from '@zoltar/bot-shared/ethereum'
import type { DurableRetirementState } from '../state/retirement.ts'
import type { RetirementAssessment } from './retirement-types.ts'

export type RetirementCompletionBinding = {
	profileId: string
	scannedWallet: Address
	signerAddress: Address | undefined
}

export function applyRetirementAssessment(retirement: DurableRetirementState, assessment: RetirementAssessment, blockHash: Hash, blockNumber: bigint, binding: RetirementCompletionBinding, now = new Date().toISOString()) {
	const terminal = assessment.status === 'drained' || assessment.status === 'drained-with-residuals'
	const completionSigner = binding.signerAddress
	if (terminal) {
		if (completionSigner === undefined) throw new Error('Retirement completion requires a bound signer')
		if (completionSigner.toLowerCase() !== binding.scannedWallet.toLowerCase()) throw new Error('Retirement completion scan wallet does not match the bound signer')
		const outstanding = assessment.proof.actionableObligations + assessment.proof.claimableAssets + assessment.proof.collectableV3Positions + assessment.proof.knownApprovals + assessment.proof.ownedLiquidityPositions + assessment.proof.partialWorkflows + assessment.proof.pendingTransactions
		if (outstanding !== 0) throw new Error('Retirement completion requires every canonical proof count to be zero')
	}
	retirement.blockers = assessment.blockers
	retirement.status = assessment.status
	retirement.updatedAt = now
	retirement.profileReplacementOverride = undefined
	if (!terminal) {
		retirement.completionEvidence = undefined
		return
	}
	if (completionSigner === undefined) throw new Error('Retirement completion requires a bound signer')
	retirement.completionEvidence = {
		blockHash,
		blockNumber: blockNumber.toString(),
		completedAt: now,
		profileId: binding.profileId,
		proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
		residuals: assessment.residuals,
		signerAddress: completionSigner,
	}
}
