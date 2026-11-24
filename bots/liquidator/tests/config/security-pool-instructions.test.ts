import { expect, test } from 'bun:test'
import { parseSecurityPoolInstructions, serializeSecurityPoolInstructions } from '#config/security-pool-instructions'

const scope = { id: 'branch-bid-1', securityPool: '0x0000000000000000000000000000000000000011', universeId: '2' }
const bid = { ...scope, action: 'auction-bid', lots: '3', minimumAttoRepPerLot: '5000000000000000000', targetHealthFactorBps: '15000', maximumValueAttoEth: '100000000000000000' }

test('explicit bid and branch instructions round trip without token-unit conversion', () => {
	const input = [bid, { ...scope, id: 'choose-branch', action: 'fork-choice', outcome: '1' }, { ...scope, id: 'withdraw-vault', action: 'vault-withdraw', vault: scope.securityPool, amountAttoRep: '123' }]
	expect(serializeSecurityPoolInstructions(parseSecurityPoolInstructions(input))).toEqual(input)
	expect(parseSecurityPoolInstructions(undefined)).toEqual([])
})

test('rejects duplicate identities, fractional lots, invalid health, and unbounded integers', () => {
	for (const input of [[bid, bid], [{ ...bid, lots: '0.5' }], [{ ...bid, targetHealthFactorBps: '9999' }], [{ ...bid, universeId: (2n ** 248n).toString() }], [{ ...bid, maximumValueAttoEth: '0' }]]) expect(() => parseSecurityPoolInstructions(input)).toThrow()
})
