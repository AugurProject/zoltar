import { expect, test } from 'bun:test'
import { totalManagedPrincipalAttoRep } from '../../src/core/portfolio-exposure.ts'
import { portfolioObservation, unit } from '../support/portfolio-observation.ts'

test('managed totals include vault and pending exposure without adding direct principal twice', () => {
	const direct = portfolioObservation()
	direct.snapshot.ownerPrincipalAttoRep = 10n * unit
	const managed = portfolioObservation()
	managed.snapshot.ownerPrincipalAttoRep = 20n * unit
	managed.managedPrincipalAttoRep = 70n * unit
	expect(totalManagedPrincipalAttoRep([direct, managed])).toBe(80n * unit)
	managed.managedPrincipalAttoRep = 0n
	expect(totalManagedPrincipalAttoRep([direct, managed])).toBe(10n * unit)
	expect(totalManagedPrincipalAttoRep([])).toBe(0n)
})
