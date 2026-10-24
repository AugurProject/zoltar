import { expect, test } from 'bun:test'
import { capitalAuthorizationReason, capitalPositionPhase, requiredPortfolioCollateral, requiredPortfolioExecutionReserve } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/capital.js'
import { capitalSnapshot, unit } from './capitalFixture.js'
test('collateral follows the owner health target and each contract rounding step', () => {
	const snapshot = capitalSnapshot()
	expect(requiredPortfolioCollateral(snapshot, 10n * unit)).toBe(25_200_000_000_000_000_000n)
	expect(requiredPortfolioCollateral({ ...snapshot, acceptedPrice: 1n }, 1n)).toBe(3n)
	expect(requiredPortfolioCollateral({ ...snapshot, ownerAccount: { ...snapshot.ownerAccount, targetHealthFactorBps: 0n } }, 10n * unit)).toBe(21n * unit)
})
test('execution reserves grow with commitment lots and existing active reserve counts toward funding', () => {
	const snapshot = capitalSnapshot({ ownerAccount: { ...capitalSnapshot().ownerAccount, executionReserveAttoEth: 0n } })
	expect(requiredPortfolioExecutionReserve(snapshot, unit + 1n)).toBe(2n * 10n ** 15n)
	expect(capitalAuthorizationReason(snapshot, 10n * unit)).toBeUndefined()
	expect(capitalAuthorizationReason(snapshot, 11n * unit)).toContain('reserve')
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
