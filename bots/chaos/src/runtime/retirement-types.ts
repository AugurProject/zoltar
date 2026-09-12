import type { Hash } from '@zoltar/bot-shared/ethereum'
import type { OperationPlan } from '../operations/types.ts'
import type { DurableV3Position, RetirementBlocker, RetirementResidual } from '../state/retirement.ts'

export type V3PositionAnchor = {
	blockHash: Hash
	blockNumber: bigint
}

export type V3PositionObservation = {
	liquidity: bigint
	position: DurableV3Position
	tokensOwed0: bigint
	tokensOwed1: bigint
}

export type V3PositionReader = (position: DurableV3Position, anchor: V3PositionAnchor) => Promise<V3PositionObservation>

export type RetirementProofCounts = {
	actionableObligations: number
	claimableAssets: number
	collectableV3Positions: number
	knownApprovals: number
	ownedLiquidityPositions: number
	partialWorkflows: number
	pendingTransactions: number
}

export type RetirementAssessment = {
	action: { kind: 'existing-plan'; plan: OperationPlan } | { kind: 'v3-position'; observation: V3PositionObservation } | undefined
	blockers: RetirementBlocker[]
	proof: RetirementProofCounts
	residuals: RetirementResidual[]
	status: 'blocked' | 'known-claims-recovered' | 'drained' | 'drained-with-residuals' | 'draining' | 'waiting'
}
