import { collateralBalance } from './burnEvidence'
import { describe, expect, test } from 'bun:test'
import { parseAbi } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: native finalized portfolio redemptions', () => {
	const fixture = useSecurityPoolPortfolioFixture({})
	const pool = () => ({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool })
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const shares = () => balanceOfShares(fixture.other(), fixture.poolFor(fixture.base.questionId).shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
	const refresh = () => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'refreshPortfolioFees' }))
	const settlementState = async () => {
		const client = fixture.owner()
		const engine = await client.readContract({ ...portfolio(), functionName: 'settlement' })
		const book = await client.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await client.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		const [question, frozenBookId] = await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] })
		return { engine, book, bookId, question, frozenBookId }
	}
	const prepareReportedQuestion = async (additional: readonly bigint[] = []) => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.mint(20n * unit, fixture.secondQuestionId)
		for (const questionId of additional) await fixture.mint(unit, questionId)
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), pool().address)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...pool(), functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const game = await fixture.owner().readContract({ ...pool(), functionName: 'escalationGame' })
		return fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
	}
	const secondCash = () => fixture.owner().readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [fixture.poolFor(fixture.secondQuestionId).securityPool, 20n * unit] })
	const questionCash = async (questionId: bigint) => {
		const state = await settlementState()
		const [question] = await fixture.owner().readContract({ abi: bookArtifact.abi, address: state.book, functionName: 'question', args: [state.bookId, questionId] })
		return fixture.owner().readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [fixture.poolFor(questionId).securityPool, question.outcomeSupplyAttoShares] })
	}

	test.each([false, true])('a question finalized before another question forks cannot detach recovery rights (checkpointed: %s)', async checkpointed => {
		const deadline = await prepareReportedQuestion()
		await fixture.base.mockWindow.setTime(deadline + 1n)
		if (checkpointed) await refresh()
		expect((await settlementState()).frozenBookId !== 0n).toBe(checkpointed)
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await fixture.base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, fixture.secondQuestionId)
		const controller = await fixture.owner().readContract({ ...portfolio(), functionName: 'forkController' })
		const hash = await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'freeze', args: [fixture.base.genesisUniverse] }))
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ alreadyFinalized: checkpointed, forkFreezeGas: (await fixture.other().getTransactionReceipt({ hash })).gasUsed })
		const target = { abi: shareArtifact.abi, address: fixture.poolFor(fixture.base.questionId).shareToken }
		await expect(writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...target, functionName: 'transferPortfolioRecoveryRights', args: [fixture.base.genesisUniverse, fixture.owner().account.address, [0n, 1n, 0n]] }))).rejects.toThrow('No live source recovery right')
		expect(await fixture.other().readContract({ ...target, functionName: 'balanceOfPortfolioRecoveryRights', args: [fixture.base.genesisUniverse, fixture.other().account.address] })).toEqual([0n, 0n, 0n])
		const protectedBalances = await shares()
		const forkTime = (await getUniverseData(fixture.owner(), fixture.base.genesisUniverse)).forkTime
		for (const timestamp of [await fixture.base.mockWindow.getTime(), forkTime + 56n * DAY - 1n, forkTime + 63n * DAY]) {
			await fixture.base.mockWindow.setTime(timestamp)
			for (const outcome of [0n, 1n, 2n]) {
				await expect(fixture.other().writeContract({ ...target, functionName: 'migrate', args: [fixture.base.genesisUniverse * 256n + outcome, [1n]] })).rejects.toThrow('ShareToken question finalized before fork')
			}
			expect(await shares()).toEqual(protectedBalances)
		}
		const before = await settlementState()
		const cash = await collateralBalance(fixture.owner(), fixture.portfolio, before.engine)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemShares' }))
		expect((await shares())[1]).toBe(0n)
		expect(await collateralBalance(fixture.owner(), fixture.portfolio, before.engine)).toBeLessThan(cash)
	})

	test.each([0, 8])('a permissionless question checkpoint reserves only that question with %i other populated deadlines', async additionalCount => {
		const owner = fixture.owner()
		const additional = []
		for (let index = 1; index <= additionalCount; index++) {
			const end = fixture.base.questionData.endTime + BigInt(index) * DAY
			const data = makeQuestion(`Additional deadline ${index}`, end)
			const id = getQuestionId(data, fixture.base.outcomes)
			await createQuestion(owner, data, fixture.base.outcomes)
			await fixture.register(id)
			additional.push({ end, id })
		}
		const firstDeadline = await prepareReportedQuestion(additional.map(question => question.id))
		for (const question of additional) {
			const address = fixture.poolFor(question.id).securityPool
			await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), address)
			await fixture.base.mockWindow.setTime(question.end + 1n)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		}
		const secondPool = fixture.poolFor(fixture.secondQuestionId).securityPool
		const second = { abi: poolArtifact.abi, address: secondPool }
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), secondPool)
		await fixture.base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await writeContractAndWait(owner, () => owner.writeContract({ ...second, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const secondGame = await owner.readContract({ ...second, functionName: 'escalationGame' })
		const secondDeadline = await owner.readContract({ abi: gameArtifact.abi, address: secondGame, functionName: 'getEscalationGameEndDate' })
		// Leave the second claim pending in the dense fixture so the fork
		// actually splits the schedule instead of taking the entire prefix.
		const cutoff = additionalCount === 0 ? secondDeadline + 1n : secondDeadline - 60n
		expect(cutoff).toBeGreaterThan(firstDeadline)
		await fixture.base.mockWindow.setTime(cutoff)

		const state = await settlementState()
		const secondFrozenId = async () => (await owner.readContract({ abi: bookArtifact.abi, address: state.book, functionName: 'question', args: [state.bookId, fixture.secondQuestionId] }))[1]
		expect(state.frozenBookId).toBe(0n)
		expect(await secondFrozenId()).toBe(0n)
		const keeper = fixture.other()
		const hash = await writeContractAndWait(keeper, () => keeper.writeContract({ ...pool(), functionName: 'updateSettlementCollateral' }))
		const gas = (await keeper.getTransactionReceipt({ hash })).gasUsed
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ additionalCount, finalizeOneQuestionGas: gas })
		expect(gas).toBeLessThan(1_500_000n)
		const firstFrozenId = (await settlementState()).frozenBookId
		expect(firstFrozenId).not.toBe(0n)
		expect(await secondFrozenId()).toBe(0n)
		await writeContractAndWait(keeper, () => keeper.writeContract({ ...pool(), functionName: 'updateSettlementCollateral' }))
		expect((await settlementState()).frozenBookId).toBe(firstFrozenId)
		expect(await secondFrozenId()).toBe(0n)
		const genesis = fixture.base.genesisUniverse
		await approveToken(owner, getRepTokenAddress(genesis), getZoltarAddress())
		await forkUniverse(owner, genesis, fixture.secondQuestionId)
		const controller = await owner.readContract({ ...portfolio(), functionName: 'forkController' })
		const freezeHash = await writeContractAndWait(keeper, () => keeper.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'freeze', args: [genesis] }))
		const forkFreezeGas = (await keeper.getTransactionReceipt({ hash: freezeHash })).gasUsed
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ additionalCount, forkFreezeGas })
		expect(forkFreezeGas).toBeLessThan(1_200_000n)
		expect((await secondFrozenId()) === 0n).toBe(additionalCount !== 0)
		for (const { id } of additional) {
			const [, frozenBookId] = await owner.readContract({ abi: bookArtifact.abi, address: state.book, functionName: 'question', args: [state.bookId, id] })
			expect(frozenBookId).not.toBe(0n)
		}
	})

	test('fork, first child report and repair fit their budgets with settlement, fee and reporter schedules populated together', async () => {
		const owner = fixture.owner()
		const donor = fixture.other()
		const { genesisUniverse, mockWindow, outcomes, questionData } = fixture.base
		const forkQuestion = fixture.secondQuestionId
		const forkAt = fixture.secondEndTime + 1n
		const engine = await owner.readContract({ ...portfolio(), functionName: 'settlement' })
		const ledger = { abi: bookArtifact.abi, address: await owner.readContract({ address: engine, abi: settlementArtifact.abi, functionName: 'ledger' }) }
		const reporters = { abi: reporterArtifact.abi, address: await owner.readContract({ ...portfolio(), functionName: 'reporters' }) }
		const forks = { abi: coordinatorArtifact.abi, address: await owner.readContract({ ...portfolio(), functionName: 'forkController' }) }
		const rep = getRepTokenAddress(genesisUniverse)
		const bookId = (universeId: bigint) => owner.readContract({ address: engine, abi: settlementArtifact.abi, functionName: 'bookIds', args: [universeId] })
		const parentBook = await bookId(genesisUniverse)
		const register = async (title: string, end: bigint) => {
			const data = makeQuestion(title, end)
			const id = getQuestionId(data, outcomes)
			await createQuestion(owner, data, outcomes)
			await fixture.register(id)
			return id
		}
		const reported = []
		const streams = []
		for (let index = 0n; index < 24n; index++) {
			const end = forkAt - DAY + index * 3_600n
			reported.push({ id: await register(`Combined gas report ${index}`, end), end })
			const streamEnd = index === 0n ? forkAt + 3n * DAY : forkAt + 100n * DAY + index * DAY
			streams.push(await register(`Combined gas fee stream ${index}`, streamEnd))
		}
		await fixture.prepare()
		await writeContractAndWait(owner, () => owner.writeContract({ address: rep, abi: tokenArtifact.abi, functionName: 'transfer', args: [donor.account.address, 5n * unit] }))
		await fixture.deposit(5n * unit, donor)
		await fixture.authorize(unit, donor)
		await fixture.mint(unit, forkQuestion)
		await fixture.mint(unit, fixture.base.questionId)
		for (const { id } of reported) await fixture.mint(unit, id)
		for (const [index, id] of streams.entries()) {
			await mockWindow.setTime(questionData.endTime + BigInt(index) * 3n * DAY)
			await fixture.refreshPrice()
			await fixture.mint(unit, id)
		}
		const feeEnds = new Set<bigint>()
		for (const id of streams) {
			const [state] = await owner.readContract({ ...ledger, functionName: 'scaledQuestion', args: [parentBook, id] })
			expect(BigInt(state.feeEnd)).toBeGreaterThan(forkAt)
			expect(state.feeRateAttoEthPerSecond).toBeGreaterThan(0n)
			feeEnds.add(BigInt(state.feeEnd))
		}
		expect(feeEnds.size).toBe(streams.length)
		expect([...feeEnds].some(end => end > forkAt + 64n * DAY)).toBe(true)
		await approveToken(owner, rep, pool().address)
		await writeContractAndWait(owner, () => owner.writeContract({ ...pool(), functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const settlementDeadlines = new Set()
		const reporterDeadlines = new Set()
		for (const { id, end } of reported) {
			const address = fixture.poolFor(id).securityPool
			await approveToken(owner, rep, address)
			await mockWindow.setTime(end + 1n)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
			const [settlement] = await owner.readContract({ ...ledger, functionName: 'scaledQuestion', args: [parentBook, id] })
			const [reporter] = await owner.readContract({ ...reporters, functionName: 'question', args: [genesisUniverse, id] })
			expect(BigInt(settlement.finalAfter)).toBeGreaterThan(forkAt)
			expect(reporter.balanceAttoRep).toBeGreaterThan(0n)
			settlementDeadlines.add(settlement.finalAfter)
			reporterDeadlines.add(reporter.finalAfter)
		}
		expect(settlementDeadlines.size).toBe(reported.length)
		expect(reporterDeadlines.size).toBe(reported.length)
		await approveToken(owner, rep, getZoltarAddress())
		await mockWindow.setTime(forkAt - 650n)
		await fixture.refreshPrice()
		const purchaseTarget = streams.at(-1)
		if (purchaseTarget === undefined) throw new Error('Missing fee stream for the populated purchase')
		const purchaseHash = await fixture.mint(unit, purchaseTarget)
		expect((await owner.getTransactionReceipt({ hash: purchaseHash })).gasUsed).toBeLessThan(8_000_000n)
		const feePool = fixture.poolFor(purchaseTarget).securityPool
		const refreshHash = await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: feePool, functionName: 'refreshPortfolioFees', gas: 6_000_000n }))
		await mockWindow.setTime(forkAt)
		const capitalAbi = parseAbi(['function isPriceValid() view returns (bool)'])
		expect(await owner.readContract({ address: fixture.capitalLedger, abi: capitalAbi, functionName: 'isPriceValid' })).toBe(true)
		await forkUniverse(owner, genesisUniverse, forkQuestion)
		const { forkTime } = await getUniverseData(owner, genesisUniverse)
		const freezeHash = await writeContractAndWait(owner, () => owner.writeContract({ ...forks, functionName: 'freeze', args: [genesisUniverse], gas: 1_500_000n }))
		expect((await settlementState()).frozenBookId).not.toBe(0n)
		await writeContractAndWait(owner, () => owner.writeContract({ ...forks, functionName: 'choose', args: [genesisUniverse, 1n] }))
		const child = getChildUniverseId(genesisUniverse, 1)
		await mockWindow.setTime(forkTime + 56n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ ...forks, functionName: 'startBranch', args: [genesisUniverse, 1n] }))
		const priceFeedHash = await writeContractAndWait(owner, () => owner.writeContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'preparePortfolioPriceFeed', args: [pool().address, child], gas: 9_000_000n }))
		await mockWindow.setTime(forkTime + 63n * DAY)
		const activateHash = await writeContractAndWait(owner, () => owner.writeContract({ ...forks, functionName: 'finalizeBranch', args: [child], gas: 4_000_000n }))
		const childBook = await bookId(child)
		const reportTarget = streams[0]
		if (reportTarget === undefined) throw new Error('Missing child report target')
		await addRepToMigrationBalance(owner, genesisUniverse, 1_000n * unit)
		await splitMigrationRep(owner, genesisUniverse, 1_000n * unit, [1])
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker }
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializePortfolioQuestion', args: [fixture.poolFor(reportTarget).securityPool, child] }))
		const childPool = await owner.readContract({ ...portfolio(), functionName: 'getPool', args: [reportTarget, child] })
		await approveToken(owner, getRepTokenAddress(child), childPool)
		const beforeReport = await owner.readContract({ ...ledger, functionName: 'scaledQuestion', args: [childBook, reportTarget] })
		expect(BigInt(beforeReport[0].finalAfter)).toBe(0n)
		expect(beforeReport[1]).toBe(0n)
		const reportHash = await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit], gas: 14_000_000n }))
		const [firstReport] = await owner.readContract({ ...ledger, functionName: 'scaledQuestion', args: [childBook, reportTarget] })
		const services = await owner.readContract({ ...portfolio(), functionName: 'services' })
		const [premiumUnits] = await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'questionPremium', args: [child, reportTarget] })
		expect(premiumUnits).toBeGreaterThan(0n)
		const childGame = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		const activation = await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'activationTime' })
		await mockWindow.setTime(activation - 1n)
		const disputeHash = await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'depositWalletRepToEscalationGame', args: [2, 200n * unit], gas: 10_000_000n }))
		const [childQuestion] = await owner.readContract({ ...ledger, functionName: 'scaledQuestion', args: [childBook, reportTarget] })
		const [childReporter] = await owner.readContract({ ...reporters, functionName: 'question', args: [child, reportTarget] })
		expect(childQuestion.finalAfter).toBeGreaterThan(firstReport.finalAfter)
		expect(childReporter.finalAfter).toBe(childQuestion.finalAfter)
		const disputeEnd = await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'getEscalationGameEndDate' })
		await mockWindow.setTime(disputeEnd + 1n)
		expect(BigInt(childQuestion.finalAfter)).toBeLessThan(BigInt(await owner.readContract({ ...portfolio(), functionName: 'portfolioTime', args: [child] })))
		const [cash] = await owner.readContract({ ...ledger, functionName: 'totals', args: [childBook] })
		const deficit = (await owner.readContract({ ...ledger, functionName: 'requiredCash', args: [childBook] })) - cash
		expect(deficit).toBeGreaterThan(0n)
		const collateral = await owner.readContract({ ...portfolio(), functionName: 'collateralToken' })
		await approveToken(donor, collateral, engine)
		const repairAbi = parseAbi(['function topUp(uint248 universeId, uint256 maximumCashAttoEth) returns (uint256)'])
		const repairHash = await writeContractAndWait(donor, () => donor.writeContract({ abi: repairAbi, address: engine, functionName: 'topUp', args: [child, deficit], gas: 1_500_000n }))
		expect(await owner.readContract({ ...ledger, functionName: 'isCashFunded', args: [childBook] })).toBe(true)
		const [, frozenChildClaim] = await owner.readContract({ ...ledger, functionName: 'scaledQuestion', args: [childBook, reportTarget] })
		expect(frozenChildClaim).not.toBe(0n)
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') {
			const [purchase, refresh, freeze, priceFeed, activate, report, dispute, repair] = await Promise.all([purchaseHash, refreshHash, freezeHash, priceFeedHash, activateHash, reportHash, disputeHash, repairHash].map(hash => owner.getTransactionReceipt({ hash })))
			console.log({
				combinedPurchaseGas: purchase?.gasUsed,
				combinedFeeRefreshGas: refresh?.gasUsed,
				combinedForkFreezeGas: freeze?.gasUsed,
				combinedPriceFeedGas: priceFeed?.gasUsed,
				combinedBranchActivationGas: activate?.gasUsed,
				combinedChildReportGas: report?.gasUsed,
				combinedChildDisputeGas: dispute?.gasUsed,
				combinedCollateralRepairGas: repair?.gasUsed,
			})
		}
	})

	test('winning shares redeem after the strict finality boundary without a prior question checkpoint', async () => {
		const deadline = await prepareReportedQuestion()
		await fixture.base.mockWindow.setTime(deadline)
		await expect(fixture.other().simulateContract({ ...pool(), functionName: 'redeemShares' })).rejects.toThrow('Question not final')
		await fixture.base.mockWindow.setTime(deadline + 1n)
		const beforeShares = await shares()
		const expectedCash = await fixture.other().readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [pool().address, beforeShares[1]] })
		const otherCash = await secondCash()
		const before = await settlementState()
		const custodyBefore = await collateralBalance(fixture.other(), fixture.portfolio, before.engine)
		const unquotedCash = custodyBefore - expectedCash - otherCash
		// Two floor-rounded net-cash quotes and the pending sub-unit cash fee can leave up to two raw units.
		expect(unquotedCash).toBeGreaterThanOrEqual(0n)
		expect(unquotedCash).toBeLessThanOrEqual(2n)
		const balance = await collateralBalance(fixture.other(), fixture.portfolio, fixture.other().account.address)
		const hash = await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemShares' }))
		const receipt = await fixture.other().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Redemption receipt must include its effective gas price')
		expect(await collateralBalance(fixture.other(), fixture.portfolio, fixture.other().account.address)).toBe(balance + expectedCash)
		expect(await shares()).toEqual([beforeShares[0], 0n, beforeShares[2]])
		const state = await settlementState()
		expect(state.frozenBookId).not.toBe(0n)
		expect(state.question.outcomeSupplyAttoShares).toBe(0n)
		expect(state.question.feeRateAttoEthPerSecond).toBe(0n)
		// The final live question receives the exact unquoted custody residual, including the fractional fee carry.
		const settledOtherCash = await secondCash()
		expect(settledOtherCash - otherCash).toBe(unquotedCash)
		expect(await collateralBalance(fixture.other(), fixture.portfolio, state.engine)).toBe(custodyBefore - expectedCash)
		expect(await collateralBalance(fixture.owner(), fixture.portfolio, state.engine)).toBe((await questionCash(fixture.base.questionId)) + (await questionCash(fixture.secondQuestionId)))
		await refresh()
		await refresh()
		expect(await secondCash()).toBe(settledOtherCash)
		expect((await settlementState()).question.outcomeSupplyAttoShares).toBe(0n)
		expect(await collateralBalance(fixture.owner(), fixture.portfolio, state.engine)).toBe(await questionCash(fixture.secondQuestionId))
		const secondPool = fixture.poolFor(fixture.secondQuestionId)
		const remainingShares = await balanceOfShares(fixture.other(), secondPool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		const beforeFinalPayout = await collateralBalance(fixture.other(), fixture.portfolio, fixture.other().account.address)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: secondPool.securityPool, functionName: 'redeemCompleteSet', args: [remainingShares[0]] }))
		expect(await collateralBalance(fixture.other(), fixture.portfolio, fixture.other().account.address)).toBe(beforeFinalPayout + settledOtherCash)
		expect(await collateralBalance(fixture.other(), fixture.portfolio, fixture.other().account.address)).toBe(balance + custodyBefore)
		expect(await collateralBalance(fixture.owner(), fixture.portfolio, state.engine)).toBe(0n)
		expect(await questionCash(fixture.base.questionId)).toBe(0n)
		expect(await questionCash(fixture.secondQuestionId)).toBe(0n)
	})

	test('partial complete-set return and the remaining winner preserve the frozen cash rate and other questions', async () => {
		const deadline = await prepareReportedQuestion()
		await fixture.base.mockWindow.setTime(deadline + 1n)
		await refresh()
		const before = await settlementState()
		const beforeShares = await shares()
		const otherCash = await secondCash()
		const amount = beforeShares[0] / 3n
		const expectedCash = await fixture.other().readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [pool().address, amount] })
		const balance = await collateralBalance(fixture.owner(), fixture.portfolio, before.engine)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemCompleteSet', args: [amount] }))
		expect(await shares()).toEqual([beforeShares[0] - amount, beforeShares[1] - amount, beforeShares[2] - amount])
		expect(await collateralBalance(fixture.owner(), fixture.portfolio, before.engine)).toBe(balance - expectedCash)
		const after = await settlementState()
		expect(after.frozenBookId).toBe(before.frozenBookId)
		expect(after.question.feeRateAttoEthPerSecond).toBe(0n)
		expect(after.question.outcomeSupplyAttoShares).toBe(before.question.outcomeSupplyAttoShares - amount)
		await fixture.base.mockWindow.advanceTime(86_400n)
		await refresh()
		expect((await settlementState()).question).toEqual(after.question)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemShares' }))
		expect(await secondCash()).toBe(otherCash)
		expect(await collateralBalance(fixture.owner(), fixture.portfolio, before.engine)).toBe((await questionCash(fixture.base.questionId)) + (await questionCash(fixture.secondQuestionId)))
	})

	test('a later fork leaves final cash at its source and rejects a duplicate child claim', async () => {
		await prepareReportedQuestion()
		const owner = fixture.owner()
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await fixture.base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await forkUniverse(owner, fixture.base.genesisUniverse, fixture.secondQuestionId)
		const controller = await owner.readContract({ ...portfolio(), functionName: 'forkController' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'choose', args: [fixture.base.genesisUniverse, 1n] }))
		const forkTime = (await getUniverseData(owner, fixture.base.genesisUniverse)).forkTime
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(fixture.base.genesisUniverse, 1)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'finalizeBranch', args: [child] }))
		await expect(writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'preparePortfolioQuestion', args: [pool().address, child] }))).rejects.toThrow('Question finalized in source universe')
		await expect(owner.readContract({ ...portfolio(), functionName: 'getPool', args: [fixture.base.questionId, child] })).rejects.toThrow('Question pool unavailable')
		await refresh()
		const state = await settlementState()
		const beforeShares = await shares()
		const expectedCash = await owner.readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [pool().address, beforeShares[1]] })
		expect(expectedCash).toBeGreaterThan(0n)
		const balance = await collateralBalance(owner, fixture.portfolio, state.engine)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemShares' }))
		expect(await collateralBalance(owner, fixture.portfolio, state.engine)).toBe(balance - expectedCash)
		expect((await shares())[1]).toBe(0n)
		await refresh()
		const final = await settlementState()
		expect(final.question.outcomeSupplyAttoShares).toBe(0n)
	})
})
