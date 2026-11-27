import { describe, expect, test } from 'bun:test'
import { Zoltar_Zoltar as zoltarArtifact, statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as coordinatorArtifact, statoblast_SecurityPool_SecurityPool as securityPoolArtifact } from '../../types/contractArtifact'
import { approveToken, overrideGenesisTheoreticalSupply } from '../../testSupport/simulator/utils/utilities'
import { addRepToMigrationBalance, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { createE2E, median, NO, YES } from '../auditE2EHarness'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: a fixed outcome interrupted after delayed branch activation', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)

	test('#1661 early pool preparation reserves genesis admission before remaining capacity is consumed', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const owner = fixture.owner()
		const reporter = e2e.account(6)
		const universe = fixture.base.genesisUniverse
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await overrideGenesisTheoreticalSupply(fixture.base.mockWindow, owner, getRepTokenAddress(universe), 10_000n * unit)
		const fork = await e2e.forkOn(reporter, universe, fixture.base.questionId)
		const coordinator = { abi: coordinatorArtifact.abi, address: await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'forkController' }) }
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'prepareSourceMigration', args: [universe] }))
		const remaining = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getUniverseTheoreticalSupplyAttoRep', args: [universe] })
		await approveToken(reporter, getRepTokenAddress(universe), getZoltarAddress())
		await addRepToMigrationBalance(reporter, universe, remaining)
		await e2e.choose(owner, universe, YES)
		await fixture.base.mockWindow.setTime(fork + 70n * DAY)
		const child = await e2e.activateBranch(universe, YES)
		expect(await owner.readContract({ ...coordinator, functionName: 'isReady', args: [child] })).toBe(true)
	})

	test('#1651 empty fixed question stays final through an unrelated second fork', async () => {
		const owner = fixture.owner()
		const reporter = e2e.account(6)
		const source = fixture.poolFor(fixture.base.questionId).questionLedger
		await fixture.prepare()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		const fork = await e2e.forkOn(reporter, fixture.base.genesisUniverse, fixture.base.questionId)
		await e2e.choose(owner, fixture.base.genesisUniverse, YES)
		await fixture.base.mockWindow.setTime(fork + 70n * DAY)
		const child = await e2e.activateBranch(fixture.base.genesisUniverse, YES)
		const fixed = await e2e.materialize(source, child)
		await fixture.base.mockWindow.setTime((await e2e.activationTime(child)) + 3n * DAY + 1n)
		expect(
			await owner.readContract({
				...e2e.forker(),
				functionName: 'getQuestionOutcome',
				args: [fixed.pool],
			}),
		).toBe(BigInt(YES))
		await e2e.migrateWalletRep(reporter, fixture.base.genesisUniverse, 700_000n * unit, [YES])
		await e2e.forkOn(reporter, child, await e2e.unrelatedQuestion('Unrelated fork preserves empty fixed result'))
		await e2e.choose(owner, child, YES)
		const grandchild = await e2e.activateBranch(child, YES)
		const continued = await e2e.materialize(fixed.pool, grandchild)
		expect(await owner.readContract({ ...e2e.forker(), functionName: 'getQuestionOutcome', args: [continued.pool] })).toBe(BigInt(YES))
	})

	test.each([
		{ late: false, reports: true, sameQuestion: false },
		{ late: false, reports: true, sameQuestion: true },
		{ late: false, reports: false, sameQuestion: true },
		{ late: true, reports: true, sameQuestion: false },
		{ late: true, reports: false, sameQuestion: false },
	])('preserves the remaining fixed deadline through another fork (late: $late, reports: $reports, same question: $sameQuestion)', async ({ late, reports, sameQuestion }) => {
		const owner = fixture.owner()
		const reporter = e2e.account(6)
		const { base } = fixture
		const root = { abi: securityPoolArtifact.abi, address: fixture.securityPool }
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
		const fork1 = await e2e.forkOn(reporter, child, sameQuestion ? base.questionId : await e2e.unrelatedQuestion('Interrupt a fixed-outcome settlement delay'))
		expect(fork1).toBeLessThan(fixedEnd)
		await e2e.choose(owner, child, YES)
		const grandchild = await e2e.activateBranch(child, YES)
		const expectedEnd = (await e2e.activationTime(grandchild)) + fixedEnd - fork1
		const [settlementClaim] = await e2e.bookQuestion(grandchild, base.questionId)
		expect(await owner.readContract({ ...root, functionName: 'nativeTimeForSecurityPoolTime', args: [grandchild, settlementClaim.finalAfter] })).toBe(expectedEnd)
		if (reports) {
			const [reporterClaim] = await e2e.ledgerQuestion(grandchild, base.questionId)
			expect(await owner.readContract({ ...root, functionName: 'nativeTimeForSecurityPoolTime', args: [grandchild, reporterClaim.finalAfter] })).toBe(expectedEnd)
		}
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
