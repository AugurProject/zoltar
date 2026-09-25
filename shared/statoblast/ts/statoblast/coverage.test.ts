import { describe, expect, test } from 'bun:test'
import { allocateCoverage, coverageMintUnits, coverageObligation, maximumCoveredObligation, type CoverageOfferPosition } from './coverage'

const offer: CoverageOfferPosition = { vault: '0x0000000000000000000000000000000000000001', enabled: true, maximumObligationAttoEth: 10_000n, minimumHealthFactorBps: 10_000n, obligationUnits: 0n, poolHeldAttoRep: 20_000n, disputeStakeAttoRep: 0n }

describe('coverage allocation router', () => {
	test('requires authorization and never allocates more than offered', () => {
		expect(() => allocateCoverage([{ ...offer, enabled: false }], 0n, 0n, 1n, 10n ** 18n, 20_000n)).toThrow('Insufficient authorized coverage')
		expect(() => allocateCoverage([offer], 0n, 0n, 10_001n, 10n ** 18n, 20_000n)).toThrow('Insufficient authorized coverage')
		expect(allocateCoverage([offer], 0n, 0n, 10_000n, 10n ** 18n, 20_000n)).toEqual([{ vault: offer.vault, collateralAttoEth: 10_000n }])
	})
	test('dispute stake cannot replace required liquid backing', () => {
		expect(maximumCoveredObligation({ ...offer, poolHeldAttoRep: 0n, disputeStakeAttoRep: 20_000n }, 10n ** 18n, 20_000n)).toBe(0n)
	})
	test('routes non-integral rates within exact resulting position limits', () => {
		for (let collateral = 1n; collateral < 25n; collateral++) {
			const total = collateral * 3n + 1n
			const amount = 37n
			const offers = [
				{ ...offer, maximumObligationAttoEth: 20n, obligationUnits: 3n },
				{ ...offer, vault: '0x0000000000000000000000000000000000000002' as const, maximumObligationAttoEth: 100n },
			]
			const route = allocateCoverage(offers, collateral, total, amount, 10n ** 18n, 20_000n)
			const minted = coverageMintUnits(collateral, total, amount)
			let allocated = 0n
			let units = 0n
			for (const allocation of route) {
				const position = offers.find(candidate => candidate.vault === allocation.vault)
				if (position === undefined) throw new Error('Missing routed vault')
				allocated += allocation.collateralAttoEth
				const next = (minted * allocated) / amount
				expect(coverageObligation(collateral + amount, position.obligationUnits + next - units, total + minted)).toBeLessThanOrEqual(position.maximumObligationAttoEth)
				units = next
			}
			expect(allocated).toBe(amount)
			expect(units).toBe(minted)
		}
	})
})
