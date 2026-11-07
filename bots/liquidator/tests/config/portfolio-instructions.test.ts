import { expect, test } from 'bun:test'
import { parsePortfolioInstructions, serializePortfolioInstructions } from '#config/portfolio-instructions'

const scope = { id: 'branch-bid-1', portfolio: '0x0000000000000000000000000000000000000011', universeId: '2' }
const bid = { ...scope, action: 'auction-bid', lots: '3', minimumAttoRepPerLot: '5000000000000000000', targetHealthFactorBps: '15000', maximumValueAttoEth: '100000000000000000' }

test('explicit bid and branch instructions round trip without token-unit conversion', () => {
	const input = [bid, { ...scope, id: 'choose-branch', action: 'fork-choice', outcome: '1' }, { ...scope, id: 'withdraw-vault', action: 'vault-withdraw', vault: scope.portfolio, amountAttoRep: '123' }]
	expect(serializePortfolioInstructions(parsePortfolioInstructions(input))).toEqual(input)
	expect(parsePortfolioInstructions(undefined)).toEqual([])
})

test('rejects duplicate identities, fractional lots, invalid health, and unbounded integers', () => {
	for (const input of [[bid, bid], [{ ...bid, lots: '0.5' }], [{ ...bid, targetHealthFactorBps: '9999' }], [{ ...bid, universeId: (2n ** 248n).toString() }], [{ ...bid, maximumValueAttoEth: '0' }]]) expect(() => parsePortfolioInstructions(input)).toThrow()
})
