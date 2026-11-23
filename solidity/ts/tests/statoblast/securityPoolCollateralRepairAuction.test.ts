import { collateralBalance } from './burnEvidence'
import { describe, expect, test } from 'bun:test'
import { prepareSecurityPoolCollateralRepairAuction } from './securityPoolCollateralRepairAuctionFixture'
import { encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	auctionVaultRuntimeCode,
	buildSecurityPoolAuctionBidRequest,
	buildSecurityPoolAuctionOpenRequest,
	buildSecurityPoolAuctionVaultDepositRequest,
	buildSecurityPoolAuctionVaultExecuteRequest,
	loadSecurityPoolAuctionSnapshot,
	predictAuctionVaultAddress,
	quoteSecurityPoolAuctionBid,
} from '@zoltar/statoblast-shared/statoblast/securityPool'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolAuction_SecurityPoolAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, forkUniverse, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: automatic collateral-repair-auction vaults', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const prepare = () => prepareSecurityPoolCollateralRepairAuction(fixture)
	test('#1339 #1551 equal lots cover a shortfall that is not a multiple of the minimum', async () => {
		const context = await prepare()
		const implementation = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'vaultImplementation' })
		const shortfall = (35n * unit) / 10n
		const receipt = await context.owner.waitForTransactionReceipt({
			hash: await context.owner.sendTransaction({ data: encodeDeployData({ abi: auctionArtifact.abi, bytecode: `0x${auctionArtifact.evm.bytecode.object}`, args: [context.owner.account.address, fixture.securityPool, context.child, context.deadline, 1_000n * unit, shortfall, implementation] }) }),
		})
		if (!receipt.contractAddress) throw new Error('Auction deployment missing')
		const target = { abi: auctionArtifact.abi, address: receipt.contractAddress }
		const lot = await context.owner.readContract({ ...target, functionName: 'lotAttoEth' })
		const lots = await context.owner.readContract({ ...target, functionName: 'targetLots' })
		// One lot per whole minimum commitment, rounded up to cover the deficit.
		expect(lots).toBe(3n)
		expect(lot).toBe((shortfall + 2n) / 3n)
		expect(lots * lot - shortfall).toBeLessThan(lots)
	})

	test('#1331 opening cannot compress the competitive bidding period to seconds', async () => {
		const context = await prepare()
		await context.mock.setTime(context.deadline - 600n)
		await context.report()
		await context.mock.setTime(context.deadline - 2n)
		await expect(context.open()).rejects.toThrow('requires one day of bidding')
	})

	test('#1331 exactly one full day of bidding remains available at the opening boundary', async () => {
		const context = await prepare()
		await context.mock.setTime(context.deadline - DAY - 600n)
		await context.report()
		await context.mock.setTime(context.deadline - DAY - 1n)
		await context.open()
		expect(await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'opened' })).toBe(true)
	})

	test.each(['target', 'inventory'] as const)('#1371 quote and engine agree at the %s-funded exclusion boundary', async mode => {
		const context = await prepare()
		await context.report()
		await context.open()
		const target = { abi: auctionArtifact.abi, address: context.auction }
		const lots = await context.owner.readContract({ ...target, functionName: 'targetLots' })
		await context.bid(context.owner, mode === 'target' ? lots : 1n, 6n * unit, 10_000n)
		const snapshot = await loadSecurityPoolAuctionSnapshot({ client: context.other, securityPool: fixture.securityPool, bidder: context.other.account.address, universeId: context.child })
		if (snapshot.auction === undefined) throw new Error('Auction snapshot missing')
		const { repGrid, maximumAdmissibleBidAttoRepPerLot: maximum, inventoryAttoRep } = snapshot.auction
		const inventoryLimit = inventoryAttoRep / 2n
		expect(maximum).toBe(mode === 'target' ? 6n * unit - repGrid : inventoryLimit - (inventoryLimit % repGrid))
		const terms = { lots: 1n, minimumAttoRepPerLot: maximum + repGrid, targetHealthFactorBps: 10_000n }
		expect(() => quoteSecurityPoolAuctionBid(snapshot, terms)).toThrow('Better funded bids')
		await expect(context.bid(context.other, 1n, maximum + repGrid, 10_000n)).rejects.toThrow('Better bids already exclude this bid')
		expect(quoteSecurityPoolAuctionBid(snapshot, { ...terms, minimumAttoRepPerLot: maximum }).bidAttoEth).toBe(snapshot.auction.lotAttoEth)
		await context.bid(context.other, 1n, maximum, 10_000n)
	})

	test('all winners immediately back claims at one price before any bid is materialized', async () => {
		const context = await prepare()
		expect(await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'oracleRepExposure', args: [context.child] })).toBe(1_000n * unit)
		expect(await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'oracleExposure', args: [context.child] })).toBe(205n * unit)
		await expect(context.open()).rejects.toThrow('quote is not funded and fresh')
		await context.report()
		const readAuction = () => loadSecurityPoolAuctionSnapshot({ client: context.owner, securityPool: fixture.securityPool, bidder: context.owner.account.address, universeId: context.child })
		await writeContractAndWait(context.owner, async () => context.owner.sendTransaction(buildSecurityPoolAuctionOpenRequest(await readAuction())))
		const grid = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		const collateral = await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		await approveToken(context.owner, collateral, context.auction)
		const opened = await readAuction()
		if (opened.auction === undefined) throw new Error('Auction snapshot missing')
		const terms = { lots: 2n, minimumAttoRepPerLot: 5n * unit - ((5n * unit) % grid), targetHealthFactorBps: 12_000n }
		const bidQuote = quoteSecurityPoolAuctionBid(opened, terms)
		expect(bidQuote.bidAttoEth).toBe(2n * unit)
		await writeContractAndWait(context.owner, () => context.owner.sendTransaction(buildSecurityPoolAuctionBidRequest(opened, terms)))
		const firstSnapshot = (await readAuction()).auction?.bids[0]
		if (firstSnapshot === undefined) throw new Error('Submitted bid missing')
		const first = { id: firstSnapshot.id, vault: firstSnapshot.vault }
		// Each vault is a clone at the address the auction and the SDK both predict from its bindings.
		const implementation = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'vaultImplementation' })
		const bindings = { implementation, owner: context.owner.account.address, capital: context.capital, auction: context.auction, bidId: first.id }
		expect(opened.auction.vaultImplementation).toBe(implementation)
		expect(predictAuctionVaultAddress(bindings)).toBe(first.vault)
		expect(await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'vaultFor', args: [context.owner.account.address, first.id] })).toBe(first.vault)
		expect(await context.owner.getCode({ address: first.vault })).toBe(auctionVaultRuntimeCode(bindings))
		expect(await context.owner.getCode({ address: implementation })).toBe(`0x${vaultArtifact.evm.deployedBytecode.object}`)
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
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [second.id] }))
		expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'refundCreditAttoEth', args: [context.other.account.address] })).toBe(unit)
		const before = await context.balance(context.other.account.address)
		const refundRecipient = context.owner.account.address
		const ethBefore = await collateralBalance(context.owner, fixture.securityPool, refundRecipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'withdrawRefunds', args: [refundRecipient] }))
		expect(await context.balance(context.other.account.address)).toBe(before)
		expect(await collateralBalance(context.owner, fixture.securityPool, refundRecipient)).toBe(ethBefore + unit)
		const settlement = await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [context.child] })
		expect((await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] }))[0]).toBe(10n * unit)
		expect(await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'recoveryRep', args: [bookId] })).toBe(1_000n * unit - 30n * unit)
		expect(await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'isCashFunded', args: [bookId] })).toBe(true)
		expect(await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'availableMintCapacity', args: [context.child] })).toBe(195n * unit)
		await expect(context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'quoteMintRecoveryRep', args: [context.child, fixture.base.questionId, unit] })).rejects.toThrow('Settlement mint closed')
		expect(await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'quoteMintRecoveryRep', args: [context.child, fixture.secondQuestionId, unit] })).toBe(0n)
		expect(await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'quoteRecoveryRep', args: [bookId, fixture.base.questionId, 10n * unit] })).toBe(970n * unit)
		await approveToken(context.owner, context.token, first.vault)
		const deposit = buildSecurityPoolAuctionVaultDepositRequest({ bidder: context.owner.account.address, vault: first.vault, capitalLedger: context.capital, amountAttoRep: unit, targetHealthFactorBps: 12_000n })
		await writeContractAndWait(context.owner, () => context.owner.sendTransaction(deposit))
		expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerCollateral', args: [first.vault] }))[0]).toBe(virtual[0] + unit)
		const walletBefore = await context.balance(context.owner.account.address)
		const withdrawal = buildSecurityPoolAuctionVaultExecuteRequest({
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

	test('the first owner operation records initial materialization once and later operations skip the auction lookup', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const vaultFlag = (vault: Address) => context.owner.readContract({ abi: vaultArtifact.abi, address: vault, functionName: 'initialPositionMaterialized' })
		const ledgerFlag = async (bidId: bigint) => (await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bidId] })).materialized
		const positionId = async (vault: Address) => (await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [vault] })).positionId
		const operate = async (client: WriteClient, vault: Address, data: Hex = encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setHealthTarget', args: [12_000n] }), target = context.capital) => {
			const hash = await writeContractAndWait(client, () => client.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'execute', args: [target, 0n, data] }))
			return (await client.waitForTransactionReceipt({ hash })).gasUsed
		}
		const winner = await context.bid(context.other, 2n)
		const loser = await context.bid(context.owner, 1n, 100n * unit)
		const partial = await context.bid(context.other, 5n)
		await expect(operate(context.other, winner.vault)).rejects.toThrow('Auction has not been finalized')
		expect(await vaultFlag(winner.vault)).toBe(false)
		await context.closingQuote()
		await context.finalize()
		expect([winner, loser, partial].map(bid => bid.vault)).toHaveLength(3)
		expect(await vaultFlag(winner.vault)).toBe(false)
		expect(await ledgerFlag(winner.id)).toBe(false)
		// A keeper's materialization is recognized by the owner's next operation.
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'materializeAuctionBid', args: [winner.id] }))
		expect(await ledgerFlag(winner.id)).toBe(true)
		expect(await vaultFlag(winner.vault)).toBe(false)
		const first = await operate(context.other, winner.vault)
		expect(await vaultFlag(winner.vault)).toBe(true)
		const second = await operate(context.other, winner.vault)
		expect(await vaultFlag(winner.vault)).toBe(true)
		expect(second).toBeLessThan(first - 40_000n)
		expect(await positionId(winner.vault)).not.toBe(0n)
		// A reverting owner action rolls back its materialization and the flag together.
		const failing = encodeFunctionData({ abi: vaultArtifact.abi, functionName: 'execute', args: [context.capital, 0n, encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [1_000n * unit, partial.vault] })] })
		const hash = await context.mock.requestRaw({ method: 'eth_sendTransaction', params: [{ from: context.other.account.address, to: partial.vault, data: failing, gas: '0x2dc6c0', gasPrice: '0x0' }] })
		await context.mock.requestRaw({ method: 'evm_mine', params: [] })
		const receipt = await context.mock.requestRaw({ method: 'eth_getTransactionReceipt', params: [hash] })
		if (typeof receipt !== 'object' || receipt === null || !('status' in receipt)) throw new Error('Missing reverted transaction receipt')
		expect(receipt.status).toBe('0x0')
		expect(await vaultFlag(partial.vault)).toBe(false)
		expect(await ledgerFlag(partial.id)).toBe(false)
		expect(await positionId(partial.vault)).toBe(0n)
		const activated = await operate(context.other, partial.vault)
		expect(await vaultFlag(partial.vault)).toBe(true)
		expect(await ledgerFlag(partial.id)).toBe(true)
		expect(activated).toBeGreaterThan(first)
		// A losing bid never records a permanent zero fill and keeps asset recovery.
		const recovery = encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'transfer', args: [context.owner.account.address, 0n] })
		for (let attempt = 0; attempt < 2; attempt++) {
			await operate(context.owner, loser.vault, recovery, context.token)
			expect(await vaultFlag(loser.vault)).toBe(false)
			expect(await positionId(loser.vault)).toBe(0n)
		}
		await expect(context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [loser.id] })).resolves.toMatchObject({ materialized: false, principal: 0n })
	})

	test('#1363 a week-old opening quote cannot settle the collateral repair sale', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const before = await collateralBalance(context.other, fixture.securityPool, context.other.account.address)
		const bid = await context.bid(context.other, 2n)
		// No report follows the opening one, so no price is valid at the deadline.
		await context.mock.setTime(context.deadline)
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'priceValidUntil' })).toBeLessThan(context.deadline)
		await context.finalize()
		expect((await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(0n)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [bid.id, context.other.account.address] }))
		expect(await collateralBalance(context.other, fixture.securityPool, context.other.account.address)).toBe(before)
	})

	test('#1363 final-day acceptance cannot rescue an observation eligible before that day', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 2n)
		await context.mock.setTime(context.deadline - DAY - 482n)
		await context.report()
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'lastSettlementTimestamp' })).toBe(context.deadline - DAY - 1n)
		expect((await context.owner.getBlock()).timestamp).toBeGreaterThan(context.deadline - DAY)
		await context.finalize()
		expect((await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(0n)
	})

	test('#1363 a final-day quote can close after its short price validity window expires', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 2n)
		await context.mock.setTime(context.deadline - 7_200n)
		await context.report()
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'priceValidUntil' })).toBeLessThan(context.deadline)
		await context.finalize()
		const fill = await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })
		expect(fill.filledLots).toBe(2n)
		expect(fill.refundAttoEth).toBe(0n)
	})

	test('a closing price the inventory cannot back fills nothing and refunds bid ETH', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const before = await context.balance(context.other.account.address)
		const bid = await context.bid(context.other, 2n)
		// At 2,000 REP per ETH one lot needs more REP than the whole inventory holds.
		await addRepToMigrationBalance(context.owner, context.source, 30_000n * unit)
		await splitMigrationRep(context.owner, context.source, 30_000n * unit, [1])
		await approveToken(context.owner, context.token, context.feed)
		await context.closingQuote(2_000n * unit)
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
		await expect(context.report(unit / 10n)).rejects.toThrow('Report funding below minimum')
	})
})
