import { expect, test } from 'bun:test'
import { loadPortfolioAccount, loadPortfolioSetup, verifyRuntimeCode } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { capitalClient, modules } from '../features/portfolios/capitalClient.js'
import { capitalSnapshot, owner, portfolio, capital } from '../features/portfolios/capitalFixture.js'
test('custody authentication and bounded accounting pin every read to one mined block', async () => {
	const fixture = capitalClient(capitalSnapshot({ questionCount: 10_000n }))
	const snapshot = await loadPortfolioAccount(fixture.client, portfolio, owner, 0n)
	expect(snapshot.positions).toHaveLength(1)
	expect(snapshot.questions).toHaveLength(64)
	expect(new Set(fixture.reads.map(read => read.blockNumber))).toEqual(new Set([10n]))
	expect(fixture.reads.length).toBeLessThan(86)
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
test('an unrecognized capital auction delegate fails closed before approvals', async () => {
	const fixture = capitalClient()
	fixture.setRead('auctionDelegate', modules.engine)
	await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow('capital auction delegate runtime')
})
test('a genuine auction delegate bound to another ledger fails authentication', async () => {
	const fixture = capitalClient()
	fixture.setRead('ledger', modules.engine, modules.auctionDelegate)
	await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow('capital auction delegate belongs to another authority')
})
test('setup and account authentication reject an unrecognized future auction deployer', async () => {
	const fixture = capitalClient()
	fixture.setRead('auctionDeployer', modules.engine)
	await expect(loadPortfolioSetup(fixture.client, portfolio, owner)).rejects.toThrow('unrecognized auction deployer')
	await expect(loadPortfolioAccount(fixture.client, portfolio, owner, 0n)).rejects.toThrow('unrecognized auction deployer')
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

test('setup readiness includes the separate fourth price-feed stage and rejects out-of-range stages', async () => {
	const fixture = capitalClient()
	fixture.setSetupStage(3n)
	expect((await loadPortfolioSetup(fixture.client, portfolio, owner)).stage).toBe(3)
	fixture.setSetupStage(4n)
	expect((await loadPortfolioSetup(fixture.client, portfolio, owner)).stage).toBe(4)
	fixture.setSetupStage(5n)
	await expect(loadPortfolioSetup(fixture.client, portfolio, owner)).rejects.toThrow('Invalid portfolio setup stage')
})
