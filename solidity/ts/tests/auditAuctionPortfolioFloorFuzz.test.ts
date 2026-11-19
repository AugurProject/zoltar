import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { preparePortfolioCollateralRepairAuction } from './statoblast/securityPoolPortfolioCollateralRepairAuctionFixture'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'
import { collateralBalance } from './statoblast/burnEvidence'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { addRepToMigrationBalance, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import {
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
} from '../types/contractArtifact'

// Full-stack scenarios for the closing-price floor of the collateral repair auction:
// the real portfolio, fork coordinator, price feed, auction, engine, vault clones and
// child capital ledger, compared with a brute-force clearing model.
// Long run: AUDIT_FUZZ_FULL=1 (all seven closing prices instead of three) AUDIT_FUZZ_SEED=<n> (bid shapes and materialization order) bun ./tooling/testing/bun-test.mts solidity/ts/tests/auditAuctionPortfolioFloorFuzz.test.ts

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

type ModelBid = { id: bigint; lots: bigint; min: bigint; health: bigint; bidder: WriteClient; vault: Address }

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
	if (filled === 0n) return { filled, attoRepPerLot: 0n, sold: 0n, rounding: 0n, fills }
	const marginal = lotPrice[Number(filled) - 1]
	if (marginal === undefined) throw new Error('Model marginal missing')
	const reached = filled === maximum
	const unrounded = reached ? maxOf(marginal, floor) : inventory / filled
	const attoRepPerLot = unrounded - (unrounded % grid)
	const sold = reached ? filled * attoRepPerLot : inventory
	// Price-time priority: equal limits fill in submission (id) order.
	let cumulative = 0n
	for (const bid of order) {
		fills.set(bid.id, minOf(bid.lots, maxOf(filled - cumulative, 0n)))
		cumulative += bid.lots
	}
	return { filled, attoRepPerLot, sold, rounding: sold - filled * attoRepPerLot, fills }
}

