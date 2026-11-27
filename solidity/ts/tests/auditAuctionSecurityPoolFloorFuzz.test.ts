import { describe, expect, test } from 'bun:test'
import { prepareSecurityPoolCollateralRepairAuction, repairAuctionPositionOf } from './statoblast/securityPoolCollateralRepairAuctionFixture'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'
import { collateralBalance } from './statoblast/burnEvidence'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { addRepToMigrationBalance, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import {
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
} from '../types/contractArtifact'

// Full-stack scenarios for the closing-price floor of the collateral repair auction:
// the real security pool, fork coordinator, price feed, auction, engine and the child
// capital ledger, where winning lots join each bidder's own account, compared with a brute-force clearing model.
// Long run: AUDIT_FUZZ_FULL=1 (all seven closing prices instead of three) AUDIT_FUZZ_SEED=<n> (bid shapes and materialization order) bun ./tooling/testing/bun-test.mts solidity/ts/tests/auditAuctionSecurityPoolFloorFuzz.test.ts

let seed = Number(BigInt(process.env['AUDIT_FUZZ_SEED'] ?? '20261113') % 0xffffffffn)
const random = () => {
	seed = (seed + 0x6d2b79f5) | 0
	let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
	value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
	return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}
const below = (limit: number) => Math.floor(random() * limit)
const maxOf = (a: bigint, b: bigint) => (a > b ? a : b)
const minOf = (a: bigint, b: bigint) => (a < b ? a : b)

type ModelBid = { id: bigint; lots: bigint; min: bigint; bidder: WriteClient }

function modelClearing(inventory: bigint, grid: bigint, bids: readonly ModelBid[], maximum: bigint, floor: bigint) {
	const ascending = (a: bigint, b: bigint) => {
		if (a < b) return -1
		return a > b ? 1 : 0
	}
	const order = [...bids].sort((a, b) => ascending(a.min, b.min) || ascending(a.id, b.id))
	const lotPrice: bigint[] = []
	for (const bid of order) for (let lot = 0n; lot < bid.lots; lot++) lotPrice.push(bid.min)
	let filled = 0n
	for (let length = 1n; length <= maximum && length <= BigInt(lotPrice.length); length++) {
		const price = lotPrice[Number(length) - 1]
		if (price !== undefined && length * maxOf(price, floor) <= inventory) filled = length
	}
	const fills = new Map<bigint, bigint>()
	for (const bid of bids) fills.set(bid.id, 0n)
	if (filled === 0n) return { filled, attoRepPerLot: 0n, sold: 0n, fills }
	const marginal = lotPrice[Number(filled) - 1]
	if (marginal === undefined) throw new Error('Model marginal missing')
	const unrounded = maxOf(marginal, floor)
	const attoRepPerLot = unrounded - (unrounded % grid)
	const sold = filled * attoRepPerLot
	// Price-time priority: equal limits fill in submission (id) order.
	let cumulative = 0n
	for (const bid of order) {
		fills.set(bid.id, minOf(bid.lots, maxOf(filled - cumulative, 0n)))
		cumulative += bid.lots
	}
	return { filled, attoRepPerLot, sold, fills }
}

describe('audit fuzz: collateral repair auction closing-price floor on the full stack', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })

	// Closing prices as a multiple (in percent) of the opening price.
	for (const closingPercent of process.env['AUDIT_FUZZ_FULL'] === '1' ? [100n, 60n, 130n, 4_000n, 14_000n, 30_000n, 60_000n] : [60n, 130n, 14_000n]) {
		test(`closing price at ${closingPercent}% of the opening price`, async () => {
			const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
			await context.report(unit)
			await context.open()
			const read = { abi: auctionArtifact.abi, address: context.auction } as const
			const [grid, lot, targetLots, inventory, openingMinimum, opening] = await Promise.all([
				context.owner.readContract({ ...read, functionName: 'repGrid' }),
				context.owner.readContract({ ...read, functionName: 'lotAttoEth' }),
				context.owner.readContract({ ...read, functionName: 'targetLots' }),
				context.owner.readContract({ ...read, functionName: 'inventoryAttoRep' }),
				context.owner.readContract({ ...read, functionName: 'minimumCollateralAttoRepPerLot' }),
				context.owner.readContract({ ...read, functionName: 'openingConservativePrice' }),
			])
			const multiplier = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'securityMultiplierBps' })
			const requiredAt = (price: bigint, health: bigint) => context.owner.readContract({ abi: indexArtifact.abi, address: context.index, functionName: 'requiredRep', args: [lot, price, multiplier, health] })
			const onGrid = (value: bigint) => ((value + grid - 1n) / grid) * grid
			// Random bids with ties around a few price levels, every one backing its lots at the opening price.
			const levels = [onGrid(await requiredAt(opening, 12_000n)), onGrid(await requiredAt(opening, 15_000n)), 6n * unit - ((6n * unit) % grid), 40n * unit - ((40n * unit) % grid)]
			const bids: ModelBid[] = []
			const bidCount = 3 + below(4)
			for (let index = 0; index < bidCount; index++) {
				const bidder = index % 2 === 0 ? context.other : context.owner
				const min = levels[below(levels.length)] ?? openingMinimum
				const lots = BigInt(1 + below(3))
				// A new bid ranks after every existing bid at its limit.
				const rankedBefore = bids.filter(bid => bid.min <= min).reduce((sum, bid) => sum + bid.lots, 0n)
				const capacity = targetLots < inventory / min ? targetLots : inventory / min
				if (rankedBefore >= capacity) {
					await expect(context.bid(bidder, lots, min)).rejects.toThrow('Better bids already exclude this bid')
					continue
				}
				const submitted = await context.bid(bidder, lots, min)
				bids.push({ id: submitted.id, lots, min, bidder })
			}
			// A valid quote shortly before the fixed close, funded with the smallest budget the feed accepts for that price.
			const closingPrice = (unit * closingPercent) / 100n
			await context.mock.setTime(context.deadline - 1_000n)
			if (closingPercent > 1_000n) {
				// A report at a much higher REP price needs more child REP than the fixture gives the reporter.
				await addRepToMigrationBalance(context.owner, context.source, 20_000n * unit)
				await splitMigrationRep(context.owner, context.source, 20_000n * unit, [1])
				await approveToken(context.owner, context.token, context.feed)
			}
			const budget = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [closingPrice] })
			await context.report(closingPrice, budget)
			const closing = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'conservativePrice' })
			const floor = onGrid(await requiredAt(closing, 10_000n))
			const expected = modelClearing(inventory, grid, bids, targetLots, floor)
			const label = `closing=${closing} opening=${opening} floor=${floor} grid=${grid} lot=${lot} target=${targetLots} inventory=${inventory} bids=[${bids.map(bid => `#${bid.id}:${bid.lots}@${bid.min}`).join(' ')}] model filled=${expected.filled} repPerLot=${expected.attoRepPerLot}`
			const capitalRepBefore = await context.balance(context.capital)
			await context.finalize()
			const clearing = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [targetLots, floor] })
			expect({ label, filled: clearing.filledLots, attoRepPerLot: clearing.attoRepPerLot, sold: clearing.soldAttoRep }).toEqual({ label, filled: expected.filled, attoRepPerLot: expected.attoRepPerLot, sold: expected.sold })
			// Every winning lot is backed at the closing conservative price, and at its own minimum.
			if (clearing.filledLots !== 0n) expect(clearing.attoRepPerLot).toBeGreaterThanOrEqual(floor)
			// Custody: sold REP reaches the ledger, the rest returns to the fork authority, the auction keeps nothing.
			expect(await context.balance(context.auction)).toBe(0n)
			expect((await context.balance(context.capital)) - capitalRepBefore).toBe(expected.sold)
			const refunds = bids.reduce((sum, bid) => sum + (bid.lots - (expected.fills.get(bid.id) ?? 0n)) * lot, 0n)
			expect(await collateralBalance(context.owner, fixture.securityPool, context.engine)).toBe(refunds)
			const cohort = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'repairAuctionCohort' })
			expect(cohort[2]).toBe(expected.filled)
			if (expected.filled !== 0n) expect(cohort[3]).toBe(expected.attoRepPerLot)
			let roundingOwned = 0n
			// Without any filled lot no cohort is installed; each bid still reads as an unclaimed bid without lots.
			if (expected.filled === 0n) for (const bid of bids) expect(await repairAuctionPositionOf(context.owner, context.capital, bid.id)).toMatchObject({ claimed: false, materialized: false, principal: 0n, commitment: 0n })
			for (const bid of expected.filled === 0n ? [] : bids) {
				const fill = expected.fills.get(bid.id) ?? 0n
				const position = await repairAuctionPositionOf(context.owner, context.capital, bid.id)
				expect({ label, bid: bid.id, principal: position.principal, commitment: position.commitment, materialized: position.materialized }).toEqual({ label, bid: bid.id, principal: fill * expected.attoRepPerLot, commitment: fill * lot, materialized: false })
				roundingOwned += position.earnedAttoRep
				if (fill !== 0n && BigInt(position.liquidationStarted) !== 0n) throw new Error(`winner ${bid.id} is under an adverse observation (${position.liquidationStarted}, ${typeof position.liquidationStarted}) immediately after closing: ${label}`)
			}
			expect(roundingOwned).toBe(0n)
			// Lazy materialization into each bidder's own account, in random bid order. Whichever of a
			// bidder's bids comes first moves all its winning lots; the owner also holds an imported position.
			const bidders = [context.owner, context.other]
			const accountOf = (bidder: WriteClient) => context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [bidder.account.address] })
			const positionOf = (id: bigint) => context.owner.readContract({ abi: indexArtifact.abi, address: context.index, functionName: 'accountOf', args: [id] })
			const bases = await Promise.all(
				bidders.map(async bidder => {
					const account = await accountOf(bidder)
					return account.positionId === 0n ? { positionId: 0n, rep: 0n, commitment: 0n } : { positionId: account.positionId, ...(await positionOf(account.positionId)) }
				}),
			)
			const order = [...bids]
			for (let index = order.length - 1; index > 0; index--) {
				const other = below(index + 1)
				const first = order[index]
				const second = order[other]
				if (first === undefined || second === undefined) throw new Error('Shuffle index out of range')
				order[index] = second
				order[other] = first
			}
			for (const bid of order) await writeContractAndWait(bid.bidder, () => bid.bidder.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'materializeRepairAuctionBids', args: [[bid.id]] }))
			let roundingPaid = 0n
			for (const [slot, bidder] of bidders.entries()) {
				const base = bases[slot]
				if (base === undefined) throw new Error('Bidder base missing')
				const owner = await accountOf(bidder)
				roundingPaid += owner.feesAttoRep
				const won = bids.filter(bid => bid.bidder === bidder).reduce((sum, bid) => sum + (expected.fills.get(bid.id) ?? 0n), 0n)
				expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'unclaimedRepairAuctionBids', args: [bidder.account.address] })).toBe(0n)
				if (won === 0n) {
					expect(owner.positionId).toBe(base.positionId)
					continue
				}
				if (base.positionId !== 0n) expect(owner.positionId).toBe(base.positionId)
				for (const bid of bids.filter(candidate => candidate.bidder === bidder && (expected.fills.get(candidate.id) ?? 0n) !== 0n)) expect(await repairAuctionPositionOf(context.owner, context.capital, bid.id)).toMatchObject({ materialized: true, positionId: owner.positionId })
				const position = await positionOf(owner.positionId)
				expect({ label, bidder: slot, rep: position.rep, commitment: position.commitment }).toEqual({ label, bidder: slot, rep: base.rep + won * expected.attoRepPerLot, commitment: base.commitment + won * lot })
				if (base.positionId !== 0n) continue
				// A bidder holding only auction lots starts healthy and backed at 100% at the ledger's conservative price.
				expect(BigInt(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'liquidationStarted', args: [owner.positionId] }))).toBe(0n)
				expect(position.rep).toBeGreaterThanOrEqual(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'requiredRep', args: [position.commitment, 10_000n] }))
			}
			expect(roundingPaid).toBe(0n)
			expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'repairAuctionCohort' }))[2]).toBe(0n)
			for (const bidder of [context.owner, context.other]) {
				const owed = bids.filter(bid => bid.bidder === bidder).reduce((sum, bid) => sum + (bid.lots - (expected.fills.get(bid.id) ?? 0n)) * lot, 0n)
				const mine = bids.filter(bid => bid.bidder === bidder)
				for (const bid of mine) await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [bid.id] }))
				expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'refundCreditAttoEth', args: [bidder.account.address] })).toBe(owed)
				if (owed !== 0n) await writeContractAndWait(bidder, () => bidder.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'withdrawRefunds', args: [bidder.account.address] }))
			}
			expect(await collateralBalance(context.owner, fixture.securityPool, context.engine)).toBe(0n)
		})
	}
})
