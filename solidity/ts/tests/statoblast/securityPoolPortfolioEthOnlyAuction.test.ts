import { collateralBalance } from './burnEvidence'
import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { preparePortfolioCollateralRepairAuction } from './securityPoolPortfolioCollateralRepairAuctionFixture'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, forkUniverse, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import {
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'

describe('Statoblast: ETH-only collateral-repair-auction funding', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })

	test('a bidder with no child REP or allowance buys the full inventory under weak demand', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const balance = await context.balance(context.other.account.address)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'transfer', args: [context.owner.account.address, balance] }))
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'approve', args: [context.auction, 0n] }))
		expect(await context.balance(context.other.account.address)).toBe(0n)
		const grid = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		const minimum = ((100n * unit + grid - 1n) / grid) * grid
		for (const funding of [2n * unit - 1n, 2n * unit + 1n]) {
			await expect(context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'submitBid', args: [2n, minimum, 12_000n], value: funding })).rejects.toThrow()
		}
		const bid = await context.bid(context.other, 2n, minimum)
		expect(await collateralBalance(context.other, fixture.portfolio, context.auction)).toBe(0n)
		expect(await collateralBalance(context.other, fixture.portfolio, context.engine)).toBe(2n * unit)
		await context.closingQuote()
		await context.finalize()
		const position = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bid.id] })
		expect(position.commitment).toBe(2n * unit)
		expect(position.principal + position.earnedAttoRep).toBe(1_000n * unit)
	})

	test('a losing bidder withdraws and freely reuses ETH before branch finalization', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const loser = await context.bid(context.other, 2n, 100n * unit)
		await expect(context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [loser.id] })).rejects.toThrow('Bid may still win')
		await context.bid(context.owner, 5n, 10n * unit)
		// Rejecting an already-excluded bid rolls back its controller-created vault too.
		await expect(context.bid(context.other, 2n, 100n * unit)).rejects.toThrow('Better bids already exclude this bid')
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'bidCount' })).toBe(2n)
		expect(await collateralBalance(context.owner, fixture.portfolio, context.engine)).toBe(7n * unit)
		const clearing = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [5n] })
		// Anyone can credit, but the credit belongs only to the original bidder.
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [loser.id] }))
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'refundCreditAttoEth', args: [context.other.account.address] })).toBe(2n * unit)
		const recipient = context.owner.account.address
		const before = await collateralBalance(context.owner, fixture.portfolio, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'withdrawRefunds', args: [recipient] }))
		expect((await collateralBalance(context.owner, fixture.portfolio, recipient)) - before).toBe(2n * unit)
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [5n] })).toEqual(clearing)
		// A new bid is an independent decision; the refund is not locked into rebidding.
		const replacement = await context.bid(context.other, 2n, 6n * unit)
		await context.closingQuote()
		await context.finalize()
		expect((await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [loser.id] })).filledLots).toBe(0n)
		expect((await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [replacement.id] })).filledLots).toBe(2n)
		await expect(context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [loser.id] })).rejects.toThrow('already been settled')
	})

	test('a bidder credits and withdraws in one transaction, before and after closing, even when a keeper credited first', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [1n, context.other.account.address] })).rejects.toThrow('Collateral repair auction has not opened')
		await context.report()
		await context.open()
		const loser = await context.bid(context.other, 2n, 100n * unit)
		const tied = await context.bid(context.other, 5n)
		await context.bid(context.owner, 5n)
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, zeroAddress] })).rejects.toThrow('Collateral repair auction refund recipient missing')
		await expect(context.owner.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, context.owner.account.address] })).rejects.toThrow('Auction bid belongs to another bidder')
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [tied.id, context.other.account.address] })).rejects.toThrow('Bid may still win')
		// Permissionless settlement first, then the bidder's combined transaction only withdraws.
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [loser.id] }))
		const recipient = context.owner.account.address
		const before = await collateralBalance(context.owner, fixture.portfolio, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, recipient] }))
		expect((await collateralBalance(context.owner, fixture.portfolio, recipient)) - before).toBe(2n * unit)
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'refundCreditAttoEth', args: [context.other.account.address] })).toBe(0n)
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, recipient] })).rejects.toThrow('Auction has no refund credit for this bidder')
		await context.closingQuote()
		await context.finalize()
		const fill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [tied.id] })
		expect(fill.refundAttoEth).toBeGreaterThan(0n)
		const afterClose = await collateralBalance(context.owner, fixture.portfolio, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [tied.id, recipient] }))
		expect((await collateralBalance(context.owner, fixture.portfolio, recipient)) - afterClose).toBe(fill.refundAttoEth)
		expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [tied.id] })).materialized).toBe(false)
	})

	test('purchased collateral meets the chosen health target and all rounding belongs to winners', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const grid = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		const price = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'openingConservativePrice' })
		const multiplier = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'securityMultiplierBps' })
		const health = 15_001n
		const required = await context.owner.readContract({ abi: indexArtifact.abi, address: context.index, functionName: 'requiredRep', args: [unit, price, multiplier, health] })
		const minimum = ((required + grid - 1n) / grid) * grid
		await expect(context.bid(context.other, 3n, minimum - grid, health)).rejects.toThrow('does not meet chosen health target')
		const bid = await context.bid(context.other, 3n, minimum, health)
		await context.closingQuote()
		await context.finalize()
		const result = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [5n] })
		expect(result.soldAttoRep).toBe(1_000n * unit)
		expect(result.roundingAttoRep).toBeGreaterThan(0n)
		const virtual = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bid.id] })
		expect(virtual.principal).toBe(3n * result.attoRepPerLot)
		expect(virtual.principal).toBeGreaterThanOrEqual(3n * required)
		expect(virtual.earnedAttoRep).toBe(result.roundingAttoRep)
		const incumbent = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [context.owner.account.address] })
		expect(incumbent.feesAttoRep).toBe(0n)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'materializeAuctionBid', args: [bid.id] }))
		const materialized = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bid.id] })
		expect(materialized.principal + materialized.earnedAttoRep).toBe(1_000n * unit)
		expect(materialized.earnedAttoRep).toBe(result.roundingAttoRep)
		expect(await context.balance(context.capital)).toBe(2_000n * unit)
		// The initial rounding credit remains a parent-token earning when this
		// winner later chooses and migrates its pledged principal to another fork.
		const threshold = await getZoltarForkThreshold(context.owner, context.child)
		await addRepToMigrationBalance(context.owner, context.source, threshold)
		await splitMigrationRep(context.owner, context.source, threshold, [1])
		const forkTime = context.deadline + 8n * DAY
		await context.mock.setTime(forkTime)
		await forkUniverse(context.owner, context.child, fixture.base.questionId)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: vaultArtifact.abi, address: bid.vault, functionName: 'execute', args: [context.forks, 0n, encodeFunctionData({ abi: forkArtifact.abi, functionName: 'choose', args: [context.child, 1n] })] }))
		await context.mock.setTime(forkTime + 56n * DAY)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: forkArtifact.abi, address: context.forks, functionName: 'startBranch', args: [context.child, 1n] }))
		const before = await context.balance(context.other.account.address)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: vaultArtifact.abi, address: bid.vault, functionName: 'executeAndSweep', args: [context.capital, 0n, encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings' }), context.token, context.other.account.address] }))
		expect(await context.balance(context.other.account.address)).toBe(before + result.roundingAttoRep)
		expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bid.id] })).earnedAttoRep).toBe(0n)
	})

	test('a higher conservative price at closing cancels without imposing a REP loss on bidders', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 2n)
		await context.closingQuote(2n * unit)
		await context.finalize()
		const fill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })
		expect(fill.filledLots).toBe(0n)
		expect(fill.refundAttoEth).toBe(2n * unit)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [bid.id] }))
		const recipient = context.owner.account.address
		const before = await collateralBalance(context.owner, fixture.portfolio, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'withdrawRefunds', args: [recipient] }))
		expect(await collateralBalance(context.owner, fixture.portfolio, recipient)).toBe(before + 2n * unit)
		expect(await context.balance(context.other.account.address)).toBe(0n)
	})
})
