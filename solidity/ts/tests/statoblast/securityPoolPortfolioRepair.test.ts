import { describe, expect, test } from 'bun:test'
import { parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, splitMigrationRep, getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { openOracleSettle, wrapWeth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'
import { collateralBalance } from './burnEvidence'

const repairAbi = parseAbi(['function topUp(uint248 universeId,uint256 cashAttoEth)'])
describe('Statoblast: permissionless settlement repair', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })

	test('#1247 a minimum non-chooser cannot leave a supported child permanently in runoff', async () => {
		const owner = fixture.owner()
		const other = fixture.other()
		const freshQuestion = makeQuestion('A fresh question in the repaired branch', fixture.secondEndTime)
		const freshQuestionId = getQuestionId(freshQuestion, fixture.base.outcomes)
		await createQuestion(owner, freshQuestion, fixture.base.outcomes)
		await fixture.register(freshQuestionId)
		await fixture.prepare()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(fixture.base.genesisUniverse), functionName: 'transfer', args: [other.account.address, 5n * unit] }))
		await fixture.deposit(5n * unit, other)
		const minimum = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'minimumCommitmentAttoEth' })
		await fixture.authorize(minimum, other)
		await fixture.mint(10n * unit, fixture.secondQuestionId)
		const { forks, forkTime, child } = await fixture.forkAndStartYesBranch()
		expect(await owner.readContract({ abi: forkArtifact.abi, address: forks, functionName: 'auctions', args: [child] })).toBe(zeroAddress)
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
		const settlement = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'settlement' })
		const ledger = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [child] })
		const book = { abi: bookArtifact.abi, address: ledger }
		const [cash, units] = await owner.readContract({ ...book, functionName: 'totals', args: [bookId] })
		const deficit = units - cash
		expect(deficit).toBeGreaterThan(0n)
		expect(deficit).toBeLessThan(minimum)
		const recovery = await owner.readContract({ ...book, functionName: 'recoveryRep', args: [bookId] })
		expect(recovery).toBeGreaterThan(0n)
		const rep = { abi: tokenArtifact.abi, address: getRepTokenAddress(child) }
		const supply = await owner.readContract({ ...rep, functionName: 'totalSupply' })
		const custody = await collateralBalance(owner, fixture.portfolio, settlement)
		const donor = await collateralBalance(owner, fixture.portfolio, other.account.address)
		const collateral = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'collateralToken' })
		await approveToken(other, collateral, settlement)
		for (const amount of [deficit - 1n, deficit + 1n]) await expect(other.writeContract({ abi: repairAbi, address: settlement, functionName: 'topUp', args: [child, amount] })).rejects.toThrow('Supply the entire settlement deficit')
		await writeContractAndWait(other, () => other.writeContract({ abi: repairAbi, address: settlement, functionName: 'topUp', args: [child, deficit] }))
		expect(await collateralBalance(owner, fixture.portfolio, settlement)).toBe(custody + deficit)
		expect(await collateralBalance(owner, fixture.portfolio, other.account.address)).toBe(donor - deficit)
		expect(await owner.readContract({ ...rep, functionName: 'totalSupply' })).toBe(supply)
		expect(await owner.readContract({ ...book, functionName: 'recoveryRep', args: [bookId] })).toBe(recovery)
		const capital = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'capitalLedger', args: [child] })
		await expect(owner.writeContract({ abi: parseAbi(['function recordSettlementRepair(uint256)']), address: capital, functionName: 'recordSettlementRepair', args: [units + 1n] })).rejects.toThrow('Only canonical settlement')
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'demandAttoEth' })).toBe(units)
		expect(await owner.readContract({ ...book, functionName: 'quoteMint', args: [bookId, fixture.secondQuestionId, unit] })).toBe(unit)
		const infrastructure = getInfraContractAddresses()
		const forker = { abi: forkerArtifact.abi, address: infrastructure.securityPoolForker }
		for (const questionId of [fixture.secondQuestionId, freshQuestionId]) await writeContractAndWait(owner, () => owner.writeContract({ ...forker, functionName: 'materializePortfolioQuestion', args: [fixture.poolFor(questionId).securityPool, child] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: factoryArtifact.abi, address: infrastructure.securityPoolFactory, functionName: 'preparePortfolioPriceFeed', args: [fixture.poolFor(fixture.secondQuestionId).securityPool, child] }))
		const feed = { abi: feedArtifact.abi, address: await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [child] }) }
		await addRepToMigrationBalance(owner, fixture.base.genesisUniverse, 100n * unit)
		await splitMigrationRep(owner, fixture.base.genesisUniverse, 100n * unit, [1])
		await wrapWeth(owner, 100n * unit)
		await approveToken(owner, collateral, feed.address)
		await approveToken(owner, rep.address, feed.address)
		const bounty = await owner.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		await writeContractAndWait(owner, () => owner.writeContract({ ...feed, functionName: 'requestPortfolioPrice', args: [unit, 10n * unit, bounty], value: bounty }))
		const reportId = await owner.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(owner, reportId)
		const services = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'services' })
		await approveToken(owner, collateral, services)
		const requiredRep = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'quoteMintRecoveryRep', args: [child, fixture.secondQuestionId, unit] })
		expect(requiredRep).toBeGreaterThan(0n)
		const oldClaim = await owner.readContract({ ...book, functionName: 'quoteRecoveryRep', args: [bookId, fixture.secondQuestionId, 10n * unit] })
		const ownerRep = () => owner.readContract({ ...rep, functionName: 'balanceOf', args: [owner.account.address] })
		const beforeRep = await ownerRep()
		expect(await owner.readContract({ ...rep, functionName: 'allowance', args: [owner.account.address, settlement] })).toBe(0n)
		const beforeCash = await collateralBalance(owner, fixture.portfolio, owner.account.address)
		const beforeBook = await owner.readContract({ ...book, functionName: 'totals', args: [bookId] })
		const buy = async (questionId: bigint, maximumRep?: bigint) => {
			const [fee] = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'purchaseQuote', args: [child, questionId, unit] })
			if (maximumRep === undefined) return writeContractAndWait(owner, () => owner.writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'createCompleteSet', args: [child, questionId, unit, owner.account.address, unit, fee] }))
			return writeContractAndWait(owner, () => owner.writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'createCompleteSetWithRecoveryRep', args: [child, questionId, unit, owner.account.address, unit, fee, maximumRep] }))
		}
		for (const [index, attempt] of [() => buy(fixture.secondQuestionId), () => buy(fixture.secondQuestionId, requiredRep - 1n), () => buy(fixture.secondQuestionId, requiredRep)].entries()) {
			if (index < 2) await expect(attempt()).rejects.toThrow('Recovery REP exceeds budget')
			else await expect(attempt()).rejects.toThrow()
			expect(await ownerRep()).toBe(beforeRep)
			expect(await collateralBalance(owner, fixture.portfolio, owner.account.address)).toBe(beforeCash)
			expect(await owner.readContract({ ...book, functionName: 'totals', args: [bookId] })).toEqual(beforeBook)
		}
		await approveToken(owner, rep.address, settlement)
		await buy(fixture.secondQuestionId, requiredRep)
		expect(await ownerRep()).toBe(beforeRep - requiredRep)
		expect(await owner.readContract({ ...book, functionName: 'recoveryRep', args: [bookId] })).toBe(recovery + requiredRep)
		expect(await owner.readContract({ ...book, functionName: 'quoteRecoveryRep', args: [bookId, fixture.secondQuestionId, 10n * unit] })).toBe(oldClaim)
		expect(await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'quoteMintRecoveryRep', args: [child, freshQuestionId, unit] })).toBe(0n)
		await buy(freshQuestionId)
		expect(await ownerRep()).toBe(beforeRep - requiredRep)
		expect(await owner.readContract({ ...book, functionName: 'quoteRecoveryRep', args: [bookId, freshQuestionId, unit] })).toBe(0n)
		expect(await owner.readContract({ ...book, functionName: 'quoteRecoveryRep', args: [bookId, fixture.secondQuestionId, 10n * unit] })).toBe(oldClaim)
	})
})
