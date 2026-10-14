import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { getLiquidationMigrationSecurityMultiplierBps } from './liquidation.js'
import type { PortfolioQuestionOperations } from './securityPoolPortfolio.js'
import type { PortfolioPosition, PortfolioSnapshot } from './securityPoolPortfolioRead.js'

type PortfolioAllocation = { questionId: bigint; depositAttoRep: bigint; commitmentAttoEth: bigint }

function requireUint(value: bigint, label: string) {
	if (value < 0n || value >= 1n << 256n) throw new Error(`${label} must fit uint256.`)
}

/** Native backing-unit minting and floor division, including the empty-pool exchange rate. */
function backingAfterDeposit(position: PortfolioPosition, depositAttoRep: bigint) {
	const minted = position.totalBackingUnits === 0n || position.poolHeldAttoRep === 0n ? depositAttoRep * 10n ** 18n : (depositAttoRep * position.totalBackingUnits) / position.poolHeldAttoRep
	if (depositAttoRep > 0n && minted === 0n) throw new Error('Deposit would mint no backing units.')
	const totalUnits = position.totalBackingUnits + minted
	return totalUnits === 0n ? 0n : ((position.backingUnits + minted) * (position.poolHeldAttoRep + depositAttoRep)) / totalUnits
}

function requireHealthy(position: PortfolioPosition, backingAttoRep: bigint, commitmentAttoEth: bigint, healthFactorBps: bigint) {
	const base = ceilDiv(commitmentAttoEth * position.price, 10n ** 18n)
	const associated = ceilDiv(ceilDiv(base * position.securityMultiplierBps, 10_000n) * healthFactorBps, 10_000n)
	const poolHeld = ceilDiv(ceilDiv(base * getLiquidationMigrationSecurityMultiplierBps(position.securityMultiplierBps), 10_000n) * healthFactorBps, 10_000n)
	if (backingAttoRep + position.disputeStakeAttoRep < associated || backingAttoRep < poolHeld) throw new Error(`Question ${position.questionId} would fall below the requested health buffer.`)
}

/**
 * Conservative fresh-price allocations. Withdrawals, escrow, fees and pending receipts supply no
 * liquidity. The plan is a block-specific preview; contracts enforce the actual execution state.
 * Only the allocated questions require complete authorized-operation scans: unread questions and unrelated
 * queues cannot contribute liquidity or change another question's backing or commitment.
 * @public Planner API exported by the securityPoolPortfolio package subpath.
 */
export function planPortfolioAllocations(parameters: { snapshot: PortfolioSnapshot; universeId: bigint; minimumIdleAttoRep: bigint; minimumHealthFactorBps: bigint; allocations: readonly PortfolioAllocation[] }) {
	const { snapshot, universeId, minimumIdleAttoRep, minimumHealthFactorBps, allocations } = parameters
	requireUint(minimumIdleAttoRep, 'Idle reserve')
	requireUint(minimumHealthFactorBps, 'Health buffer')
	if (minimumHealthFactorBps < 10_000n) throw new Error('Health buffer must be at least 10000 basis points.')
	if (allocations.length === 0 || allocations.length > 16) throw new Error('Choose one to 16 allocations.')
	const branch = snapshot.branches.find(candidate => candidate.universeId === universeId)
	if (!branch) throw new Error('Selected universe was not read in this snapshot.')
	if (branch.forkTime !== 0n) throw new Error('The selected universe has forked; choose a child branch explicitly.')
	let idleAfterAttoRep = branch.idleAttoRep
	const used = new Set<bigint>()
	const operations: PortfolioQuestionOperations[] = []
	const previews: { questionId: bigint; backingAfterAttoRep: bigint; commitmentAttoEth: bigint }[] = []
	for (const allocation of allocations) {
		const { questionId, depositAttoRep, commitmentAttoEth } = allocation
		requireUint(questionId, 'Question id')
		requireUint(depositAttoRep, 'REP deposit')
		requireUint(commitmentAttoEth, 'ETH commitment')
		if (used.has(questionId)) throw new Error('Plan each question once per batch.')
		used.add(questionId)
		const position = branch.positions.find(candidate => candidate.questionId === questionId && candidate.registered)
		if (!position) throw new Error(`Question ${questionId} has no registered pool in this universe.`)
		if (!position.allocationOperationsComplete) throw new Error(`Question ${questionId} operation scan is incomplete; refresh its history or increase its operation scan limit before planning.`)
		if (position.systemState !== 0n || position.resolved || position.forkTime !== 0n || snapshot.timestamp >= position.questionEndTime) throw new Error(`Question ${questionId} is outside this planner's pre-end operational allocation window.`)
		if (!position.priceValid || position.price === 0n || position.pendingReportId !== 0n) throw new Error(`Question ${questionId} needs a settled, fresh oracle price.`)
		// Anyone can queue a liquidation targeting this vault. A backing or commitment mutation
		// invalidates that incoming quote; it must not prevent the owner's immediate allocation.
		const pendingAuthorized = position.queuedOperations.some(operation => {
			if (operation.operationType !== 0n || operation.operator.toLowerCase() === snapshot.vault.toLowerCase()) return true
			return operation.receiverVault.toLowerCase() === snapshot.vault.toLowerCase() && snapshot.timestamp <= operation.queuedAt + position.settlementTime + operation.validForSeconds
		})
		if (pendingAuthorized) throw new Error(`Question ${questionId} has pending operations; resolve them and refresh first.`)
		if (commitmentAttoEth < position.commitmentAttoEth) throw new Error('This allocation planner cannot reduce commitments or withdraw REP.')
		if (depositAttoRep === 0n && commitmentAttoEth === position.commitmentAttoEth) throw new Error('Choose a deposit or commitment increase.')
		if (depositAttoRep > idleAfterAttoRep || idleAfterAttoRep - depositAttoRep < minimumIdleAttoRep) throw new Error('Allocations exceed the actual idle REP balance after its reserve.')
		const backingAfterAttoRep = backingAfterDeposit(position, depositAttoRep)
		if (depositAttoRep > 0n && backingAfterAttoRep < position.minimumDepositAttoRep) throw new Error(`Question ${questionId} requires a larger vault deposit.`)
		requireHealthy(position, backingAfterAttoRep, commitmentAttoEth, minimumHealthFactorBps)
		idleAfterAttoRep -= depositAttoRep
		operations.push({
			questionId,
			universeId,
			minimumIdleAttoRep,
			input: { depositAttoRep, changeCommitment: commitmentAttoEth !== position.commitmentAttoEth, commitmentAttoEth, liquidations: [], withdrawAttoRep: 0n, minimumReceiverHealthFactorBps: minimumHealthFactorBps, validForSeconds: 300n },
			proposedRepPerEthPrice: 0n,
			requestedInitialAttoWeth: 0n,
			bountyAttoEth: 0n,
			value: 0n,
		})
		previews.push({ questionId, backingAfterAttoRep, commitmentAttoEth })
	}
	return { operations, previews, idleAfterAttoRep, repToken: branch.repToken, universeId, blockNumber: snapshot.blockNumber, requireImmediate: true }
}
