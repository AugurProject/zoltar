import { expect, test } from 'bun:test'
import { capitalAuthorizationReason, capitalPositionPhase, requiredPortfolioCollateral, maximumPortfolioCommitment, capitalRetirementReason } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/capital.js'
import { capitalSnapshot, unit } from './capitalFixture.js'
test('collateral follows the owner health target and each contract rounding step', () => {
	const snapshot = capitalSnapshot()
	expect(requiredPortfolioCollateral(snapshot, 10n * unit)).toBe(25_200_000_000_000_000_000n)
	expect(requiredPortfolioCollateral({ ...snapshot, ownerConservativePrice: 1n }, 1n)).toBe(3n)
	expect(requiredPortfolioCollateral({ ...snapshot, ownerAccount: { ...snapshot.ownerAccount, targetHealthFactorBps: 0n } }, 10n * unit)).toBe(21n * unit)
})
test('target capacity reverses every rounding step and never quotes one extra unit of commitment', () => {
	for (const principal of [0n, 1n, 2n, 3n, 17n, 30n * unit]) {
		for (const price of [1n, 7n, unit, 2n * unit + 1n]) {
			const snapshot = capitalSnapshot({ ownerPrincipalAttoRep: principal, ownerConservativePrice: price })
			const capacity = maximumPortfolioCommitment(snapshot, 12_000n)
			expect(capacity).toBeDefined()
			if (capacity === undefined) throw new Error('Missing capacity')
			expect(requiredPortfolioCollateral(snapshot, capacity)).toBeLessThanOrEqual(principal)
			expect(requiredPortfolioCollateral(snapshot, capacity + 1n)).toBeGreaterThan(principal)
		}
	}
	expect(maximumPortfolioCommitment(capitalSnapshot({ ownerConservativePrice: 0n }), 12_000n)).toBeUndefined()
	expect(maximumPortfolioCommitment(capitalSnapshot(), 9_999n)).toBeUndefined()
	expect(maximumPortfolioCommitment(capitalSnapshot(), 1n << 256n)).toBeUndefined()
})
test('partial retirement keeps a meaningful residual and requires one complete reduction unit', () => {
	const snapshot = capitalSnapshot()
	expect(capitalRetirementReason(snapshot, 1n, 8n * unit)).toBeUndefined()
	expect(capitalRetirementReason(snapshot, 1n, 0n)).toBeUndefined()
	expect(capitalRetirementReason(snapshot, 1n, unit - 1n)).toContain('minimum')
	expect(capitalRetirementReason(snapshot, 1n, 10n * unit - 1n)).toContain('minimum')
	expect(capitalRetirementReason(snapshot, 1n, 10n * unit)).toContain('smaller')
})
test('authorizations cannot cut obligations, bypass personal collateral or consume unfunded commitments', () => {
	const snapshot = capitalSnapshot()
	expect(capitalAuthorizationReason(snapshot, 9n * unit)).toContain('retirement')
	expect(capitalAuthorizationReason({ ...snapshot, ownerPrincipalAttoRep: unit }, 10n * unit)).toContain('health')
	expect(capitalAuthorizationReason({ ...snapshot, priceValid: false }, 10n * unit)).toContain('price')
	expect(capitalAuthorizationReason({ ...snapshot, forkTime: 1n }, 10n * unit)).toContain('closed')
	expect(capitalAuthorizationReason({ ...snapshot, positions: [] }, unit - 1n)).toContain('minimum')
})
test('current and next retirement cohorts remain distinct without question-history scans', () => {
	expect(capitalPositionPhase(0n, 3n)).toBe('active')
	expect(capitalPositionPhase(3n, 3n)).toBe('current')
	expect(capitalPositionPhase(4n, 3n)).toBe('next')
})

test('all owner principal backs authorization and retirement must be canceled first', () => {
	const snapshot = capitalSnapshot({ withdrawableAttoRep: 0n })
	expect(capitalAuthorizationReason(snapshot, 10n * unit)).toBeUndefined()
	expect(capitalAuthorizationReason({ ...snapshot, positions: snapshot.positions.map(position => ({ ...position, batch: 2n })) }, 10n * unit)).toContain('Cancel retirement')
})

test('a funded report permits growth only with its conservative collateral price', () => {
	const snapshot = capitalSnapshot({ oracleExposureLimitAttoEth: 1n, ownerPrincipalAttoRep: 40n * unit })
	expect(capitalAuthorizationReason(snapshot, 10n * unit)).toContain('funded')
	expect(capitalAuthorizationReason(snapshot, 10n * unit, 3n * unit)).toBeUndefined()
	expect(capitalAuthorizationReason({ ...snapshot, ownerPrincipalAttoRep: 30n * unit }, 10n * unit, 3n * unit)).toContain('Collateral')
	expect(requiredPortfolioCollateral(snapshot, 10n * unit, 3n * unit)).toBe(37_800_000_000_000_000_000n)
})
test('unfunded authorization cannot ignore demand above nominal commitment', () => {
	const snapshot = capitalSnapshot({ demandAttoEth: 101n * unit })
	expect(capitalAuthorizationReason(snapshot, 10n * unit)).toContain('funded')
})

test('collateral-backed authorization needs no separate ETH execution budget', () => {
	const snapshot = capitalSnapshot({ walletAttoEth: 0n })
	expect(capitalAuthorizationReason(snapshot, 10n * unit)).toBeUndefined()
	expect(capitalAuthorizationReason(snapshot, 11n * unit)).toBeUndefined()
})
