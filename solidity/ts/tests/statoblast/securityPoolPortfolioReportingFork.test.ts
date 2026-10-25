import { describe, expect, test } from 'bun:test'
import { parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId, requireAddress, requireArray, requireBigInt } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: native fork reporting reward ownership', () => {
	const fixture = useSecurityPoolPortfolioFixture({ reportingFeeAttoEth: unit / 100n })
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const sourcePool = () => fixture.poolFor(fixture.base.questionId).securityPool
	const services = async () => ({ abi: servicesArtifact.abi, address: await fixture.owner().readContract({ ...portfolio(), functionName: 'services' }) })
	const reward = async (pool: Address) => {
		const result = requireArray(await fixture.owner().readContract({ abi: parseAbi(['function quoteReportingReward(address pool) view returns(address recipient,uint256 cashAttoEth)']), address: (await services()).address, functionName: 'quoteReportingReward', args: [pool] }), 'Reporting reward quote')
		return { recipient: requireAddress(result[0], 'Reporting reward recipient'), cash: requireBigInt(result[1], 'Reporting reward cash') }
	}
	const settlement = async (universe: bigint) => {
		const owner = fixture.owner()
		const engine = await owner.readContract({ ...portfolio(), functionName: 'settlement' })
		const book = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [universe] })
		const [question] = await owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] })
		return { engine, book, bookId, question }
	}
	const prepareReport = async () => {
		await fixture.prepare()
		await fixture.deposit(1_000n * unit, fixture.other())
		await fixture.authorize(200n * unit, fixture.other())
		await fixture.mint()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		await approveToken(fixture.other(), getRepTokenAddress(fixture.base.genesisUniverse), sourcePool())
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const game = await fixture.owner().readContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'escalationGame' })
		const reporter = await fixture.owner().readContract({ ...(await services()), functionName: 'reportingBeneficiaries', args: [game] })
		expect(reporter[0].toLowerCase()).toBe(fixture.other().account.address.toLowerCase())
		return game
	}
	const activateUnrelatedFork = async (chosen: boolean, carryOutcomes = 3) => {
		const { base } = fixture
		const owner = fixture.owner()
		const other = fixture.other()
		const question = { ...base.questionData, title: 'Unrelated fork around a reporting reward' }
		await createQuestion(owner, question, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, base.genesisUniverse, getQuestionId(question, base.outcomes))
		const coordinator = await owner.readContract({ ...portfolio(), functionName: 'forkController' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, chosen ? 1n : 2n] }))
		await writeContractAndWait(other, () => other.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, 2n] }))
		const forkTime = (await getUniverseData(owner, base.genesisUniverse)).forkTime
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(base.genesisUniverse, 1)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [child] }))
		const forker = { abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker }
		await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'preparePortfolioQuestion', args: [sourcePool(), child] }))
		const childPool = await owner.readContract({ ...portfolio(), functionName: 'getPool', args: [base.questionId, child] })
		for (let outcome = 0; outcome < carryOutcomes; outcome++) await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializePortfolioQuestion', args: [sourcePool(), child] }))
		return { child, childPool }
	}
	const fundChildReporter = async (child: bigint, childPool: Address, price = unit) => {
		const owner = fixture.owner()
		await addRepToMigrationBalance(owner, fixture.base.genesisUniverse, 20_000n * unit)
		await splitMigrationRep(owner, fixture.base.genesisUniverse, 20_000n * unit, [1n])
		const coordinator = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'openOraclePriceCoordinator' })
		await manipulatePriceOracle(owner, fixture.base.mockWindow, coordinator, price, 100n * unit)
		const capital = await owner.readContract({ ...portfolio(), functionName: 'capitalLedger', args: [child] })
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'isPriceValid' })).toBe(true)
		await approveToken(owner, getRepTokenAddress(child), childPool)
	}

	test('an outsider cannot register an unfinished child game and overwrite its live reporter source', async () => {
		const sourceGame = await prepareReport()
		const { child, childPool } = await activateUnrelatedFork(true, 1)
		const owner = fixture.owner()
		const other = fixture.other()
		const childGame = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotOutcomesInitialized' })).toBe(1n)
		await expect(other.writeContract({ ...portfolio(), functionName: 'registerReporterGame', args: [childGame] })).rejects.toThrow('Reporter fork snapshot incomplete')
		expect(await owner.readContract({ ...portfolio(), functionName: 'sourceGame', args: [child, fixture.base.questionId] })).toBe(sourceGame)
		for (let outcome = 1; outcome < 3; outcome++) await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'materializePortfolioQuestion', args: [sourcePool(), child] }))
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotInitialized' })).toBe(true)
		expect(await owner.readContract({ ...portfolio(), functionName: 'sourceGame', args: [child, fixture.base.questionId] })).toBe(childGame)
	})

	test.each([
		{ chosen: true, redundantTopUp: false },
		{ chosen: false, redundantTopUp: false },
		{ chosen: true, redundantTopUp: true },
	])('inherited reporting cannot claim the child basket; chosen backing: $chosen, same-leader top-up: $redundantTopUp', async ({ chosen, redundantTopUp }) => {
		const game = await prepareReport()
		const sourceDeadline = await fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		const { child, childPool } = await activateUnrelatedFork(chosen)
		const owner = fixture.owner()
		const other = fixture.other()
		const service = await services()
		expect((await getUniverseData(owner, fixture.base.genesisUniverse)).forkTime).toBeLessThan(sourceDeadline)
		const childGame = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		expect(childGame).not.toBe(zeroAddress)
		expect(await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'getOutcomeBalancesAttoRep' })).toEqual([0n, 100n * unit, 0n])
		const reporter = await owner.readContract({ ...service, functionName: 'reportingBeneficiaries', args: [childGame] })
		expect(reporter[0]).toBe(zeroAddress)
		expect(reporter[2]).toBe(true)
		const capital = await owner.readContract({ ...portfolio(), functionName: 'capitalLedger', args: [child] })
		if (redundantTopUp) {
			await fundChildReporter(child, childPool)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
			expect((await owner.readContract({ ...service, functionName: 'reportingBeneficiaries', args: [childGame] }))[0]).toBe(zeroAddress)
		}
		const deadline = await owner.readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(deadline + 1n)
		if (!redundantTopUp) expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'priceValidUntil' })).toBe(0n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'refreshPortfolioFees' }))
		const state = await settlement(child)
		const cash = await owner.readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [childPool, state.question.rewardShares] })
		const rep = await owner.readContract({ ...portfolio(), functionName: 'quoteQuestionRecoveryRep', args: [childPool, state.question.rewardShares] })
		const token = { abi: tokenArtifact.abi, address: getRepTokenAddress(child) }
		expect(state.question.rewardShares).toBeGreaterThan(0n)
		expect(rep).toBeGreaterThan(0n)
		if (chosen) expect(cash).toBeGreaterThan(0n)
		else expect(cash).toBe(0n)
		expect(await reward(childPool)).toEqual({ recipient: service.address, cash })
		const before = {
			maintenance: await owner.readContract({ ...service, functionName: 'maintenanceReserveAttoEth', args: [child] }),
			serviceCash: await owner.getBalance({ address: service.address }),
			settlementCash: await owner.getBalance({ address: state.engine }),
			settlementRep: await owner.readContract({ ...token, functionName: 'balanceOf', args: [state.engine] }),
			totalRep: await owner.readContract({ ...token, functionName: 'totalSupply' }),
			theoreticalRep: await owner.readContract({ ...token, functionName: 'getTotalTheoreticalSupply' }),
			callerCash: await owner.getBalance({ address: owner.account.address }),
			reporterCash: await owner.getBalance({ address: other.account.address }),
			callerRep: await owner.readContract({ ...token, functionName: 'balanceOf', args: [owner.account.address] }),
			reporterRep: await owner.readContract({ ...token, functionName: 'balanceOf', args: [other.account.address] }),
		}
		const hash = await writeContractAndWait(owner, () => owner.writeContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [childPool] }))
		const receipt = await owner.waitForTransactionReceipt({ hash })
		expect(await owner.getBalance({ address: owner.account.address })).toBe(before.callerCash - receipt.gasUsed * requireBigInt(receipt.effectiveGasPrice, 'Claim effective gas price'))
		expect(await owner.getBalance({ address: other.account.address })).toBe(before.reporterCash)
		expect(await owner.readContract({ ...token, functionName: 'balanceOf', args: [owner.account.address] })).toBe(before.callerRep)
		expect(await owner.readContract({ ...token, functionName: 'balanceOf', args: [other.account.address] })).toBe(before.reporterRep)
		expect(await owner.getBalance({ address: state.engine })).toBe(before.settlementCash - cash)
		expect(await owner.getBalance({ address: service.address })).toBe(before.serviceCash + cash)
		expect(await owner.readContract({ ...service, functionName: 'maintenanceReserveAttoEth', args: [child] })).toBe(before.maintenance + cash)
		expect(await owner.readContract({ ...token, functionName: 'balanceOf', args: [state.engine] })).toBe(before.settlementRep - rep)
		expect(await owner.readContract({ ...token, functionName: 'balanceOf', args: [service.address] })).toBe(0n)
		expect(await owner.readContract({ ...token, functionName: 'totalSupply' })).toBe(before.totalRep - rep)
		expect(await owner.readContract({ ...token, functionName: 'getTotalTheoreticalSupply' })).toBe(before.theoreticalRep - rep)
		expect((await settlement(child)).question.rewardShares).toBe(0n)
		await expect(other.simulateContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [childPool] })).rejects.toThrow('Question reward already claimed')
	})

	test('a new child leader receives capped ETH while surplus cash and recovered REP stay out of its reward', async () => {
		await prepareReport()
		const { child, childPool } = await activateUnrelatedFork(true)
		const owner = fixture.owner()
		const other = fixture.other()
		await fundChildReporter(child, childPool, 100n * unit)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'depositWalletRepToEscalationGame', args: [2, 200n * unit] }))
		const game = await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		const deadline = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(deadline + 60n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'refreshPortfolioFees' }))
		const service = await services()
		const state = await settlement(child)
		const payout = await reward(childPool)
		const cash = await owner.readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [childPool, state.question.rewardShares] })
		const rep = await owner.readContract({ ...portfolio(), functionName: 'quoteQuestionRecoveryRep', args: [childPool, state.question.rewardShares] })
		expect(payout.recipient.toLowerCase()).toBe(owner.account.address.toLowerCase())
		expect(payout.cash).toBeGreaterThan(0n)
		expect(payout.cash).toBeLessThan(cash)
		expect(rep).toBeGreaterThan(0n)
		const token = { abi: tokenArtifact.abi, address: getRepTokenAddress(child) }
		const reporterCash = await owner.getBalance({ address: owner.account.address })
		const reporterRep = await owner.readContract({ ...token, functionName: 'balanceOf', args: [owner.account.address] })
		const callerCash = await owner.getBalance({ address: other.account.address })
		const serviceCash = await owner.getBalance({ address: service.address })
		const maintenance = await owner.readContract({ ...service, functionName: 'maintenanceReserveAttoEth', args: [child] })
		const settlementCash = await owner.getBalance({ address: state.engine })
		const settlementRep = await owner.readContract({ ...token, functionName: 'balanceOf', args: [state.engine] })
		const totalRep = await owner.readContract({ ...token, functionName: 'totalSupply' })
		const theoreticalRep = await owner.readContract({ ...token, functionName: 'getTotalTheoreticalSupply' })
		const hash = await writeContractAndWait(other, () => other.writeContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [childPool] }))
		const receipt = await owner.waitForTransactionReceipt({ hash })
		expect(await owner.getBalance({ address: owner.account.address })).toBe(reporterCash + payout.cash)
		expect(await owner.getBalance({ address: other.account.address })).toBe(callerCash - receipt.gasUsed * requireBigInt(receipt.effectiveGasPrice, 'Claim effective gas price'))
		expect(await owner.getBalance({ address: state.engine })).toBe(settlementCash - cash)
		expect(await owner.getBalance({ address: service.address })).toBe(serviceCash + cash - payout.cash)
		expect(await owner.readContract({ ...token, functionName: 'balanceOf', args: [owner.account.address] })).toBe(reporterRep)
		expect(await owner.readContract({ ...token, functionName: 'balanceOf', args: [state.engine] })).toBe(settlementRep - rep)
		expect(await owner.readContract({ ...token, functionName: 'balanceOf', args: [service.address] })).toBe(0n)
		expect(await owner.readContract({ ...token, functionName: 'totalSupply' })).toBe(totalRep - rep)
		expect(await owner.readContract({ ...token, functionName: 'getTotalTheoreticalSupply' })).toBe(theoreticalRep - rep)
		expect(await owner.readContract({ ...service, functionName: 'maintenanceReserveAttoEth', args: [child] })).toBe(maintenance + cash - payout.cash)
		expect((await settlement(child)).question.rewardShares).toBe(0n)
	})

	test('a report finalized before an unrelated fork keeps its one-time reward at the source', async () => {
		const game = await prepareReport()
		const owner = fixture.owner()
		const other = fixture.other()
		const deadline = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await fixture.base.mockWindow.setTime(deadline + 1n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: sourcePool(), functionName: 'refreshPortfolioFees' }))
		const sourceReward = await reward(sourcePool())
		const source = await settlement(fixture.base.genesisUniverse)
		expect(sourceReward.recipient.toLowerCase()).toBe(other.account.address.toLowerCase())
		expect(sourceReward.cash).toBeGreaterThan(0n)
		const { childPool } = await activateUnrelatedFork(true, 0)
		expect((await getUniverseData(owner, fixture.base.genesisUniverse)).forkTime).toBeGreaterThan(deadline)
		expect(await owner.readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [childPool, source.question.rewardShares] })).toBe(0n)
		await expect(other.simulateContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [childPool] })).rejects.toThrow('Question not final')
		expect(await reward(sourcePool())).toEqual(sourceReward)
		const reporterCash = await owner.getBalance({ address: other.account.address })
		const callerCash = await owner.getBalance({ address: owner.account.address })
		const settlementCash = await owner.getBalance({ address: source.engine })
		const hash = await writeContractAndWait(owner, () => owner.writeContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [sourcePool()] }))
		const receipt = await owner.waitForTransactionReceipt({ hash })
		expect(await owner.getBalance({ address: other.account.address })).toBe(reporterCash + sourceReward.cash)
		expect(await owner.getBalance({ address: owner.account.address })).toBe(callerCash - receipt.gasUsed * requireBigInt(receipt.effectiveGasPrice, 'Claim effective gas price'))
		expect(await owner.getBalance({ address: source.engine })).toBe(settlementCash - sourceReward.cash)
		expect((await settlement(fixture.base.genesisUniverse)).question.rewardShares).toBe(0n)
		await expect(other.simulateContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [sourcePool()] })).rejects.toThrow('Question reward already claimed')
	})
})
