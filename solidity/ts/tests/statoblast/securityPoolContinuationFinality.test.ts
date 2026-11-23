import { collateralBalance } from './burnEvidence'
import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	Zoltar_Zoltar as zoltarArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as coordinatorArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
} from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: inherited activation delay and finality', () => {
	const fixture = useSecurityPoolFixture({})
	test('an activation-boundary lead flip keeps reporter and settlement finality on the curve deadline', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const owner = fixture.owner(),
			base = fixture.base
		const pool = fixture.poolFor(base.questionId).questionLedger
		const p = { abi: securityPoolArtifact.abi, address: fixture.securityPool }
		const bond = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'initialEscalationGameDepositAttoRep' })
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), pool)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [1, bond] }))
		const game = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
		const activation = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'activationTime' })
		await base.mockWindow.setTime(activation - 1n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [2, 2n * bond] }))
		expect((await owner.getBlock()).timestamp).toBe(activation)
		const end = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		// The flip restarts no response period: the deadline is the curve crossing of the start-bond median.
		expect(end).toBeLessThan(activation + 3n * DAY)
		expect(end).toBe(activation + (await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'computeTimeSinceStartFromAttritionCostAttoRep', args: [bond + 1n] })) - 1n)
		const engine = await owner.readContract({ ...p, functionName: 'settlement' })
		const book = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [base.genesisUniverse] })
		const [question] = await owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, base.questionId] })
		const ledger = await owner.readContract({ ...p, functionName: 'reporterLedger', args: [base.genesisUniverse] })
		const [reporter] = await owner.readContract({ abi: reporterArtifact.abi, address: ledger, functionName: 'question', args: [base.genesisUniverse, base.questionId] })
		expect(reporter.finalAfter).toBe(question.finalAfter)
		expect(await owner.readContract({ ...p, functionName: 'nativeTimeForSecurityPoolTime', args: [base.genesisUniverse, question.finalAfter] })).toBe(end)
	})

	const cases = [
		{ name: 'pending activation', forkOffset: -2n * DAY, materializationOffset: undefined },
		{ name: 'early initialization', forkOffset: -2n * DAY, materializationOffset: -3n * DAY },
		{ name: 'reported disagreement window', forkOffset: -2n * DAY, materializationOffset: -DAY },
		{ name: 'already final initialization', forkOffset: -2n * DAY, materializationOffset: DAY },
		{ name: 'fork at activation', forkOffset: 0n, materializationOffset: -DAY },
		{ name: 'fork after activation', forkOffset: DAY, materializationOffset: -DAY },
	]
	test.each(cases)('$name preserves the inherited deadline and shareholder exits', async ({ forkOffset, materializationOffset }) => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const owner = fixture.owner(),
			trader = fixture.other(),
			base = fixture.base
		const p = { abi: securityPoolArtifact.abi, address: fixture.securityPool }
		const source = fixture.poolFor(base.questionId).questionLedger
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), source)
		for (const [outcome, amount] of [
			[1, 100n * unit],
			[2, 70n * unit],
		] as const)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: source, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
		const sourceGame = await owner.readContract({ abi: poolArtifact.abi, address: source, functionName: 'escalationGame' })
		const activation = await owner.readContract({ abi: gameArtifact.abi, address: sourceGame, functionName: 'activationTime' })
		const sourceEnd = await owner.readContract({ abi: gameArtifact.abi, address: sourceGame, functionName: 'getEscalationGameEndDate' })
		const unrelated = { ...base.questionData, title: 'Unrelated first fork reproducer' }
		await createQuestion(owner, unrelated, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		// Transactions mine one second after setTime, including the exact-activation case.
		await base.mockWindow.setTime(activation + forkOffset - 1n)
		await forkUniverse(owner, base.genesisUniverse, getQuestionId(unrelated, base.outcomes))
		await addRepToMigrationBalance(owner, base.genesisUniverse, 1_000_000n * unit)
		await splitMigrationRep(owner, base.genesisUniverse, 1_000_000n * unit, [1n])
		const firstFork = (await getUniverseData(owner, base.genesisUniverse)).forkTime
		expect(firstFork).toBe(activation + forkOffset)
		const coordinator = { abi: coordinatorArtifact.abi, address: await owner.readContract({ ...p, functionName: 'forkController' }) }
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'choose', args: [base.genesisUniverse, 1n] }))
		const child = getChildUniverseId(base.genesisUniverse, 1),
			earliestActivation = firstFork + 63n * DAY
		await base.mockWindow.setTime(earliestActivation)
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [child] }))
		const W = (await owner.getBlock()).timestamp
		const remaining = sourceEnd - firstFork
		const expectedEnd = W + remaining
		await base.mockWindow.setTime(materializationOffset === undefined ? W + 10n : expectedEnd + materializationOffset)
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker }
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'prepareSecurityPoolQuestion', args: [source, child] }))
		for (let i = 0; i < 3; i++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializeSecurityPoolQuestion', args: [source, child] }))
		const childPool = await owner.readContract({ ...p, functionName: 'getQuestionLedger', args: [base.questionId, child] })
		const game = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		const gameEnd = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		const resolution = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getFinalQuestionResolution' })
		const engine = await owner.readContract({ ...p, functionName: 'settlement' })
		const book = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [child] })
		const [question, frozen] = await owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, base.questionId] })
		const bookEnd = await owner.readContract({ ...p, functionName: 'nativeTimeForSecurityPoolTime', args: [child, question.finalAfter] })

		expect(gameEnd).toBe(bookEnd)
		expect(gameEnd).toBe(expectedEnd)
		expect(resolution).toBe((materializationOffset ?? 0n) > 0n ? 1n : 3n)
		expect(frozen !== 0n).toBe((materializationOffset ?? 0n) > 0n)
		const reporterLedger = await owner.readContract({ ...p, functionName: 'reporterLedger', args: [child] })
		const [reporter, reporterFinal] = await owner.readContract({ abi: reporterArtifact.abi, address: reporterLedger, functionName: 'question', args: [child, base.questionId] })
		expect(reporter.finalAfter).toBe(question.finalAfter)
		expect(reporterFinal).toBe((materializationOffset ?? 0n) > 0n)
		if (materializationOffset === undefined) {
			const elapsed = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'forkElapsedAtStart' })
			expect(elapsed).toBe(firstFork - activation)
			const cost = () => owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'totalCostAttoRep' })
			expect(await cost()).toBe(0n)
			await base.mockWindow.setTime(W - elapsed)
			expect(await cost()).toBe(0n)
			await base.mockWindow.advanceTime(1n)
			expect(await cost()).toBeGreaterThan(0n)
			await base.mockWindow.setTime(await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getEarliestForkTime', args: [child] }))
		}
		const shares = { abi: shareArtifact.abi, address: fixture.poolFor(base.questionId).shareToken }
		await writeContractAndWait(trader, () => trader.writeContract({ ...shares, functionName: 'migrate', args: [base.genesisUniverse * 256n + 1n, [1n]] }))
		const childBalance = await trader.readContract({ ...shares, functionName: 'balanceOf', args: [trader.account.address, child * 256n + 1n] })
		expect(childBalance).toBeGreaterThan(0n)
		const second = { ...base.questionData, title: 'Unrelated second fork reproducer' }
		await createQuestion(owner, second, base.outcomes)
		await base.mockWindow.advanceTime(3600n)
		await approveToken(owner, getRepTokenAddress(child), getZoltarAddress())
		await forkUniverse(owner, child, getQuestionId(second, base.outcomes))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'choose', args: [child, 1n] }))
		const secondFork = (await getUniverseData(owner, child)).forkTime
		if ((materializationOffset ?? 0n) > 0n) {
			expect(secondFork).toBeGreaterThan(gameEnd)
			await expect(trader.simulateContract({ ...shares, functionName: 'migrate', args: [child * 256n + 1n, [1n]] })).rejects.toThrow('ShareToken question finalized before fork')
			const cashBefore = await collateralBalance(owner, fixture.securityPool, engine)
			await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemShares' }))
			expect(await collateralBalance(owner, fixture.securityPool, engine)).toBeLessThan(cashBefore)
			expect(await trader.readContract({ ...shares, functionName: 'balanceOf', args: [trader.account.address, child * 256n + 1n] })).toBe(0n)
			return
		}
		expect(secondFork).toBeLessThan(gameEnd)
		expect(secondFork).toBeLessThan(bookEnd)
		await writeContractAndWait(trader, () => trader.writeContract({ ...forker, functionName: 'initiateQuestionLedgerFork', args: [childPool] }))
		const grandchild = getChildUniverseId(child, 1)
		await base.mockWindow.setTime(secondFork + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'startBranch', args: [child, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [grandchild] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'prepareSecurityPoolQuestion', args: [childPool, grandchild] }))
		for (let i = 0; i < 3; i++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializeSecurityPoolQuestion', args: [childPool, grandchild] }))
		await writeContractAndWait(trader, () => trader.writeContract({ ...shares, functionName: 'migrate', args: [child * 256n + 1n, [1n]] }))
		expect(await trader.readContract({ ...shares, functionName: 'balanceOf', args: [trader.account.address, grandchild * 256n + 1n] })).toBe(childBalance)
		const grandPool = await owner.readContract({ ...p, functionName: 'getQuestionLedger', args: [base.questionId, grandchild] })
		const grandGame = await owner.readContract({ abi: poolArtifact.abi, address: grandPool, functionName: 'escalationGame' })
		const grandEnd = await owner.readContract({ abi: gameArtifact.abi, address: grandGame, functionName: 'getEscalationGameEndDate' })
		// Leave room for the fixed-point attrition curve's inverse-rounding boundary.
		await base.mockWindow.setTime(grandEnd + DAY)
		await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: grandPool, functionName: 'redeemShares' }))
		expect(await trader.readContract({ ...shares, functionName: 'balanceOf', args: [trader.account.address, grandchild * 256n + 1n] })).toBe(0n)
	})
})
