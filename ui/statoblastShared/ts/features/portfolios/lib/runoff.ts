import type { PortfolioPosition } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import * as copy from '../../../copy/portfolio.js'

/** Conservative snapshot preview; the native pool rechecks live balances and oracle state. */
export function portfolioRunoffAvailability(
	position: Pick<PortfolioPosition, 'ordinaryResidualPending' | 'backingUnits' | 'backingAttoRep' | 'forkTime' | 'systemState' | 'resolved' | 'disputeStakeAttoRep' | 'poolCommitmentAttoEth' | 'commitmentAttoEth' | 'settlementCollateralAttoEth' | 'priceValid' | 'pendingReportId'>,
	residualForfeitureAllowed = false,
) {
	if ((position.forkTime > 0n && !position.resolved) || position.systemState !== 0n) return { reason: copy.forkWithdrawal, partial: false }
	if (position.resolved) {
		if (position.disputeStakeAttoRep > 0n) return { reason: copy.escrowWithdrawal, partial: false }
		return { reason: position.backingUnits > 0n && position.ordinaryResidualPending && !residualForfeitureAllowed ? copy.residualWithdrawal : undefined, partial: false }
	}
	const slack = position.poolCommitmentAttoEth > position.settlementCollateralAttoEth ? position.poolCommitmentAttoEth - position.settlementCollateralAttoEth : 0n
	const canReduce = position.commitmentAttoEth > 0n && slack > 0n
	const canExit = position.commitmentAttoEth <= slack
	if (canReduce && (!canExit || !position.priceValid || position.pendingReportId > 0n)) return { reason: undefined, partial: true }
	if (!canExit) return { reason: copy.unresolvedWithdrawal, partial: false }
	if (position.disputeStakeAttoRep > 0n) return { reason: copy.escrowWithdrawal, partial: false }
	if (!position.priceValid || position.pendingReportId > 0n) return { reason: copy.staleWithdrawal, partial: false }
	return { reason: position.backingUnits > 0n && position.backingAttoRep > 0n && position.ordinaryResidualPending && !residualForfeitureAllowed ? copy.residualWithdrawal : undefined, partial: false }
}
