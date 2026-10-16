import { expect, test } from 'bun:test'
import { portfolioRunoffAvailability } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/runoff.js'

const unresolved = { backingUnits: 1n, backingAttoRep: 1n, ordinaryResidualPending: false, forkTime: 0n, systemState: 0n, resolved: false, disputeStakeAttoRep: 0n, poolCommitmentAttoEth: 100n, commitmentAttoEth: 100n, settlementCollateralAttoEth: 100n, priceValid: true, pendingReportId: 0n }

test('unresolved collateral keeps REP locked, while surplus commitment can run off without a price', () => {
	expect(portfolioRunoffAvailability(unresolved).reason).toContain('unresolved')
	expect(portfolioRunoffAvailability({ ...unresolved, poolCommitmentAttoEth: 120n, priceValid: false })).toEqual({ reason: undefined, partial: true })
	expect(portfolioRunoffAvailability({ ...unresolved, settlementCollateralAttoEth: 0n })).toEqual({ reason: undefined, partial: false })
	expect(portfolioRunoffAvailability({ ...unresolved, commitmentAttoEth: 0n, priceValid: false }).reason).toContain('fresh')
})

test('finality unlocks commitment and REP together without an oracle but preserves escrow and fork activation locks', () => {
	expect(portfolioRunoffAvailability({ ...unresolved, resolved: true, priceValid: false, forkTime: 10n })).toEqual({ reason: undefined, partial: false })
	expect(portfolioRunoffAvailability({ ...unresolved, resolved: true, disputeStakeAttoRep: 1n }).reason).toContain('dispute')
	expect(portfolioRunoffAvailability({ ...unresolved, forkTime: 10n }).reason).toContain('migration')
	expect(portfolioRunoffAvailability({ ...unresolved, resolved: true, systemState: 1n }).reason).toContain('migration')
})

test('final withdrawal reserves ordinary residuals without consent and never bypasses own escrow', () => {
	const pending = { ...unresolved, resolved: true, ordinaryResidualPending: true }
	expect(portfolioRunoffAvailability(pending).reason).toBeUndefined()
	expect(portfolioRunoffAvailability(pending, true).reason).toBeUndefined()
	expect(portfolioRunoffAvailability({ ...pending, disputeStakeAttoRep: 1n }).reason).toContain('dispute')
	expect(portfolioRunoffAvailability({ ...pending, disputeStakeAttoRep: 1n }, true).reason).toContain('dispute')
	expect(portfolioRunoffAvailability({ ...pending, backingUnits: 0n }).reason).toBeUndefined()
	expect(portfolioRunoffAvailability({ ...pending, backingAttoRep: 0n }).reason).toBeUndefined()
})

test('unresolved ordinary claims also protect a full REP exit without blocking harmless commitment reductions', () => {
	const pending = { ...unresolved, ordinaryResidualPending: true, backingAttoRep: 1n, settlementCollateralAttoEth: 0n }
	expect(portfolioRunoffAvailability(pending).reason).toContain('residual')
	expect(portfolioRunoffAvailability(pending, true).reason).toBeUndefined()
	expect(portfolioRunoffAvailability({ ...pending, priceValid: false })).toEqual({ reason: undefined, partial: true })
	expect(portfolioRunoffAvailability({ ...pending, pendingReportId: 1n })).toEqual({ reason: undefined, partial: true })
	expect(portfolioRunoffAvailability({ ...pending, settlementCollateralAttoEth: 1n })).toEqual({ reason: undefined, partial: true })
	expect(portfolioRunoffAvailability({ ...pending, backingAttoRep: 0n }).reason).toBeUndefined()
	expect(portfolioRunoffAvailability({ ...pending, disputeStakeAttoRep: 1n }, true).reason).toContain('dispute')
})
