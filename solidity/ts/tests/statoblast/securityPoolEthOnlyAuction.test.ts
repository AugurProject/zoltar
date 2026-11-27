import { collateralBalance } from './burnEvidence'
import { describe, expect, test } from 'bun:test'
import { decodeEventLog, parseAbi, toEventSelector, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { prepareSecurityPoolCollateralRepairAuction, repairAuctionPositionOf } from './securityPoolCollateralRepairAuctionFixture'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, forkUniverse, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import {
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'

describe('Statoblast: ETH-only collateral-repair-auction funding', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })

	test('a bidder with no child REP or allowance buys only its priced REP under weak demand', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const balance = await context.balance(context.other.account.address)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'transfer', args: [context.owner.account.address, balance] }))
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'approve', args: [context.auction, 0n] }))
		expect(await context.balance(context.other.account.address)).toBe(0n)
		const grid = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		const minimum = ((100n * unit + grid - 1n) / grid) * grid
		const collateralToken = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'collateralToken' })
		const collateralAbi = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'])
		const approveCollateral = async (amount: bigint) => await writeContractAndWait(context.other, () => context.other.writeContract({ abi: collateralAbi, address: collateralToken, functionName: 'approve', args: [context.auction, amount] }))
		await approveCollateral(2n * unit - 1n)
		await expect(context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'submitBid', args: [2n, minimum] })).rejects.toThrow('SafeERC20Ops token call reverted')
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'bidCount' })).toBe(0n)
		expect(await collateralBalance(context.other, fixture.securityPool, context.engine)).toBe(0n)
		await approveCollateral(2n * unit + 1n)
		const hash = await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'submitBid', args: [2n, minimum] }))
		const bid = { hash, id: 1n }
		expect(await context.other.readContract({ abi: collateralAbi, address: collateralToken, functionName: 'allowance', args: [context.other.account.address, context.auction] })).toBe(1n)

		const { logs } = await context.other.getTransactionReceipt({ hash: bid.hash })
		const transferAbi = parseAbi(['event Transfer(address indexed src,address indexed dst,uint256 wad)'])
		const event = transferAbi[0]
		if (event === undefined) throw new Error('Missing Transfer ABI')
		const transfers = logs.filter(log => log.address === collateralToken && log.topics[0] === toEventSelector(event)).map(log => decodeEventLog({ abi: transferAbi, data: log.data, topics: log.topics }).args)

		expect(transfers.some(transfer => 'src' in transfer && 'dst' in transfer && 'wad' in transfer && transfer['src'] === context.other.account.address && transfer['dst'] === context.engine && transfer['wad'] === 2n * unit)).toBe(true)

		expect(await collateralBalance(context.other, fixture.securityPool, context.auction)).toBe(0n)
		expect(await collateralBalance(context.other, fixture.securityPool, context.engine)).toBe(2n * unit)
		await context.closingQuote()
		await context.finalize()
		const position = await repairAuctionPositionOf(context.owner, context.capital, bid.id)
		expect(position.commitment).toBe(2n * unit)
		expect(position.principal + position.earnedAttoRep).toBe(2n * minimum)
	})

	test.each([false, true])('closing a repair auction without bids finalizes its engine (opened %s) (#1412)', async opened => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		if (opened) {
			await context.report()
			await context.open()
		}
		await context.finalize()
		expect(await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'finalized' })).toBeTrue()
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'finalized' })).toBeTrue()
		const clearing = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [0n, 0n] })
		expect(clearing).toMatchObject({ filledLots: 0n, soldAttoRep: 0n, raisedAttoEth: 0n })
	})

	test('a losing bidder deploys nothing and withdraws its refund before finalization (#1410)', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const loser = await context.bid(context.other, 2n, 100n * unit)
		await expect(context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [loser.id, context.other.account.address] })).rejects.toThrow('Bid may still win')
		const winner = await context.bid(context.owner, 5n, 10n * unit)
		// A bid creates no contract: its receipt carries no contract creation and the bidder is recorded once.
		for (const bid of [loser, winner]) expect((await context.owner.getTransactionReceipt({ hash: bid.hash })).contractAddress ?? undefined).toBeUndefined()
		expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'unclaimedRepairAuctionBids', args: [context.other.account.address] })).toBe(1n)
		// Rejecting an already-excluded bid records nothing.
		await expect(context.bid(context.other, 2n, 100n * unit)).rejects.toThrow('Better bids already exclude this bid')
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'bidCount' })).toBe(2n)
		expect(await collateralBalance(context.owner, fixture.securityPool, context.engine)).toBe(7n * unit)
		const clearing = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [5n, 0n] })
		// Only the original bidder takes back the excluded bid's collateral, to any recipient it chooses.
		await expect(context.owner.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [loser.id, context.owner.account.address] })).rejects.toThrow('Auction bid belongs to another bidder')
		const recipient = context.owner.account.address
		const before = await collateralBalance(context.owner, fixture.securityPool, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [loser.id, recipient] }))
		expect((await collateralBalance(context.owner, fixture.securityPool, recipient)) - before).toBe(2n * unit)

		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [5n, 0n] })).toEqual(clearing)
		// A new bid is an independent decision; the refund is not locked into rebidding.
		const replacement = await context.bid(context.other, 2n, 6n * unit)
		await context.closingQuote()
		await context.finalize()
		expect((await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [loser.id] })).filledLots).toBe(0n)
		expect((await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [replacement.id] })).filledLots).toBe(2n)
		await expect(context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [loser.id, context.other.account.address] })).rejects.toThrow('already been settled')
	})

	test('a bidder refunds each bid once, before and after closing', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [1n, context.other.account.address] })).rejects.toThrow('Collateral repair auction has not opened')
		await context.report()
		await context.open()
		const loser = await context.bid(context.other, 2n, 100n * unit)
		// Equal limits fill in submission order: the owner's earlier bid fills first, leaving the tied bid a partial fill.
		const full = await context.bid(context.owner, 3n)
		const tied = await context.bid(context.other, 5n)
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [loser.id, zeroAddress] })).rejects.toThrow('Auction refund recipient is required')
		await expect(context.owner.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [loser.id, context.owner.account.address] })).rejects.toThrow('Auction bid belongs to another bidder')
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [tied.id, context.other.account.address] })).rejects.toThrow('Bid may still win')
		const recipient = context.owner.account.address
		const before = await collateralBalance(context.owner, fixture.securityPool, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [loser.id, recipient] }))
		expect((await collateralBalance(context.owner, fixture.securityPool, recipient)) - before).toBe(2n * unit)
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [loser.id, recipient] })).rejects.toThrow('Auction bid has already been settled')
		await context.closingQuote()
		await context.finalize()
		const fill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [tied.id] })
		expect(fill.refundAttoEth).toBeGreaterThan(0n)
		const afterClose = await collateralBalance(context.owner, fixture.securityPool, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [tied.id, recipient] }))
		expect((await collateralBalance(context.owner, fixture.securityPool, recipient)) - afterClose).toBe(fill.refundAttoEth)
		// A fully filled bid has nothing to refund.
		await expect(context.owner.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [full.id, recipient] })).rejects.toThrow('Auction bid has no refund')
		expect((await repairAuctionPositionOf(context.owner, context.capital, tied.id)).claimed).toBe(false)
	})

	test('purchased collateral backs each lot at the protocol floor without selling unsold inventory', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const grid = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		const price = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'openingConservativePrice' })
		const multiplier = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'securityMultiplierBps' })
		const required = await context.owner.readContract({ abi: indexArtifact.abi, address: context.index, functionName: 'requiredRep', args: [unit, price, multiplier, 10_000n] })
		const minimum = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'minimumCollateralAttoRepPerLot' })
		expect(minimum).toBe(((required + grid - 1n) / grid) * grid)
		await expect(context.bid(context.other, 3n, minimum - grid)).rejects.toThrow('Auction bid does not back its lots')
		const bid = await context.bid(context.other, 3n, minimum)
		await context.closingQuote()
		await context.finalize()
		const result = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [5n, 0n] })
		expect(result.soldAttoRep).toBe(3n * minimum)
		expect(result.soldAttoRep).toBe(result.filledLots * result.attoRepPerLot)
		const virtual = await repairAuctionPositionOf(context.owner, context.capital, bid.id)
		expect(virtual.principal).toBe(3n * result.attoRepPerLot)
		expect(virtual.principal).toBeGreaterThanOrEqual(3n * required)
		expect(virtual.earnedAttoRep).toBe(0n)
		const incumbent = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [context.owner.account.address] })
		expect(incumbent.feesAttoRep).toBe(0n)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'materializeRepairAuctionBids', args: [[bid.id]] }))
		const materialized = await repairAuctionPositionOf(context.owner, context.capital, bid.id)
		expect(materialized.principal + materialized.earnedAttoRep).toBe(3n * minimum)
		expect(materialized.earnedAttoRep).toBe(0n)
		expect(await context.balance(context.capital)).toBe(1_000n * unit + result.soldAttoRep)
		// Unsold inventory creates no winner earning, including after the winner
		// migrates its purchased principal to another fork.
		const threshold = await getZoltarForkThreshold(context.owner, context.child)
		await addRepToMigrationBalance(context.owner, context.source, threshold)
		await splitMigrationRep(context.owner, context.source, threshold, [1])
		const forkTime = context.deadline + 8n * DAY
		await context.mock.setTime(forkTime)
		await forkUniverse(context.owner, context.child, fixture.base.questionId)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: forkArtifact.abi, address: context.forks, functionName: 'choose', args: [context.child, 1n] }))
		await context.mock.setTime(forkTime + 56n * DAY)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: forkArtifact.abi, address: context.forks, functionName: 'startBranch', args: [context.child, 1n] }))
		const before = await context.balance(context.other.account.address)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'claimEarnings', args: [context.other.account.address] }))
		expect(await context.balance(context.other.account.address)).toBe(before + 0n)
		expect((await repairAuctionPositionOf(context.owner, context.capital, bid.id)).earnedAttoRep).toBe(0n)
	})

	test.each([1n, 2n * unit])('#1242 an adequately backed clearing survives an upward closing price %s', async price => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 2n)
		await context.closingQuote(price === 1n ? unit + 1n : price)
		await context.finalize()
		expect((await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(2n)
	})

	test('#1241 an accepted quote hours before close remains usable', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 2n)
		await context.mock.setTime(context.deadline - 6n * 3600n)
		await context.report()
		await context.finalize()
		expect((await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(2n)
	})
	test('a higher closing floor backs every filled lot without charging bidders REP', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 5n)
		await context.closingQuote(10n * unit)
		await context.finalize()
		const fill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })
		expect(fill.filledLots).toBe(5n)
		expect(fill.refundAttoEth).toBe(0n)
		const lot = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'lotAttoEth' })
		const required = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'requiredRep', args: [lot, 10_000n] })
		expect(fill.principalAttoRep / fill.filledLots).toBeGreaterThanOrEqual(required)
		// No collateral is owed back, and the bidder paid no REP.
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [bid.id, context.other.account.address] })).rejects.toThrow('Auction bid has no refund')
		expect(await context.balance(context.other.account.address)).toBe(0n)
	})
})
