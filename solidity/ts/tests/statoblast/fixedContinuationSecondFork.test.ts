import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { createE2E, median, NO, YES } from '../auditE2EHarness'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: a fixed outcome interrupted after delayed branch activation', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)

	test.each([
		{ late: false, reports: true },
		{ late: true, reports: true },
		{ late: true, reports: false },
	])('preserves the remaining fixed deadline through another fork (late: $late, reports: $reports)', async ({ late, reports }) => {
		const owner = fixture.owner()
		const reporter = e2e.account(6)
		const { base } = fixture
		const root = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const source = fixture.poolFor(base.questionId).questionLedger
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		if (reports) {
			await e2e.deposit(owner, source, YES, 150n * unit)
			await e2e.deposit(reporter, source, NO, 100n * unit)
		}
		const originGame = reports ? await e2e.gameOf(source) : undefined
		const balances = originGame === undefined ? undefined : await e2e.balances(originGame)
		const fork0 = await e2e.forkOn(reporter, base.genesisUniverse, base.questionId)
		await e2e.choose(owner, base.genesisUniverse, YES)
		// This branch activates after its native child-fork cooldown already expired.
		await base.mockWindow.setTime(fork0 + 70n * DAY)
		const child = await e2e.activateBranch(base.genesisUniverse, YES)
		const fixed = await e2e.materialize(source, child)
		const fixedEnd = (await e2e.activationTime(child)) + 3n * DAY
		if (reports) expect(await owner.readContract({ ...e2e.game(fixed.game), functionName: 'getEscalationGameEndDate' })).toBe(fixedEnd)
		await e2e.migrateWalletRep(reporter, base.genesisUniverse, 700_000n * unit, [YES])
		await base.mockWindow.setTime((await e2e.activationTime(child)) + DAY)
		const fork1 = await e2e.forkOn(reporter, child, await e2e.unrelatedQuestion('Interrupt a fixed-outcome settlement delay'))
		expect(fork1).toBeLessThan(fixedEnd)
		await e2e.choose(owner, child, YES)
		const grandchild = await e2e.activateBranch(child, YES)
		const expectedEnd = (await e2e.activationTime(grandchild)) + fixedEnd - fork1
		const [inherited] = reports ? await e2e.ledgerQuestion(grandchild, base.questionId) : await e2e.bookQuestion(grandchild, base.questionId)
		expect(await owner.readContract({ ...root, functionName: 'nativeTimeForPortfolioTime', args: [grandchild, inherited.finalAfter] })).toBe(expectedEnd)
		if (late) await base.mockWindow.setTime(expectedEnd + 1n)
		const continued = await e2e.materialize(fixed.pool, grandchild)
		if (reports) expect(await owner.readContract({ ...e2e.game(continued.game), functionName: 'getEscalationGameEndDate' })).toBe(expectedEnd)
		if (!late) await base.mockWindow.setTime(expectedEnd + 1n)
		expect(await owner.readContract({ ...e2e.forker(), functionName: 'getQuestionOutcome', args: [continued.pool] })).toBe(BigInt(YES))
		if (originGame === undefined || balances === undefined) return
		const leaves = await e2e.lineageLeaves([originGame, fixed.game], YES)
		const settled = await e2e.claimEveryWinner(reporter, continued.pool, YES, leaves, median(balances), balances[YES])
		expect(settled.paid).toBeGreaterThan(150n * unit)
	})
})
