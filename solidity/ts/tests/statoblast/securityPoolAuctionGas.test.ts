import { securityPoolTakeoverSource } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { wrapWeth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, getAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { prepareSecurityPoolCollateralRepairAuction, repairAuctionPositionOf } from './securityPoolCollateralRepairAuctionFixture'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, forkUniverse, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import {
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SharedPoolReportEscrow_SharedPoolReportEscrow as escrowArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'

type Measurement = { label: string; gas: bigint; status: 'success' | 'reverted' }
type Bid = { id: bigint; bidder: WriteClient }
const bestPrice = 3n * unit
const tiedPrice = 6n * unit
const losingPrice = 50n * unit
const health = 12_000n
const bookSizes = [8, 256] as const
// Branch closing, the first branch choice and branch starting deploy child modules.
const branchTransactions = new Set(['close: finalize branch and install the auction cohort', 'fork: winner chooses a branch', 'fork: start the chosen branch'])
const withdrawPrincipalData = (amount: bigint, recipient: Address) => encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [amount, recipient] })

// Production composition: the security pool fork coordinator, the real uniform-price
// engine with its AVL bid tree and the child capital ledger, where winning lots
// join each bidder's own account. Every measured amount is receipt gas, net of refunds.
// A larger tied book only grows logarithmic tree paths; the bounded-growth check
// guards the owner, keeper and bidder paths against a history-dependent loop.
describe('Statoblast: collateral-repair-auction lifecycle gas baselines', () => {
	// Keep the deficit in whole collateral units so this benchmark retains a
	// multi-lot book instead of measuring the fractional-deficit sizing case.
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const expectedLabels = [
		'bid: first bid in an empty book',
		'bid: later losing bid',
		'bid: last tied bid in the book',
		'refund failure: a bid that may still win',
		'early refund: bidder refunds an excluded bid',
		'refund failure: a bid already refunded',
		'close: finalize branch and install the auction cohort',
		'refund: the fully unfilled loser after closing',
		'refund: an unfilled tied bid after closing',
		'refund: a partially filled bid after closing',
		'owner: operation by an account that never bid',
		'claim: bidder claims its winning bid',
		'claim: repeated claim of the same bid',
		'claim: a bid that won nothing',
		'owner: first operation after claiming',
		'owner: second operation',
		'owner: deposit principal after claiming',
		'owner: withdraw principal',
		'owner failure: operation that reverts in the ledger',
		'keeper: claim a winning bid',
		'owner: first operation after a keeper claim',
		'owner: second operation after a keeper claim',
		'fees: permissionless ledger checkpoint',
		'fees: first earnings claim by a winner with an unclaimed bid',
		'fees: second claim',
		'fees: claim after one more vested day',
		'retirement: another winner requests retirement',
		'retirement: incumbent requests partial retirement',
		'retirement: winner requests retirement after history',
		'retirement: owner service after history',
		'retirement: winner requests retirement without history',
		'retirement: owner service without history',
		'stale price: permissionless ledger checkpoint',
		'stale price: first earnings claim by a winner',
		'stale price: second claim',
		'stale price failure: raise the health target',
		'stale price failure: withdraw pledged principal',
		'retirement: incumbent retires all spare capacity',
		'liquidation: keeper deposits principal',
		'liquidation: winner cures its claimed lots',
		'liquidation failure: takeover rejected by bounds',
		'liquidation: keeper repairs an unmaterialized winner',
		'liquidation: keeper repairs a materialized winner',
		'fork: winner claims its bids',
		'fork: winner chooses a branch',
		'fork: another winner claims its bids',
		'fork: another winner chooses a branch',
		'fork: start the chosen branch',
		'fork: parent fee claim after choosing',
		'fork: repeated parent fee claim',
	]
	const measure = async (bookSize: (typeof bookSizes)[number]) => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		const { owner, other, mock } = context
		const renewDistressedPrice = async () => {
			const reportId = await context.report(20n * unit, 5n * unit)
			const [escrow] = await owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'reportCandidates', args: [reportId] })
			// Recycling report inventory is a separate action from accepting its price.
			await writeContractAndWait(owner, () => owner.writeContract({ abi: escrowArtifact.abi, address: escrow, functionName: 'withdrawFunding' }))
		}
		const keeper = createWriteClient(mock, TEST_ADDRESSES[3])
		const stranger = createWriteClient(mock, TEST_ADDRESSES[4])
		const measurements: Measurement[] = []
		const record = (label: string, gas: bigint, status: Measurement['status'] = 'success') => {
			measurements.push({ label, gas, status })
			return gas
		}
		const gasOf = async (label: string, client: WriteClient, send: () => Promise<Hex>) => {
			const hash = await writeContractAndWait(client, send)
			return record(label, (await client.waitForTransactionReceipt({ hash })).gasUsed)
		}
		// The usual client replays reverted sends as errors. Mine the deliberately
		// failing transaction and read its receipt to record the failure-path cost.
		const revertedGasOf = async (label: string, client: WriteClient, to: Address, data: Hex) => {
			const hash = await mock.requestRaw({ method: 'eth_sendTransaction', params: [{ from: client.account.address, to, data, gas: '0x4c4b40', gasPrice: '0x0' }] })
			if (typeof hash !== 'string') throw new Error('Missing reverted transaction hash')
			await mock.requestRaw({ method: 'evm_mine', params: [] })
			const receipt = await mock.requestRaw({ method: 'eth_getTransactionReceipt', params: [hash] })
			if (typeof receipt !== 'object' || receipt === null || !('status' in receipt) || !('gasUsed' in receipt) || typeof receipt.gasUsed !== 'string') throw new Error('Missing reverted transaction receipt')
			expect(receipt.status).toBe('0x0')
			return record(label, BigInt(receipt.gasUsed), 'reverted')
		}
		const auction = { abi: auctionArtifact.abi, address: context.auction } as const
		const engine = { abi: engineArtifact.abi, address: context.engine } as const
		const capital = { abi: capitalArtifact.abi, address: context.capital } as const
		const token = { abi: tokenArtifact.abi, address: context.token } as const
		const forks = { abi: forkArtifact.abi, address: context.forks } as const
		const bid = async (label: string | undefined, bidder: WriteClient, lots: bigint, price: bigint): Promise<Bid> => {
			const collateral = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
			await wrapWeth(bidder, lots * unit)
			await approveToken(bidder, collateral, context.auction)
			const id = (await bidder.readContract({ ...engine, functionName: 'bidCount' })) + 1n
			const send = () => bidder.writeContract({ ...auction, functionName: 'submitBid', args: [lots, price], value: 0n })
			if (label === undefined) await writeContractAndWait(bidder, send)
			else await gasOf(label, bidder, send)
			return { id, bidder }
		}
		// Owner operations are ordinary capital calls from the bidder's own wallet.
		const setTarget = (label: string, client: WriteClient, target = health) => gasOf(label, client, () => client.writeContract({ ...capital, functionName: 'setHealthTarget', args: [target] }))
		const setOwnCommitment = (label: string, client: WriteClient, commitment: bigint) => gasOf(label, client, () => client.writeContract({ ...capital, functionName: 'setCommitment', args: [commitment] }))
		// Anvil consumes a snapshot on revert; restoring re-arms the same point.
		const snapshot = async (): Promise<{ id: string }> => ({ id: await mock.anvilSnapshot() })
		const restore = async (point: { id: string }) => {
			await mock.anvilRevert(point.id)
			point.id = await mock.anvilSnapshot()
		}
		const fill = (id: bigint) => owner.readContract({ ...engine, functionName: 'previewBid', args: [id] })
		const positionIdOf = async (holder: Address) => (await owner.readContract({ ...capital, functionName: 'ownerAccount', args: [holder] })).positionId
		const claim = (label: string, client: WriteClient) => gasOf(label, client, () => client.writeContract({ ...capital, functionName: 'claimEarnings', args: [client.account.address] }))

		await context.report()
		await context.open()
		// The measured winner leads the book; the early loser is admissible until
		// demand ranked before it covers the five saleable lots. Equal limits fill in
		// submission order, so a deep book needs each filler to outrank the earlier
		// ones: fillers descend one REP grid step at a time down to the tied price.
		const winner = await bid('bid: first bid in an empty book', other, 2n, bestPrice)
		const loser = await bid('bid: later losing bid', other, 1n, losingPrice)
		const grid = await owner.readContract({ ...auction, functionName: 'repGrid' })
		const targetLots = await owner.readContract({ ...auction, functionName: 'targetLots' })
		expect(targetLots).toBeGreaterThan(2n)
		const collateral = await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		// One account places at most the capped number of bids, so the deep book uses many filler accounts.
		// Spreading the deep book over several accounts keeps each filler's later claims to a few bids.
		const cap = 8
		const fillers: WriteClient[] = []
		const fillerFor = async (count: number) => {
			const slot = Math.floor((count - 1) / cap)
			const existing = fillers[slot]
			if (existing !== undefined) return existing
			const account = 0xf100000000000000000000000000000000000000n + BigInt(slot)
			const address = getAddress(`0x${account.toString(16)}`)
			await mock.impersonateAccount(address)
			await mock.setBalance(address, 10n ** 24n)
			const client = createWriteClient(mock, account)
			await wrapWeth(client, BigInt(cap) * targetLots * unit)
			await approveToken(client, collateral, context.auction)
			fillers[slot] = client
			return client
		}
		const bidderOf = new Map<bigint, WriteClient>()
		const sendFiller = async (count: number, price: bigint, label?: string) => {
			const client = await fillerFor(count)
			const id = (await client.readContract({ ...engine, functionName: 'bidCount' })) + 1n
			const send = () => client.writeContract({ ...auction, functionName: 'submitBid', args: [targetLots, price], value: 0n })
			if (label === undefined) await writeContractAndWait(client, send)
			else await gasOf(label, client, send)
			bidderOf.set(id, client)
			return { id, bidder: client }
		}
		for (let count = 1; count < bookSize; count++) await sendFiller(count, tiedPrice + BigInt(bookSize - count) * grid)
		const lastFiller = await sendFiller(bookSize, tiedPrice, 'bid: last tied bid in the book')
		expect(lastFiller.id).toBe(BigInt(bookSize) + 2n)
		await revertedGasOf('refund failure: a bid that may still win', winner.bidder, context.auction, encodeFunctionData({ abi: auctionArtifact.abi, functionName: 'refundBid', args: [winner.id, winner.bidder.account.address] }))
		const earlySnapshot = await snapshot()
		await gasOf('early refund: bidder refunds an excluded bid', other, () => other.writeContract({ ...auction, functionName: 'refundBid', args: [loser.id, stranger.account.address] }))
		await revertedGasOf('refund failure: a bid already refunded', other, context.auction, encodeFunctionData({ abi: auctionArtifact.abi, functionName: 'refundBid', args: [loser.id, stranger.account.address] }))
		await restore(earlySnapshot)
		await context.closingQuote()
		await mock.setTime(context.deadline)
		await gasOf('close: finalize branch and install the auction cohort', owner, () => owner.writeContract({ ...forks, functionName: 'finalizeBranch', args: [context.child] }))
		expect((await fill(winner.id)).filledLots).toBe(2n)
		expect((await fill(loser.id)).filledLots).toBe(0n)
		let partial: Bid | undefined
		let empty: Bid | undefined
		for (let id = lastFiller.id; id > loser.id && (partial === undefined || empty === undefined); id--) {
			const result = await fill(id)
			const bidder = bidderOf.get(id)
			if (bidder === undefined) throw new Error('Filler bidder missing')
			if (result.filledLots === 0n && empty === undefined) empty = { id, bidder }
			if (result.filledLots !== 0n && result.refundAttoEth !== 0n && partial === undefined) partial = { id, bidder }
		}
		if (partial === undefined || empty === undefined) throw new Error('Expected both partial and unfilled tied bids')
		const cohort = await owner.readContract({ ...capital, functionName: 'repairAuctionCohort' })
		const finalized = await snapshot()

		// Refunds after closing: the full loser, an unfilled tied bid, and a partially filled bid.
		await gasOf('refund: the fully unfilled loser after closing', other, () => other.writeContract({ ...auction, functionName: 'refundBid', args: [loser.id, other.account.address] }))
		const emptyBidder = empty.bidder
		await gasOf('refund: an unfilled tied bid after closing', emptyBidder, () => emptyBidder.writeContract({ ...auction, functionName: 'refundBid', args: [empty.id, emptyBidder.account.address] }))
		const partialBidder = partial.bidder
		await gasOf('refund: a partially filled bid after closing', partialBidder, () => partialBidder.writeContract({ ...auction, functionName: 'refundBid', args: [partial.id, partialBidder.account.address] }))
		await restore(finalized)

		// Claims: anyone claims bids explicitly; ordinary owner operations never move lots.
		const claimBids = (label: string, client: WriteClient, ids: bigint[]) => gasOf(label, client, () => client.writeContract({ ...capital, functionName: 'materializeRepairAuctionBids', args: [ids] }))
		await setTarget('owner: operation by an account that never bid', stranger)
		await claimBids('claim: bidder claims its winning bid', other, [winner.id])
		expect(await positionIdOf(other.account.address)).not.toBe(0n)
		await claimBids('claim: repeated claim of the same bid', other, [winner.id])
		await claimBids('claim: a bid that won nothing', other, [loser.id])
		const firstOwnerOperation = await setTarget('owner: first operation after claiming', other)
		const secondOwnerOperation = await setTarget('owner: second operation', other)
		await writeContractAndWait(owner, () => owner.writeContract({ ...token, functionName: 'transfer', args: [other.account.address, 20n * unit] }))
		await approveToken(other, context.token, context.capital)
		await gasOf('owner: deposit principal after claiming', other, () => other.writeContract({ ...capital, functionName: 'depositAndSetHealthTarget', args: [unit, health] }))
		await gasOf('owner: withdraw principal', other, () => other.writeContract({ ...capital, functionName: 'withdrawPrincipal', args: [unit, other.account.address] }))
		await revertedGasOf('owner failure: operation that reverts in the ledger', other, context.capital, encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [1_000n * unit, other.account.address] }))
		await restore(finalized)
		await claimBids('keeper: claim a winning bid', keeper, [winner.id])
		const firstAfterKeeper = await setTarget('owner: first operation after a keeper claim', other)
		const secondAfterKeeper = await setTarget('owner: second operation after a keeper claim', other)
		await restore(finalized)

		// Fee claims: the winner's first claim detaches its frozen auction fee
		// ownership; the second claim is an ordinary owner claim.
		await mock.advanceTime(2n * DAY)
		await context.report()
		await gasOf('fees: permissionless ledger checkpoint', stranger, () => stranger.writeContract({ ...capital, functionName: 'checkpoint' }))
		await claim('fees: first earnings claim by a winner with an unclaimed bid', other)
		await claim('fees: second claim', other)
		await mock.advanceTime(DAY)
		await claim('fees: claim after one more vested day', other)
		const retirementHistory = await snapshot()
		// Retirement with prior retirement history from another winner and the incumbent.
		await materializedPositionId(partial)
		await setOwnCommitment('retirement: another winner requests retirement', partial.bidder, 0n)
		await gasOf('retirement: incumbent requests partial retirement', owner, () => owner.writeContract({ ...capital, functionName: 'setCommitment', args: [100n * unit] }))
		const retiringWinnerId = await materializedPositionId(winner)
		await setOwnCommitment('retirement: winner requests retirement after history', other, 0n)
		await gasOf('retirement: owner service after history', other, () => other.writeContract({ ...capital, functionName: 'serveRetirement', args: [retiringWinnerId] }))
		await restore(retirementHistory)
		await materializedPositionId(winner)
		await setOwnCommitment('retirement: winner requests retirement without history', other, 0n)
		await gasOf('retirement: owner service without history', other, () => other.writeContract({ ...capital, functionName: 'serveRetirement', args: [retiringWinnerId] }))
		await restore(finalized)

		// Expired price: claims and checkpoints continue; price-gated operations fail.
		const validUntil = await owner.readContract({ ...capital, functionName: 'priceValidUntil' })
		// The winner's claimed position is what the price-gated operations below would change.
		await writeContractAndWait(other, () => other.writeContract({ ...capital, functionName: 'materializeRepairAuctionBids', args: [[winner.id]] }))
		await mock.setTime(BigInt(validUntil) + 1n)
		await gasOf('stale price: permissionless ledger checkpoint', stranger, () => stranger.writeContract({ ...capital, functionName: 'checkpoint' }))
		await claim('stale price: first earnings claim by a winner', other)
		await claim('stale price: second claim', other)
		await revertedGasOf('stale price failure: raise the health target', other, context.capital, encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setHealthTarget', args: [health + 1n] }))
		await revertedGasOf('stale price failure: withdraw pledged principal', other, context.capital, withdrawPrincipalData(unit, other.account.address))
		await restore(finalized)

		// Liquidation of an unmaterialized winner by a keeper, then of a
		// materialized winner, after the REP price leaves the winner undercollateralized.
		// The incumbent first retires its spare capacity so distressed commitment
		// is needed by claims and must be taken over instead of simply cured.
		await gasOf('retirement: incumbent retires all spare capacity', owner, () => owner.writeContract({ ...capital, functionName: 'setCommitment', args: [0n] }))
		await addRepToMigrationBalance(owner, context.source, 1_000n * unit)
		await splitMigrationRep(owner, context.source, 1_000n * unit, [1])
		await writeContractAndWait(owner, () => owner.writeContract({ ...token, functionName: 'transfer', args: [keeper.account.address, 600n * unit] }))
		await approveToken(keeper, context.token, context.capital)
		await gasOf('liquidation: keeper deposits principal', keeper, () => keeper.writeContract({ ...capital, functionName: 'deposit', args: [600n * unit] }))
		await renewDistressedPrice()
		const distressStart = await owner.readContract({ ...capital, functionName: 'liquidationStarted', args: [cohort[1]] })
		expect(distressStart).toBeGreaterThan(0n)
		// One hour of uninterrupted distress earns the full takeover reward; the price
		// observation must be refreshed because the feed window is shorter.
		for (let renewal = 0; renewal < 6; renewal++) {
			await mock.advanceTime(120n)
			await renewDistressedPrice()
		}
		expect(await owner.readContract({ ...capital, functionName: 'liquidationStarted', args: [cohort[1]] })).toBe(distressStart)
		const totalCommitment = (await owner.readContract({ ...capital, functionName: 'totals' }))[1]
		const demand = await owner.readContract({ ...capital, functionName: 'demandAttoEth' })
		const acceptedPriceEpoch = await owner.readContract({ ...capital, functionName: 'acceptedPriceEpoch' })
		const liquidation = await snapshot()
		// Only the winner cures, after claiming its bid. Without spare capacity the cure has
		// nothing to remove and the whole exit waits in the retirement queue.
		await writeContractAndWait(other, () => other.writeContract({ ...capital, functionName: 'materializeRepairAuctionBids', args: [[winner.id]] }))
		await setOwnCommitment(totalCommitment > demand ? 'liquidation: winner cures its claimed lots' : 'liquidation: winner exit without spare capacity queues', other, 0n)
		await restore(liquidation)
		const takeoverBounds = { maximumOwnerPrincipal: 1_000n * unit, maximumOwnerCommitment: 10n * unit, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: acceptedPriceEpoch, expectedSourceBatch: 0n }
		const winnerCommitment = (await repairAuctionPositionOf(owner, context.capital, winner.id)).commitment
		await revertedGasOf('liquidation failure: takeover rejected by bounds', keeper, context.capital, encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'takeOverRepairAuctionBid', args: [winner.id, winnerCommitment, 0n, 600n * unit, { ...takeoverBounds, maximumOwnerPrincipal: 1n }] }))
		const winnerPosition = await repairAuctionPositionOf(owner, context.capital, winner.id)
		const conservativePrice = await owner.readContract({ ...capital, functionName: 'conservativePrice' })
		const liquidationPrice = await owner.readContract({ ...capital, functionName: 'liquidationPrice' })
		const securityMultiplierBps = await owner.readContract({ ...capital, functionName: 'securityMultiplierBps' })
		const liquidationElapsed = await owner.readContract({ ...capital, functionName: 'liquidationElapsed', args: [cohort[1]] })
		expect(liquidationElapsed).toBeGreaterThanOrEqual(3600n)
		const repair = securityPoolTakeoverSource(
			{ conservativePrice, liquidationPrice, securityMultiplierBps, totalCommitmentAttoEth: totalCommitment, demandAttoEth: demand, economics: { minimumCommitmentAttoEth: unit } },
			{ rep: winnerPosition.principal, commitment: winnerPosition.commitment, batch: 0n, remainingCommitment: 0n, liquidationElapsed },
		)
		expect(repair.maximumTakeoverReward).toBe(winnerPosition.principal)
		expect(repair.maximumTakeoverCommitment).toBeGreaterThanOrEqual(unit)
		await gasOf('liquidation: keeper repairs an unmaterialized winner', keeper, () => keeper.writeContract({ ...capital, functionName: 'takeOverRepairAuctionBid', args: [winner.id, winnerCommitment, 0n, 600n * unit, takeoverBounds] }))
		await restore(liquidation)
		await writeContractAndWait(stranger, () => stranger.writeContract({ ...capital, functionName: 'materializeRepairAuctionBids', args: [[winner.id]] }))
		const materializedId = await positionIdOf(other.account.address)
		await gasOf('liquidation: keeper repairs a materialized winner', keeper, () => keeper.writeContract({ ...capital, functionName: 'takeOverWithBounds', args: [materializedId, winnerCommitment, 0n, 600n * unit, takeoverBounds] }))
		await restore(finalized)

		// Fork transition: the winner's first operation after the child forks is
		// its branch choice; parent fee claims stay available after the branch starts.
		const threshold = await getZoltarForkThreshold(owner, context.child)
		await addRepToMigrationBalance(owner, context.source, threshold)
		await splitMigrationRep(owner, context.source, threshold, [1])
		const forkTime = context.deadline + 8n * DAY
		await mock.setTime(forkTime)
		await forkUniverse(owner, context.child, fixture.base.questionId)
		const choose = (label: string, client: WriteClient) => gasOf(label, client, () => client.writeContract({ ...forks, functionName: 'choose', args: [context.child, 1n] }))
		// A bidder chooses only after every one of its bids is claimed.
		await claimBids('fork: winner claims its bids', other, [winner.id, loser.id])
		await choose('fork: winner chooses a branch', other)
		const partialBids = [...bidderOf.entries()].filter(([, bidder]) => bidder === partial.bidder).map(([id]) => id)
		await claimBids('fork: another winner claims its bids', partial.bidder, partialBids)
		await choose('fork: another winner chooses a branch', partial.bidder)
		await mock.setTime(forkTime + 56n * DAY)
		await gasOf('fork: start the chosen branch', owner, () => owner.writeContract({ ...forks, functionName: 'startBranch', args: [context.child, 1n] }))
		await claim('fork: parent fee claim after choosing', other)
		await claim('fork: repeated parent fee claim', other)
		await restore(finalized)

		// Every bidder, owner and keeper transaction stays within an ordinary allowance.
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log(`collateralRepairAuctionGas:${bookSize}`, JSON.stringify(measurements.map(entry => ({ ...entry, gas: entry.gas.toString() }))))
		expect(measurements.filter(measurement => !branchTransactions.has(measurement.label) && measurement.gas >= 3_000_000n).map(measurement => measurement.label)).toEqual([])
		expect(secondOwnerOperation).toBeLessThanOrEqual(firstOwnerOperation)
		expect(secondAfterKeeper).toBeLessThanOrEqual(firstAfterKeeper)

		async function materializedPositionId(target: Bid) {
			const holder = target.bidder.account.address
			const current = await positionIdOf(holder)
			if (current !== 0n) return current
			await writeContractAndWait(stranger, () => stranger.writeContract({ ...capital, functionName: 'materializeRepairAuctionBids', args: [[target.id]] }))
			return positionIdOf(holder)
		}
		return measurements
	}

	test('a thirty-two-fold larger tied book grows every measured path by at most a logarithmic allowance', async () => {
		const mock = fixture.base.mockWindow
		const initial = await mock.anvilSnapshot()
		const small = await measure(bookSizes[0])
		await mock.anvilRevert(initial)
		const large = await measure(bookSizes[1])
		for (const observations of [small, large]) expect(observations.map(entry => entry.label)).toEqual(expectedLabels)
		for (const entry of small) {
			const counterpart = large.find(candidate => candidate.label === entry.label)
			if (counterpart === undefined) throw new Error(`Missing large-book measurement for ${entry.label}`)
			expect(counterpart.status).toBe(entry.status)
			expect(counterpart.gas).toBeLessThan(entry.gas + 350_000n)
		}
	})
})