describe('audit fuzz: collateral repair auction closing-price floor on the full stack', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })

	// Closing prices as a multiple (in percent) of the opening price.
	for (const closingPercent of process.env['AUDIT_FUZZ_FULL'] === '1' ? [100n, 60n, 130n, 4_000n, 14_000n, 30_000n, 60_000n] : [60n, 130n, 14_000n]) {
		test(`closing price at ${closingPercent}% of the opening price`, async () => {
			const context = await preparePortfolioCollateralRepairAuction(fixture)
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
			// Random bids with ties around a few price levels, every one meeting its own health target at the opening price.
			const levels = [onGrid(await requiredAt(opening, 12_000n)), onGrid(await requiredAt(opening, 15_000n)), 6n * unit - ((6n * unit) % grid), 40n * unit - ((40n * unit) % grid)]
			const bids: ModelBid[] = []
			const bidCount = 3 + below(4)
			for (let index = 0; index < bidCount; index++) {
				const bidder = index % 2 === 0 ? context.other : context.owner
				const min = levels[below(levels.length)] ?? openingMinimum
				const lots = BigInt(1 + below(3))
				const health = min >= (levels[1] ?? 0n) && below(2) === 0 ? 15_000n : 12_000n
				// A new bid ranks after every existing bid at its limit.
				const rankedBefore = bids.filter(bid => bid.min <= min).reduce((sum, bid) => sum + bid.lots, 0n)
				const capacity = targetLots < inventory / min ? targetLots : inventory / min
				if (rankedBefore >= capacity) {
					await expect(context.bid(bidder, lots, min, health)).rejects.toThrow('Better bids already exclude this bid')
					continue
				}
				const submitted = await context.bid(bidder, lots, min, health)
				expect(getAddress(submitted.vault)).toBe(getAddress(await context.owner.readContract({ ...read, functionName: 'vaultFor', args: [bidder.account.address, submitted.id] })))
				bids.push({ id: submitted.id, lots, min, health, bidder, vault: getAddress(submitted.vault) })
			}
			// Confirm the closing quote before the fixed close using the smallest budget the feed accepts.
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
			await context.report(closingPrice, budget)
			const closing = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'conservativePrice' })
			const floor = onGrid(await requiredAt(closing, 10_000n))
			const expected = modelClearing(inventory, grid, bids, targetLots, floor)
			const label = `closing=${closing} opening=${opening} floor=${floor} grid=${grid} lot=${lot} target=${targetLots} inventory=${inventory} bids=[${bids.map(bid => `#${bid.id}:${bid.lots}@${bid.min}h${bid.health}`).join(' ')}] model filled=${expected.filled} repPerLot=${expected.attoRepPerLot}`
			const capitalRepBefore = await context.balance(context.capital)
			await context.finalize()
			const clearing = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewFinalization', args: [targetLots, floor] })
			expect({ label, filled: clearing.filledLots, attoRepPerLot: clearing.attoRepPerLot, sold: clearing.soldAttoRep, rounding: clearing.roundingAttoRep }).toEqual({ label, filled: expected.filled, attoRepPerLot: expected.attoRepPerLot, sold: expected.sold, rounding: expected.rounding })
			// Every winning lot is backed at the closing conservative price, and at its own minimum.
			if (clearing.filledLots !== 0n) expect(clearing.attoRepPerLot).toBeGreaterThanOrEqual(floor)
			// Custody: sold REP reaches the ledger, the rest returns to the fork authority, the auction keeps nothing.
			expect(await context.balance(context.auction)).toBe(0n)
			expect((await context.balance(context.capital)) - capitalRepBefore).toBe(expected.sold)
			const refunds = bids.reduce((sum, bid) => sum + (bid.lots - (expected.fills.get(bid.id) ?? 0n)) * lot, 0n)
			expect(await collateralBalance(context.owner, fixture.portfolio, context.engine)).toBe(refunds)
			const cohort = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionCohort' })
			expect(cohort[2]).toBe(expected.filled)
			if (expected.filled !== 0n) expect(cohort[3]).toBe(expected.attoRepPerLot)
			let roundingOwned = 0n
			// Without any filled lot no cohort is installed and the per-bid ledger view is unavailable by construction.
			if (expected.filled === 0n) await expect(context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [1n] })).rejects.toThrow('Auction capital unavailable')
			for (const bid of expected.filled === 0n ? [] : bids) {
				const fill = expected.fills.get(bid.id) ?? 0n
				const position = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionPosition', args: [bid.id] })
				expect({ label, bid: bid.id, principal: position.principal, commitment: position.commitment, materialized: position.materialized }).toEqual({ label, bid: bid.id, principal: fill * expected.attoRepPerLot, commitment: fill * lot, materialized: false })
				roundingOwned += position.earnedAttoRep
				if (fill !== 0n && BigInt(position.liquidationStarted) !== 0n) throw new Error(`winner ${bid.id} is under an adverse observation (${position.liquidationStarted}, ${typeof position.liquidationStarted}) immediately after closing: ${label}`)
			}
			expect(roundingOwned).toBe(expected.rounding)
			// Refunds and lazy materialization through each bidder's own vault, in random order.
			const order = [...bids]
			for (let index = order.length - 1; index > 0; index--) {
				const other = below(index + 1)
				const first = order[index]
				const second = order[other]
				if (first === undefined || second === undefined) throw new Error('Shuffle index out of range')
				order[index] = second
				order[other] = first
			}
			const checkpoint = encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'checkpoint' })
			let roundingPaid = 0n
			for (const bid of order) {
				const fill = expected.fills.get(bid.id) ?? 0n
				await writeContractAndWait(bid.bidder, () => bid.bidder.writeContract({ abi: vaultArtifact.abi, address: bid.vault, functionName: 'execute', args: [context.capital, 0n, checkpoint] }))
				expect(await context.owner.readContract({ abi: vaultArtifact.abi, address: bid.vault, functionName: 'initialPositionMaterialized' })).toBe(fill !== 0n)
				const owner = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [bid.vault] })
				roundingPaid += owner.feesAttoRep
				if (fill === 0n) {
					expect(owner.positionId).toBe(0n)
					continue
				}
				const position = await context.owner.readContract({ abi: indexArtifact.abi, address: context.index, functionName: 'accountOf', args: [owner.positionId] })
				expect({ label, bid: bid.id, rep: position.rep, commitment: position.commitment, target: owner.targetHealthFactorBps }).toEqual({ label, bid: bid.id, rep: fill * expected.attoRepPerLot, commitment: fill * lot, target: bid.health })
				expect(BigInt(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'liquidationStarted', args: [owner.positionId] }))).toBe(0n)
				// Backed at 100% at the ledger's current conservative price.
				expect(position.rep).toBeGreaterThanOrEqual(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'requiredRep', args: [position.commitment, 10_000n] }))
			}
			expect(roundingPaid).toBe(expected.rounding)
			expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'auctionCohort' }))[2]).toBe(0n)
			for (const bidder of [context.owner, context.other]) {
				const owed = bids.filter(bid => bid.bidder === bidder).reduce((sum, bid) => sum + (bid.lots - (expected.fills.get(bid.id) ?? 0n)) * lot, 0n)
				const mine = bids.filter(bid => bid.bidder === bidder)
				for (const bid of mine) await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [bid.id] }))
				expect(await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'refundCreditAttoEth', args: [bidder.account.address] })).toBe(owed)
				if (owed !== 0n) await writeContractAndWait(bidder, () => bidder.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'withdrawRefunds', args: [bidder.account.address] }))
			}
			expect(await collateralBalance(context.owner, fixture.portfolio, context.engine)).toBe(0n)
		})
	}
})
