import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioPricePreparationRequest, buildPortfolioPriceRequest, loadPortfolioPriceSnapshot, quotePortfolioPriceFunding } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { openOracleSettle, wrapWeth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: child portfolio price preparation', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const prepare = async (question = fixture.base.questionId, useSdk = false) => {
		const owner = fixture.owner()
		await fixture.prepare()
		await fixture.mint(10n * unit, question)
		const source = fixture.base.genesisUniverse
		const forks = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'forkController' })
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(source), getZoltarAddress())
		await forkUniverse(owner, source, fixture.base.questionId)
		const forkTime = (await getUniverseData(owner, source)).forkTime
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'choose', args: [source, 1n] }))
		const child = getChildUniverseId(source, 1)
		if (useSdk) {
			const missing = await loadPortfolioPriceSnapshot({ client: owner, portfolio: fixture.portfolio, owner: owner.account.address, universeId: child })
			expect(missing.observation).toBeUndefined()
			expect(missing.sourcePool).toBe(fixture.poolFor(fixture.base.questionId).securityPool)
			await writeContractAndWait(owner, () => owner.sendTransaction(buildPortfolioPricePreparationRequest(missing)))
		} else {
			await writeContractAndWait(owner, () => owner.writeContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'preparePortfolioPriceFeed', args: [fixture.poolFor(fixture.base.questionId).securityPool, child] }))
		}
		const feed = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [child] })
		const capital = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'capitalLedger', args: [child] })
		await addRepToMigrationBalance(owner, source, 100n * unit)
		await splitMigrationRep(owner, source, 100n * unit, [1])
		const token = getRepTokenAddress(child)
		const weth = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'weth' })
		await wrapWeth(owner, 100n * unit)
		await approveToken(owner, weth, feed)
		await approveToken(owner, token, feed)
		const bounty = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'getRequestPriceCostAttoEth' })
		const request = async (price = unit) => {
			await writeContractAndWait(owner, () => owner.writeContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPortfolioPrice', args: [price, 10n * unit, bounty], value: bounty }))
			return owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })
		}
		const start = async () => {
			await fixture.base.mockWindow.setTime(forkTime + 56n * DAY)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'startBranch', args: [source, 1n] }))
		}
		const balance = (address: Address) => owner.readContract({ abi: tokenArtifact.abi, address, functionName: 'balanceOf', args: [owner.account.address] })
		return { owner, source, child, forks, feed, capital, token, weth, bounty, request, start, balance, deadline: forkTime + 63n * DAY }
	}

	test('the SDK authenticates a production child feed before and after preparation and settlement', async () => {
		const context = await prepare(fixture.base.questionId, true)
		const load = () => loadPortfolioPriceSnapshot({ client: context.owner, portfolio: fixture.portfolio, owner: context.owner.account.address, universeId: context.child })
		const closed = await load()
		expect(closed).toMatchObject({ feed: context.feed, repToken: context.token, reportingOpen: false })
		expect(closed.observation?.minimumWethAttoEth).toBeUndefined()
		await context.start()
		const open = await load()
		expect(open.reportingOpen).toBe(true)
		expect(open.observation?.weth).toBe(context.weth)
		const funding = quotePortfolioPriceFunding(open, unit, 10n * unit)
		expect(funding).toMatchObject({ weth: 10n * unit, rep: 10n * unit, wrap: 0n, bounty: context.bounty })
		await writeContractAndWait(context.owner, () => context.owner.sendTransaction(buildPortfolioPriceRequest(open, unit, 10n * unit)))
		const pending = await load()
		const reportId = pending.observation?.pendingReportId
		if (reportId === undefined || reportId === 0n) throw new Error('SDK report ID missing')
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(context.owner, reportId)
		expect((await load()).observation?.lastPrice).toBe(unit)
		await fixture.base.mockWindow.setTime(context.deadline)
		const expired = await load()
		expect(expired.reportingOpen).toBe(false)
		expect(expired.observation?.minimumWethAttoEth).toBeUndefined()
		expect(expired.observation?.lastPrice).toBe(unit)
	})

	test('a sponsor can price a started child without materializing any child question or enabling fees', async () => {
		const context = await prepare()
		await context.start()
		const wethBefore = await context.balance(context.weth)
		const repBefore = await context.balance(context.token)
		const report = await context.request()
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(context.owner, report)
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'acceptedPrice' })).toBe(unit)
		expect(await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'feesEnabled', args: [context.child] })).toBe(false)
		expect((await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'clocks', args: [context.child] }))[3]).toBe(false)
		await expect(context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'getPool', args: [fixture.base.questionId, context.child] })).rejects.toThrow('Question pool unavailable')
		expect(await context.balance(context.weth)).toBe(wethBefore)
		expect(await context.balance(context.token)).toBe(repBefore)
	})

	test('closing the fixed preparation window freezes its accepted quote and refunds a late candidate', async () => {
		const context = await prepare()
		await context.start()
		await fixture.base.mockWindow.setTime(context.deadline - 1_000n)
		const report = await context.request()
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(context.owner, report)
		const expiry = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'priceValidUntil' })
		expect(expiry).toBeGreaterThan(context.deadline)
		const wethBefore = await context.balance(context.weth)
		const repBefore = await context.balance(context.token)
		const late = await context.request(2n * unit)
		await fixture.base.mockWindow.setTime(context.deadline)
		await openOracleSettle(context.owner, late)
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'reportOutcome', args: [late] })).toBe(2n)
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'lastPrice' })).toBe(unit)
		expect(await context.balance(context.weth)).toBe(wethBefore)
		expect(await context.balance(context.token)).toBe(repBefore)
		await expect(context.request()).rejects.toThrow('Portfolio reporting window closed')
		await fixture.base.mockWindow.setTime(expiry + 1n)
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'isPriceValid' })).toBe(false)
		expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'acceptedPrice' })).toBe(unit)
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'priceValidUntil' })).toBe(expiry)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: forkArtifact.abi, address: context.forks, functionName: 'finalizeBranch', args: [context.child] }))
		expect(await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'feesEnabled', args: [context.child] })).toBe(false)
	})

	test('a still-fresh preparation quote enables holding fees when the branch actually activates', async () => {
		const context = await prepare(fixture.secondQuestionId)
		await context.start()
		const settlement = await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'settlement' })
		const book = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		expect(await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [context.child] })).toBe(0n)
		const before = (await context.owner.readContract({ abi: forkArtifact.abi, address: context.forks, functionName: 'branches', args: [context.child] })).parentCash
		await fixture.base.mockWindow.setTime(context.deadline - 1_000n)
		const report = await context.request()
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(context.owner, report)
		await fixture.base.mockWindow.setTime(context.deadline + 100n)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: forkArtifact.abi, address: context.forks, functionName: 'finalizeBranch', args: [context.child] }))
		const bookId = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [context.child] })
		expect(bookId).not.toBe(0n)
		const cash = async () => (await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] }))[0]
		expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'isPriceValid' })).toBe(true)
		expect(await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'feesEnabled', args: [context.child] })).toBe(true)
		expect(await cash()).toBe(before)
		await fixture.base.mockWindow.advanceTime(100n)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'checkpoint' }))
		expect(await cash()).toBeLessThan(before)
	})

	test('direct requests cannot bypass branch start or a native fork', async () => {
		const context = await prepare()
		await expect(context.request()).rejects.toThrow('Portfolio reporting window closed')
		const sourceFeed = await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [context.source] })
		await expect(context.owner.simulateContract({ abi: feedArtifact.abi, address: sourceFeed, functionName: 'requestPortfolioPrice', args: [unit, 10n * unit, context.bounty], value: context.bounty })).rejects.toThrow('Portfolio reporting window closed')
	})

	test('a child that natively forked before activation still closes with fees disabled', async () => {
		const context = await prepare()
		await context.start()
		const report = await context.request()
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(context.owner, report)
		const threshold = await getZoltarForkThreshold(context.owner, context.child)
		await addRepToMigrationBalance(context.owner, context.source, threshold)
		await splitMigrationRep(context.owner, context.source, threshold, [1])
		const earliestFork = await context.owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getEarliestForkTime', args: [context.child] })
		await fixture.base.mockWindow.setTime(earliestFork)
		await forkUniverse(context.owner, context.child, fixture.base.questionId)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: forkArtifact.abi, address: context.forks, functionName: 'finalizeBranch', args: [context.child] }))
		expect((await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'clocks', args: [context.child] }))[3]).toBe(true)
		expect(await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'feesEnabled', args: [context.child] })).toBe(false)
		await expect(context.request()).rejects.toThrow('Portfolio reporting window closed')
	})

	test('a direct report cannot spend above its signed funding budget when the required funding grows', async () => {
		await fixture.prepare()
		const owner = fixture.owner()
		const feed = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const weth = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'weth' })
		const rep = getRepTokenAddress(fixture.base.genesisUniverse)
		await wrapWeth(owner, 10n * unit)
		await approveToken(owner, weth, feed)
		await approveToken(owner, rep, feed)
		const budget = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEth' })
		await fixture.authorize(300n * unit)
		expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEth' })).toBeGreaterThan(budget)
		const balance = (token: Address) => owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [owner.account.address] })
		const wethBefore = await balance(weth)
		const repBefore = await balance(rep)
		const pendingBefore = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })
		const bounty = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'getRequestPriceCostAttoEth' })
		await expect(writeContractAndWait(owner, () => owner.writeContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPortfolioPrice', args: [unit, budget, bounty], value: bounty }))).rejects.toThrow('Report funding exceeds approved budget')
		expect(await balance(weth)).toBe(wethBefore)
		expect(await balance(rep)).toBe(repBefore)
		expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })).toBe(pendingBefore)
	})

	test('the direct sponsor path also renews an active origin feed with isolated funding', async () => {
		await fixture.prepare()
		const owner = fixture.owner()
		const feed = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const weth = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'weth' })
		await wrapWeth(owner, 10n * unit)
		await approveToken(owner, weth, feed)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), feed)
		const bounty = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'getRequestPriceCostAttoEth' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPortfolioPrice', args: [2n * unit, 10n * unit, bounty], value: bounty }))
		const report = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })
		const [, sponsor, coordinator] = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'reportCandidates', args: [report] })
		expect(sponsor).toBe(owner.account.address)
		expect(coordinator).toBe(feed)
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(owner, report)
		expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'acceptedPrice' })).toBe(2n * unit)
	})
})
