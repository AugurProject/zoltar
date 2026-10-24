import { expect, test } from 'bun:test'
import { loadPortfolioAccount, verifyRuntimeCode } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { capitalClient, modules } from '../features/portfolios/capitalClient.js'
import { capitalSnapshot, owner, portfolio } from '../features/portfolios/capitalFixture.js'
test('custody authentication and bounded accounting pin every read to one mined block', async () => {
	const fixture = capitalClient(capitalSnapshot({ questionCount: 10_000n }))
	const snapshot = await loadPortfolioAccount(fixture.client, portfolio, owner, 0n)
	expect(snapshot.positions).toHaveLength(1)
	expect(snapshot.questions).toHaveLength(64)
	expect(new Set(fixture.reads.map(read => read.blockNumber))).toEqual(new Set([10n]))
	expect(fixture.reads.length).toBeLessThan(80)
})
test('a spoofed module fails closed before approvals can be offered', async () => {
	const fixture = capitalClient()
	fixture.codes.set(modules.engine, '0x6000')
	await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow('settlement engine runtime')
})
test('runtime masking requires repeated immutable instances to agree', () => {
	const refs = {
		'1': [
			{ start: 1, length: 1 },
			{ start: 3, length: 1 },
		],
	}
	expect(() => verifyRuntimeCode('0x60aa60aa', '0x60006000', refs, 'module')).not.toThrow()
	expect(() => verifyRuntimeCode('0x60aa60bb', '0x60006000', refs, 'module')).toThrow('Inconsistent')
	expect(() => verifyRuntimeCode('0x61aa60aa', '0x60006000', refs, 'module')).toThrow('Unrecognized')
})
