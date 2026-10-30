import { describe, expect, test } from 'bun:test'
import { encodeFunctionData } from '@zoltar/core-shared/evm/ethereum'
import { preparePortfolioTruthAuction } from './securityPoolPortfolioTruthAuctionFixture'
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

describe('Statoblast: ETH-only truth-auction funding', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })

	test('a bidder with no child REP or allowance buys the full inventory under weak demand', async () => {
		const context = await preparePortfolioTruthAuction(fixture)
		await context.report()
		await context.open()
		const balance = await context.balance(context.other.account.address)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'transfer', args: [context.owner.account.address, balance] }))
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'approve', args: [context.auction, 0n] }))
		expect(await context.balance(context.other.account.address)).toBe(0n)
		const grid = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		const minimum = ((100n * unit + grid - 1n) / grid) * grid
		const bid = await context.bid(context.other, 2n, minimum)
		await context.closingQuote()
		await context.finalize()
		const position = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bid.id] })
		expect(position.commitment).toBe(2n * unit)
		expect(position.principal + position.earnedAttoRep).toBe(1_000n * unit)
	})

	test('purchased collateral meets the chosen health target and all rounding belongs to winners', async () => {
		const context = await preparePortfolioTruthAuction(fixture)
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
		const context = await preparePortfolioTruthAuction(fixture)
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
		const before = await context.owner.getBalance({ address: recipient })
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'withdrawRefunds', args: [recipient] }))
		expect(await context.owner.getBalance({ address: recipient })).toBe(before + 2n * (unit + bid.reserve))
		expect(await context.balance(context.other.account.address)).toBe(0n)
	})
})
