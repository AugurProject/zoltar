import { expect, test } from 'bun:test'
import { loadPortfolioAccount, verifyRuntimeCode } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { capitalClient, modules } from '../features/portfolios/capitalClient.js'
import { capitalSnapshot, owner, portfolio, capital } from '../features/portfolios/capitalFixture.js'
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
test('an unrecognized capital lifecycle delegate fails closed before approvals', async () => {
	const fixture = capitalClient()
	fixture.setRead('lifecycleDelegate', modules.engine)
	await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow('capital lifecycle delegate runtime')
})
test('a genuine lifecycle delegate bound to another ledger fails authentication', async () => {
	const fixture = capitalClient()
	fixture.setRead('ledger', modules.engine, modules.lifecycle)
	await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow('capital lifecycle delegate belongs to another authority')
})
test('a genuine capital ledger cannot nominate an unrelated fork authority', async () => {
	const fixture = capitalClient()
	fixture.setRead('forkAuthority', modules.engine)
	await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow('Capital ledger uses another fork authority')
})
test('capital accounting must use the portfolio services authority', async () => {
	const fixture = capitalClient()
	fixture.setRead('services', modules.engine, capital)
	await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow('Capital ledger uses another services authority')
})
test('reporter reward accounting must use the same services authority', async () => {
	const fixture = capitalClient()
	fixture.setRead('services', modules.engine, modules.rewards)
	await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow('Reporting rewards use another services authority')
})
for (const [module, label] of [
	[modules.services, 'portfolio services'],
	[modules.rewards, 'reporting rewards'],
	[modules.premium, 'resolution premium book'],
] as const) {
	test(`unrecognized ${label} code blocks portfolio approval`, async () => {
		const fixture = capitalClient()
		fixture.codes.set(module, '0x6000')
		await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow(`${label} runtime`)
	})
}
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
