import { expect, test } from 'bun:test'
import { parseSecurityPoolInstructions, serializeSecurityPoolInstructions } from '#config/security-pool-instructions'

const scope = { id: 'branch-bid-1', securityPool: '0x0000000000000000000000000000000000000011', universeId: '2' }
const bid = { ...scope, action: 'auction-bid', lots: '3', minimumAttoRepPerLot: '5000000000000000000', maximumValueAttoEth: '100000000000000000' }

test('explicit bid and branch instructions round trip without token-unit conversion', () => {
	const input = [
		bid,
		{ ...scope, id: 'choose-branch', action: 'fork-choice', outcome: '1' },
		{ ...scope, id: 'withdraw-capital', action: 'capital-withdraw', amountAttoRep: '123' },
		{ ...scope, id: 'set-health', action: 'capital-health', targetHealthFactorBps: '15000' },
		{ ...scope, id: 'claim-bids', action: 'auction-claim', bidIds: ['4', '7'] },
	]
	expect(serializeSecurityPoolInstructions(parseSecurityPoolInstructions(input))).toEqual(input)
	expect(parseSecurityPoolInstructions(undefined)).toEqual([])
})

test('rejects duplicate identities, fractional lots, invalid health, and unbounded integers', () => {
	for (const input of [
		[bid, bid],
		[{ ...bid, lots: '0.5' }],
		[{ ...scope, action: 'capital-health', targetHealthFactorBps: '9999' }],
		[{ ...scope, action: 'vault-withdraw', vault: scope.securityPool, amountAttoRep: '1' }],
		[{ ...bid, universeId: (2n ** 248n).toString() }],
		[{ ...bid, maximumValueAttoEth: '0' }],
		[{ ...scope, action: 'auction-claim', bidIds: [] }],
		[{ ...scope, action: 'auction-claim', bidIds: ['0'] }],
		[{ ...scope, action: 'auction-claim', bidIds: ['3', '3'] }],
		[{ ...scope, action: 'auction-claim', bidIds: Array.from({ length: 65 }, (_, index) => String(index + 1)) }],
		[{ ...scope, action: 'auction-activate', bidId: '1' }],
	])
		expect(() => parseSecurityPoolInstructions(input)).toThrow()
})
