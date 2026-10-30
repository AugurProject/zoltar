import { describe, expect, test } from 'bun:test'
import { preparePortfolioTruthAuction } from './securityPoolPortfolioTruthAuctionFixture'
import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioAuctionBidRequest, buildPortfolioAuctionOpenRequest, buildPortfolioAuctionVaultDepositRequest, buildPortfolioAuctionVaultExecuteRequest, loadPortfolioAuctionSnapshot, quotePortfolioAuctionBid } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, forkUniverse, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: automatic truth-auction vaults', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const prepare = () => preparePortfolioTruthAuction(fixture)

	test('all winners immediately back claims at one price before any bid is materialized', async () => {
		const context = await prepare()
		expect(await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'oracleRepExposure', args: [context.child] })).toBe(1_000n * unit)
		expect(await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'oracleExposure', args: [context.child] })).toBe(205n * unit)
		await expect(context.open()).rejects.toThrow('quote is not funded and fresh')
		await context.report()
		const readAuction = () => loadPortfolioAuctionSnapshot({ client: context.owner, portfolio: fixture.portfolio, bidder: context.owner.account.address, universeId: context.child })
		await writeContractAndWait(context.owner, async () => context.owner.sendTransaction(buildPortfolioAuctionOpenRequest(await readAuction())))
		const grid = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		const opened = await readAuction()
		if (opened.auction === undefined) throw new Error('Auction snapshot missing')
		const terms = { lots: 2n, minimumAttoRepPerLot: 5n * unit - ((5n * unit) % grid), targetHealthFactorBps: 12_000n, executionReservePerLotAttoEth: opened.auction.minimumExecutionReservePerLotAttoEth }
		const bidQuote = quotePortfolioAuctionBid(opened, terms)
		expect(bidQuote.bidAttoEth).toBe(2n * unit)
		await writeContractAndWait(context.owner, () => context.owner.sendTransaction(buildPortfolioAuctionBidRequest(opened, terms)))
		const firstSnapshot = (await readAuction()).auction?.bids[0]
		if (firstSnapshot === undefined) throw new Error('Submitted bid missing')
		const first = { id: firstSnapshot.id, vault: firstSnapshot.vault, reserve: terms.executionReservePerLotAttoEth }
		const second = await context.bid(context.other, 4n)
		await context.closingQuote()
		await context.finalize()
		const firstFill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [first.id] })
		const secondFill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [second.id] })
		expect([firstFill.filledLots, secondFill.filledLots]).toEqual([2n, 3n])
		expect(firstFill.principalAttoRep * secondFill.usedAttoEth).toBe(secondFill.principalAttoRep * firstFill.usedAttoEth)
		expect((await readAuction()).auction?.bids[0]?.fill?.filledLots).toBe(2n)
		const totalsBefore = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'totals' })
		expect(totalsBefore[1]).toBe(205n * unit)
		expect(await context.balance(context.capital)).toBe(1_000n * unit + 30n * unit)
		const virtual = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerCollateral', args: [first.vault] })
		expect(virtual[0]).toBe(firstFill.principalAttoRep)
		expect(virtual[1]).toBe(2n * unit)
		const accountBefore = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [first.vault] })
		expect(accountBefore.positionId).toBe(0n)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'materializeAuctionBid', args: [first.id] }))
		expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'totals' })).toEqual(totalsBefore)
		const account = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [first.vault] })
		expect(account.positionId).not.toBe(0n)
		expect(account.targetHealthFactorBps).toBe(12_000n)
		expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'positionExecutionReserveAttoEth', args: [account.positionId] })).toBe(2n * first.reserve)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [second.id] }))
		expect(await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundCreditAttoEth', args: [context.other.account.address] })).toBe(second.reserve)
		const before = await context.balance(context.other.account.address)
		const refundRecipient = context.owner.account.address
		const ethBefore = await context.owner.getBalance({ address: refundRecipient })
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'withdrawRefunds', args: [refundRecipient] }))
		expect(await context.balance(context.other.account.address)).toBe(before)
		expect(await context.owner.getBalance({ address: refundRecipient })).toBe(ethBefore + unit + second.reserve)
		const settlement = await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'settlement' })
		const book = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [context.child] })
		expect((await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] }))[0]).toBe(10n * unit)
		expect(await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'recoveryRep', args: [bookId] })).toBe(1_000n * unit - 30n * unit)
		expect(await context.owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'availableMintCapacity', args: [context.child] })).toBe(0n)
		await approveToken(context.owner, context.token, first.vault)
		const deposit = buildPortfolioAuctionVaultDepositRequest({ bidder: context.owner.account.address, vault: first.vault, capitalLedger: context.capital, amountAttoRep: unit, targetHealthFactorBps: 12_000n })
		await writeContractAndWait(context.owner, () => context.owner.sendTransaction(deposit))
		expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerCollateral', args: [first.vault] }))[0]).toBe(virtual[0] + unit)
		const walletBefore = await context.balance(context.owner.account.address)
		const withdrawal = buildPortfolioAuctionVaultExecuteRequest({
			bidder: context.owner.account.address,
			vault: first.vault,
			request: { account: first.vault, to: context.capital, value: 0n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [unit, first.vault] }) },
			sweep: { repToken: context.token, recipient: context.owner.account.address },
		})
		await writeContractAndWait(context.owner, () => context.owner.sendTransaction(withdrawal))
		expect(await context.balance(context.owner.account.address)).toBe(walletBefore + unit)
		expect(await context.balance(first.vault)).toBe(0n)
		await expect(context.other.sendTransaction({ ...withdrawal, account: context.other.account.address })).rejects.toThrow('Only the auction vault owner')
	})

	test('missing a closing quote refunds bid ETH and the individual execution reserve', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const before = await context.balance(context.other.account.address)
		const bid = await context.bid(context.other, 2n)
		await context.finalize()
		expect((await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(0n)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [bid.id] }))
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'withdrawRefunds', args: [context.other.account.address] }))
		expect(await context.balance(context.other.account.address)).toBe(before)
		expect(await context.other.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'demandAttoEth' })).toBe(5n * unit)
		// A losing account can still recover accidentally sent assets after close.
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: vaultArtifact.abi, address: bid.vault, functionName: 'execute', args: [context.token, 0n, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'transfer', args: [context.other.account.address, 0n] })] }))
	})

	test('a later native fork cannot cancel an auction that was valid at its earlier fixed close', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 2n)
		await context.closingQuote()
		const threshold = await getZoltarForkThreshold(context.owner, context.child)
		await addRepToMigrationBalance(context.owner, context.source, threshold)
		await splitMigrationRep(context.owner, context.source, threshold, [1])
		await context.mock.setTime(context.deadline + 8n * DAY)
		await forkUniverse(context.owner, context.child, fixture.base.questionId)
		await context.finalize(context.deadline + 8n * DAY + 10n)
		expect((await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(2n)
	})

	test('the REP inventory challenge requirement cannot be bypassed with a cheap proposed REP price', async () => {
		const context = await prepare()
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'minimumToken2ReportAttoRep' })).toBe(10n * unit)
		const minimum = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit / 10n] })
		expect(minimum).toBe(100n * unit)
		await expect(context.report(unit / 10n)).rejects.toThrow('Report funding exceeds approved budget')
	})
})
