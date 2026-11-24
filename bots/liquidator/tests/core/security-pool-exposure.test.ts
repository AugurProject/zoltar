import { expect, test } from 'bun:test'
import { totalManagedPrincipalAttoRep } from '../../src/core/security-pool-exposure.ts'
import { securityPoolObservation, unit } from '../support/security-pool-observation.ts'

test('managed totals include vault and pending exposure without adding direct principal twice', () => {
	const direct = securityPoolObservation()
	direct.snapshot.ownerPrincipalAttoRep = 10n * unit
	const managed = securityPoolObservation()
	managed.snapshot.ownerPrincipalAttoRep = 20n * unit
	managed.managedPrincipalAttoRep = 70n * unit
	expect(totalManagedPrincipalAttoRep([direct, managed])).toBe(80n * unit)
	managed.managedPrincipalAttoRep = 0n
	expect(totalManagedPrincipalAttoRep([direct, managed])).toBe(10n * unit)
	expect(totalManagedPrincipalAttoRep([])).toBe(0n)
})
