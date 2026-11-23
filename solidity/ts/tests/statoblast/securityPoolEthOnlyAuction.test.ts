import { collateralBalance } from './burnEvidence'
import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeFunctionData, parseAbi, toEventSelector, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { prepareSecurityPoolCollateralRepairAuction } from './securityPoolCollateralRepairAuctionFixture'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, forkUniverse, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import {
	statoblast_SecurityPoolAuction_SecurityPoolAuction as auctionArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
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
		await expect(context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'submitBid', args: [2n, minimum, 12_000n] })).rejects.toThrow('SafeERC20Ops token call reverted')
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'bidCount' })).toBe(0n)
		expect(await collateralBalance(context.other, fixture.securityPool, context.engine)).toBe(0n)
		await approveCollateral(2n * unit + 1n)
		const hash = await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'submitBid', args: [2n, minimum, 12_000n] }))
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
		const position = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bid.id] })
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

	test('a losing bidder receives a bid vault and withdraws its refund before finalization (#1410, #1415)', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const loser = await context.bid(context.other, 2n, 100n * unit)
		await expect(context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [loser.id] })).rejects.toThrow('Bid may still win')
		const winner = await context.bid(context.owner, 5n, 10n * unit)
		const [vaultCreated] = parseAbi(['event BidVaultCreated(uint256 indexed bidId, address indexed bidder, address indexed vault)'])
		if (vaultCreated === undefined) throw new Error('Missing bid vault event')
		for (const bid of [loser, winner]) {
			const receipt = await context.owner.getTransactionReceipt({ hash: bid.hash })
			expect(receipt.logs.some(log => log.address === context.auction && log.topics[0] === toEventSelector(vaultCreated))).toBeTrue()
		}
		// Rejecting an already-excluded bid rolls back its controller-created vault too.
		await expect(context.bid(context.other, 2n, 100n * unit)).rejects.toThrow('Better bids already exclude this bid')
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'bidCount' })).toBe(2n)
		expect(await collateralBalance(context.owner, fixture.securityPool, context.engine)).toBe(7n * unit)
		const clearing = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [5n, 0n] })
		// Anyone can credit, but the credit belongs only to the original bidder.
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [loser.id] }))
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'refundCreditAttoEth', args: [context.other.account.address] })).toBe(2n * unit)
		const recipient = context.owner.account.address
		const before = await collateralBalance(context.owner, fixture.securityPool, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'withdrawRefunds', args: [recipient] }))
		expect((await collateralBalance(context.owner, fixture.securityPool, recipient)) - before).toBe(2n * unit)
		// The early-refunded bid vault can return a separately transferred token before close (#1415).
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'transfer', args: [loser.vault, 1n] }))
		const tokenBefore = await context.balance(recipient)
		const recover = encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'transfer', args: [recipient, 1n] })
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: vaultArtifact.abi, address: loser.vault, functionName: 'execute', args: [context.token, 0n, recover] }))
		expect(await context.balance(recipient)).toBe(tokenBefore + 1n)
		expect(await context.balance(loser.vault)).toBe(0n)

		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [5n, 0n] })).toEqual(clearing)
		// A new bid is an independent decision; the refund is not locked into rebidding.
		const replacement = await context.bid(context.other, 2n, 6n * unit)
		await context.closingQuote()
		await context.finalize()
		expect((await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [loser.id] })).filledLots).toBe(0n)
		expect((await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [replacement.id] })).filledLots).toBe(2n)
		await expect(context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [loser.id] })).rejects.toThrow('already been settled')
	})

	test('a bidder credits and withdraws in one transaction, before and after closing, even when a keeper credited first', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [1n, context.other.account.address] })).rejects.toThrow('Collateral repair auction has not opened')
		await context.report()
		await context.open()
		const loser = await context.bid(context.other, 2n, 100n * unit)
		// Equal limits fill in submission order: the owner's earlier bid fills first, leaving the tied bid a partial fill.
		await context.bid(context.owner, 3n)
		const tied = await context.bid(context.other, 5n)
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, zeroAddress] })).rejects.toThrow('Collateral repair auction refund recipient missing')
		await expect(context.owner.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, context.owner.account.address] })).rejects.toThrow('Auction bid belongs to another bidder')
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [tied.id, context.other.account.address] })).rejects.toThrow('Bid may still win')
		// Permissionless settlement first, then the bidder's combined transaction only withdraws.
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [loser.id] }))
		const recipient = context.owner.account.address
		const before = await collateralBalance(context.owner, fixture.securityPool, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, recipient] }))
		expect((await collateralBalance(context.owner, fixture.securityPool, recipient)) - before).toBe(2n * unit)
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'refundCreditAttoEth', args: [context.other.account.address] })).toBe(0n)
		await expect(context.other.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [loser.id, recipient] })).rejects.toThrow('Auction has no refund credit for this bidder')
		await context.closingQuote()
		await context.finalize()
		const fill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [tied.id] })
		expect(fill.refundAttoEth).toBeGreaterThan(0n)
		const afterClose = await collateralBalance(context.owner, fixture.securityPool, recipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [tied.id, recipient] }))
		expect((await collateralBalance(context.owner, fixture.securityPool, recipient)) - afterClose).toBe(fill.refundAttoEth)
		expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [tied.id] })).materialized).toBe(false)
	})

	test('purchased collateral meets the chosen health target without selling unsold inventory', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
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
		const result = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [5n, 0n] })
		expect(result.soldAttoRep).toBe(3n * minimum)
		expect(result.roundingAttoRep).toBe(0n)
		const virtual = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bid.id] })
		expect(virtual.principal).toBe(3n * result.attoRepPerLot)
		expect(virtual.principal).toBeGreaterThanOrEqual(3n * required)
		expect(virtual.earnedAttoRep).toBe(result.roundingAttoRep)
		const incumbent = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [context.owner.account.address] })
		expect(incumbent.feesAttoRep).toBe(0n)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'materializeAuctionBid', args: [bid.id] }))
		const materialized = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bid.id] })
		expect(materialized.principal + materialized.earnedAttoRep).toBe(3n * minimum)
		expect(materialized.earnedAttoRep).toBe(result.roundingAttoRep)
		expect(await context.balance(context.capital)).toBe(1_000n * unit + result.soldAttoRep)
		// Unsold inventory creates no winner earning, including after the winner
		// migrates its purchased principal to another fork.
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
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'refundCreditAttoEth', args: [context.other.account.address] })).toBe(0n)
		expect(await context.balance(context.other.account.address)).toBe(0n)
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
})
