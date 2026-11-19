import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as streamsArtifact,
	statoblast_Multicall3_Multicall3 as multicallArtifact,
	test_statoblast_CapitalAuctionHarness_CapitalAuctionHarness as harnessArtifact,
	test_statoblast_CapitalAuctionHarness_CapitalAuctionAdapterMock as adapterArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerZoltarMock as zoltarArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../types/contractArtifact'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { BURN_ADDRESS, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { deployCapitalTestComponents } from './statoblast/securityPoolCapitalTestComponents'
import {
	ADAPTER,
	BPS,
	DAY,
	HOUR,
	MAX_UINT,
	MINC,
	MULTIPLIER,
	ModelRevert,
	OWNER_COUNT,
	PPM,
	SCALE,
	WAD,
	abs,
	applyModel,
	ceilDiv,
	checkpoint,
	collateral,
	cure,
	eligible,
	eligibleActive,
	findPosition,
	inTree,
	integral,
	live,
	max,
	maxHealthyPrice,
	min,
	newModel,
	ownerOf,
	positionOf,
	priceValid,
	requiredRep,
	serve,
	started,
	targetOf,
	totalCommitment,
	totalRep,
	virtualBid,
	type Bounds,
	type Model,
	type ModelPosition,
	type Operation,
	type TakeoverResult,
} from './auditCapitalLedgerModel'

// Seeded stateful fuzz of the capital layer against an independent naive reference model.
//
// The model keeps a flat list of positions and recomputes every aggregate by scanning it; it
// has no tree, no lazy tags and no epochs. Distress is the timestamp of the first adverse
// observation since the latest recovery, fees are exact pro-rata rationals, and vesting is a
// list of streams integrated directly. Every step is executed on-chain and in the model, the
// complete observable state is compared, and independent conservation, health, liquidation
// and liveness properties are asserted on top.
// Long run: AUDIT_FUZZ_SEEDS=<n> (replaces the time budget) AUDIT_FUZZ_SEED_START=1 AUDIT_FUZZ_STEPS=70 AUDIT_FUZZ_BUDGET_MS=75000 AUDIT_FUZZ_SHRINK=0 (skip shrinking) AUDIT_FUZZ_MAX_FAILURES=3 bun ./tooling/testing/bun-test.mts --timeout 3600000 solidity/ts/tests/auditCapitalLedgerFuzz.test.ts

// ---------------------------------------------------------------- deterministic generator

type Random = { next: () => number; int: (bound: number) => number; chance: (probability: number) => boolean; pick: <T>(values: readonly T[]) => T }
const createRandom = (seed: number): Random => {
	let state = (seed * 0x9e3779b1 + 0x7f4a7c15) >>> 0
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0
		let value = state
		value = Math.imul(value ^ (value >>> 15), value | 1)
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
		return (value ^ (value >>> 14)) >>> 0
	}
	const int = (bound: number) => next() % bound
	return {
		next,
		int,
		chance: probability => next() / 4294967296 < probability,
		pick: values => {
			const value = values[int(values.length)]
			if (value === undefined) throw new Error('Empty random choice')
			return value
		},
	}
}
/** Log-uniform amount between 10^low and 10^high with random low-order digits. */
const randomAmount = (random: Random, low: number, high: number) => {
	const exponent = BigInt(low + random.int(high - low + 1))
	return 10n ** exponent * BigInt(1 + random.int(9)) + (random.chance(0.5) ? BigInt(random.int(1_000_000)) : 0n)
}
/** Largest commitment the owner's whole principal backs at its target and the conservative price. */
const maximumCommitment = (m: Model, rep: bigint, health: bigint) => {
	if (m.cons === 0n) return 0n
	let low = 0n
	let high = (rep * WAD * BPS * BPS) / (m.cons * MULTIPLIER * health) + 2n
	while (low < high) {
		const middle = (low + high + 1n) / 2n
		if (requiredRep(middle, m.cons, health) <= rep) low = middle
		else high = middle - 1n
	}
	return low
}
type Phase = 'importing' | 'open' | 'forked'
const phaseOf = (m: Model): Phase => {
	if (m.importing) return 'importing'
	return m.forkTime !== 0n ? 'forked' : 'open'
}

const probeTakeover = (m: Model, o: number, id: bigint, k: bigint) => {
	const probe = structuredClone(m)
	probe.now += 1n
	try {
		return applyModel(probe, { c: 'takeover', o, id, k, minAward: 0n, maxOwn: MAX_UINT, bounds: undefined })
	} catch (error) {
		if (error instanceof ModelRevert) return undefined
		throw error
	}
}
const generateTakeover = (m: Model, random: Random, owners: number): Operation => {
	// Receivers need idle principal: usually the owner holding the most.
	let o = random.int(owners)
	if (random.chance(0.7)) for (let candidate = 0; candidate < owners; candidate++) if (ownerOf(m, candidate).free > ownerOf(m, o).free) o = candidate
	if (ownerOf(m, o).free === 0n && random.chance(0.6)) return { c: 'deposit', o, amount: randomAmount(random, 19, 20) }
	const distressed = live(m).filter(p => started(m, p.id) !== 0n && p.owner !== o && (p.id !== m.cohortId || random.chance(0.1)))
	// Without a distressed position, usually move the price against the pool instead.
	// A takeover pays only when the source's deficit exceeds total commitment minus demand, so
	// first fill demand to the healthy capacity and then move the price against the pool.
	if (distressed.length === 0 && random.chance(0.85)) {
		if (m.accepted === 0n || !priceValid(m)) return generatePrice(m, random)
		if (m.demand < eligible(m, m.cons)) return { c: 'demand', value: eligible(m, m.cons) }
		return { c: 'price', price: (m.accepted * BigInt(1050 + random.int(1500))) / 1000n, until: m.now + 1n + random.pick([HOUR, 3n * DAY, 30n * DAY]) }
	}
	const candidates = distressed.length !== 0 && random.chance(0.9) ? distressed : m.positions
	if (candidates.length === 0) return { c: 'takeover', o, id: BigInt(1 + random.int(3)), k: MINC, minAward: 0n, maxOwn: MAX_UINT, bounds: undefined }
	const source = random.pick(candidates)
	// A healing cure may shrink the source before the quote; size the request on the cured position.
	const cured = structuredClone(m)
	cured.now += 1n
	let available = source.k
	try {
		checkpoint(cured)
		serve(cured, 0n)
		if (started(cured, source.id) !== 0n && priceValid(cured)) cure(cured, source.id, 0n, false)
		available = positionOf(cured, source.id).k
	} catch (error) {
		if (!(error instanceof ModelRevert)) throw error
	}
	let k = available
	const mode = random.int(10)
	if (mode < 4 && available >= 2n * MINC) k = MINC + (BigInt(random.next()) * (available - 2n * MINC)) / 4294967296n
	else if (mode === 4) k = available + 1n
	else if (mode === 5 && available > 1n) k = available - 1n
	else if (mode === 6) k = source.k
	if (k === 0n) k = MINC
	// Half of the time, shrink the request to what the receiver's own principal can back.
	const receiver = ownerOf(m, o)
	const held = findPosition(m, receiver.positionId)
	const backable = maximumCommitment(m, receiver.free + (held === undefined ? 0n : held.rep), targetOf(receiver)) - (held === undefined ? 0n : held.k)
	if (random.chance(0.5) && backable >= MINC && backable < k && available - backable >= MINC) k = backable
	const probe = probeTakeover(m, o, source.id, k)
	const award = probe === undefined ? 0n : probe.award
	const minAward = probe?.cured && random.chance(0.8) ? 0n : random.pick([0n, 0n, 0n, award, award, award + 1n, 1n])
	const free = ownerOf(m, o).free
	const maxOwn = random.pick([MAX_UINT, MAX_UINT, free, free === 0n ? 0n : free - 1n])
	if (random.chance(0.6)) return { c: 'takeover', o, id: source.id, k, minAward, maxOwn, bounds: undefined }
	const bounds: Bounds = {
		maximumOwnerPrincipal: probe === undefined ? MAX_UINT : probe.receiverPrincipal,
		maximumOwnerCommitment: probe === undefined ? MAX_UINT : probe.receiverCommitment,
		expectedTargetHealthFactorBps: targetOf(ownerOf(m, o)),
		expectedAcceptedPriceEpoch: m.epoch,
		expectedSourceBatch: probe === undefined ? source.batch : probe.sourceBatch,
	}
	const wrong = random.int(12)
	if (wrong === 0 && bounds.maximumOwnerPrincipal !== 0n) bounds.maximumOwnerPrincipal -= 1n
	if (wrong === 1 && bounds.maximumOwnerCommitment !== 0n) bounds.maximumOwnerCommitment -= 1n
	if (wrong === 2) bounds.expectedTargetHealthFactorBps += 1n
	if (wrong === 3) bounds.expectedAcceptedPriceEpoch += 1n
	if (wrong === 4) bounds.expectedSourceBatch += 1n
	return { c: 'takeover', o, id: source.id, k, minAward, maxOwn, bounds }
}
const generatePrice = (m: Model, random: Random): Operation => {
	const base = m.accepted === 0n ? WAD : m.accepted
	let price = base
	const mode = random.int(10)
	if (mode < 3) price = (base * BigInt(980 + random.int(41))) / 1000n
	else if (mode < 5) price = (base * BigInt(1050 + random.int(1500))) / 1000n
	else if (mode < 7) price = (base * BigInt(300 + random.int(650))) / 1000n
	else if (mode < 9) {
		// Land one base unit either side of a live position's exact health threshold.
		const positions = live(m)
		if (positions.length !== 0) {
			const threshold = random.pick(positions).price
			const target = random.chance(0.5) ? threshold : threshold + 1n
			price = random.chance(0.5) ? ceilDiv(target * (PPM + m.priceError), PPM) : (target * (PPM - m.priceError)) / PPM
			price += BigInt(random.int(3)) - 1n
		}
	} else price = base + BigInt(random.int(2_000_001)) - 1_000_000n
	if (price < 10n ** 15n) price = 10n ** 15n + BigInt(random.int(1000))
	if (price > 10n ** 21n) price = 10n ** 21n - BigInt(random.int(1000))
	const validity = random.pick([20n + BigInt(random.int(600)), HOUR + BigInt(random.int(18_000)), 3n * DAY, 3n * DAY, 30n * DAY, 30n * DAY, 30n * DAY, 30n * DAY])
	const until = m.now + 1n + validity
	if (random.chance(0.08)) return { c: 'price2', first: price, second: (price * BigInt(600 + random.int(900))) / 1000n + 1n, until }
	if (random.chance(0.02)) return { c: 'price', price, until: m.now }
	return { c: 'price', price, until }
}
const generateCommit = (m: Model, random: Random, o: number): Operation => {
	const owner = ownerOf(m, o)
	const p = findPosition(m, owner.positionId)
	const rep = owner.free + (p === undefined ? 0n : p.rep + (p.retired && !p.repClaimed ? p.rep : 0n))
	const current = p !== undefined && inTree(p) ? p.k : 0n
	const ceiling = maximumCommitment(m, rep, targetOf(owner))
	const fraction = (value: bigint) => (value * BigInt(1 + random.int(1000))) / 1000n
	if (ceiling < MINC && current === 0n && random.chance(0.9)) return priceValid(m) ? { c: 'deposit', o, amount: randomAmount(random, 17, 21) } : generatePrice(m, random)
	if (p !== undefined && inTree(p) && p.batch !== 0n && random.chance(0.6)) return { c: 'commit', o, value: random.chance(0.85) ? p.remaining : fraction(p.k) }
	const mode = random.int(16)
	if (mode < 4) return { c: 'commit', o, value: max(current, fraction(ceiling)) }
	if (mode === 4) return { c: 'commit', o, value: ceiling }
	if (mode === 5) return { c: 'commit', o, value: ceiling + 1n }
	if (mode === 6) return { c: 'commit', o, value: current }
	if (mode < 10 && current >= 2n * MINC) return { c: 'commit', o, value: MINC + (BigInt(random.next()) * (current - 2n * MINC)) / 4294967296n }
	if (mode === 10 && current > 1n) return { c: 'commit', o, value: max(0n, current - random.pick([1n, MINC - 1n, MINC])) }
	if (mode < 14 && current !== 0n) return { c: 'commit', o, value: 0n }
	if (mode === 14) return { c: 'commit', o, value: random.pick([1n, MINC - 1n, MINC, MINC + 1n]) }
	return { c: 'commit', o, value: fraction(max(ceiling, current)) }
}
const generateWithdraw = (m: Model, random: Random, o: number, owners: number): Operation => {
	const owner = ownerOf(m, o)
	const { withdrawable } = collateral(m, o)
	const to = random.chance(0.8) ? o : random.int(owners)
	const mode = random.int(10)
	let amount = withdrawable
	if (mode < 2) amount = owner.free
	else if (mode === 4) amount = withdrawable + 1n
	else if (mode < 8) amount = (withdrawable * BigInt(1 + random.int(1000))) / 1000n
	else if (mode === 8) amount = 1n
	else if (mode === 9) amount = owner.free + 1n
	if (amount === 0n && random.chance(0.9)) return { c: 'deposit', o, amount: randomAmount(random, 15, 21) }
	return { c: 'withdraw', o, amount, to }
}
const generateDemand = (m: Model, random: Random): Operation => {
	const capacity = eligible(m, m.cons)
	const mode = random.int(12)
	if (mode < 1) return { c: 'demand', value: max(m.demand, (capacity * BigInt(1 + random.int(1000))) / 1000n) }
	if (mode < 3) return { c: 'demand', value: max(m.demand, (capacity * BigInt(900 + random.int(101))) / 1000n) }
	if (mode < 5) return { c: 'demand', value: max(m.demand, capacity) }
	if (mode === 5) return { c: 'demand', value: capacity + 1n }
	if (mode < 8) return { c: 'demand', value: max(m.demand, eligibleActive(m, m.cons)) }
	if (mode === 8) return { c: 'demand', value: (m.demand * BigInt(500 + random.int(500))) / 1000n }
	if (mode === 9) return { c: 'demand', value: random.chance(0.3) ? 0n : m.demand - min(m.demand, MINC * BigInt(random.int(50))) }
	if (mode === 10) return { c: 'syncDemand', value: (m.demand * BigInt(random.int(1001))) / 1000n }
	return { c: 'syncDemand', value: random.chance(0.3) ? m.demand + 1n : 0n }
}
const generateTime = (m: Model, random: Random): Operation => {
	const mode = random.int(12)
	if (mode < 3) return { c: 'time', dt: BigInt(1 + random.int(30)) }
	if (mode < 6) return { c: 'time', dt: BigInt(60 + random.int(3500)) }
	if (mode < 8) return { c: 'time', dt: HOUR + BigInt(random.int(18_000)) }
	if (mode < 10) return { c: 'time', dt: DAY / 3n + BigInt(random.int(150_000)) }
	// Land around the exact expiry of the accepted price.
	const dt = m.validUntil - m.now + BigInt(random.int(5)) - 3n
	return { c: 'time', dt: dt > 0n ? dt : 1n }
}
/** Opening moves: every owner underwrites, then demand fills most of the healthy capacity. */
const bootstrap = (m: Model, random: Random, owners: number, position: number): Operation => {
	if (position < owners) {
		const owner = ownerOf(m, position)
		// A winning bidder usually materializes its vault before anything else, as the real vault does.
		const bid = Object.entries(m.bids).find(([, entry]) => entry.owner === position && entry.positionId === 0n)
		if (bid !== undefined && m.cohortId !== 0n && random.chance(0.75)) return { c: 'materialize', o: random.int(owners), bid: BigInt(bid[0]) }
		const p = findPosition(m, owner.positionId)
		const ceiling = maximumCommitment(m, owner.free + (p === undefined ? 0n : p.rep), targetOf(owner))
		if (ceiling < MINC || (p !== undefined && p.batch !== 0n) || !priceValid(m)) return { c: 'deposit', o: position, amount: randomAmount(random, 17, 21) }
		return { c: 'commit', o: position, value: max(MINC, (ceiling * BigInt(300 + random.int(701))) / 1000n) }
	}
	const capacity = eligibleActive(m, m.cons)
	return { c: 'demand', value: max(m.demand, random.chance(0.5) ? capacity : (capacity * BigInt(900 + random.int(101))) / 1000n) }
}
type Plan = { next: ((m: Model) => Operation) | undefined }
const generate = (m: Model, random: Random, owners: number, plan: Plan): Operation => {
	const o = random.int(owners)
	const phase = phaseOf(m)
	if (phase === 'forked') {
		if (!m.frozen && random.chance(0.25)) return { c: 'fork', back: 0n, freeze: true }
		const roll = random.int(100)
		if (roll < 25) return { c: 'export', o }
		if (roll < 45) return generateWithdraw(m, random, o, owners)
		if (roll < 60) return { c: 'claim', o }
		if (roll < 70) return generateTime(m, random)
		if (roll < 76) return { c: 'fundEth', amount: randomAmount(random, 3, 18) }
		if (roll < 80) return { c: 'fundRep', amount: randomAmount(random, 3, 18) }
		if (roll < 84) return { c: 'creditTimed', amount: randomAmount(random, 0, 17) }
		if (roll < 88) return { c: 'checkpoint', o }
		if (roll < 92) return { c: 'releaseBacking' }
		if (roll < 94) return { c: 'deposit', o, amount: randomAmount(random, 0, 20) }
		if (roll < 96) return { c: 'commit', o, value: 0n }
		if (roll < 97) return generatePrice(m, random)
		if (roll < 98) return { c: 'serve', o, id: 0n }
		if (roll < 99) return { c: 'materialize', o, bid: BigInt(1 + random.int(4)) }
		return generateTakeover(m, random, owners)
	}
	if (!priceValid(m) && random.chance(0.5)) return generatePrice(m, random)
	// A distressed auction cohort is liquidated one bid at a time, through its materialization.
	if (m.cohortId !== 0n && started(m, m.cohortId) !== 0n && random.chance(0.3)) {
		const open = Object.entries(m.bids).filter(([, bid]) => bid.positionId === 0n && ownerOf(m, bid.owner).positionId === 0n && ownerOf(m, bid.owner).free === 0n && !ownerOf(m, bid.owner).exported)
		if (open.length !== 0) {
			const [bidId, bid] = random.pick(open)
			let receiver = random.int(owners)
			for (let candidate = 0; candidate < owners; candidate++) if (candidate !== bid.owner && ownerOf(m, candidate).free > ownerOf(m, receiver).free) receiver = candidate
			if (ownerOf(m, receiver).free === 0n) return { c: 'deposit', o: receiver, amount: randomAmount(random, 19, 20) }
			const k = random.chance(0.6) || bid.lots < 2n ? bid.lots * MINC : MINC * BigInt(1 + random.int(Number(bid.lots) - 1))
			return { c: 'takeoverBid', o: receiver, bid: BigInt(bidId), k, minAward: 0n, maxOwn: MAX_UINT, bounds: { maximumOwnerPrincipal: MAX_UINT, maximumOwnerCommitment: MAX_UINT, expectedTargetHealthFactorBps: targetOf(ownerOf(m, receiver)), expectedAcceptedPriceEpoch: m.epoch, expectedSourceBatch: 0n } }
		}
	}
	if (live(m).some(p => started(m, p.id) !== 0n && p.id !== m.cohortId)) {
		if (random.chance(totalCommitment(m) - m.demand < MINC ? 0.6 : 0.3)) return generateTakeover(m, random, owners)
		if (random.chance(0.12)) return { c: 'time', dt: random.pick([1n, 30n, 600n, 1799n, 3599n, 3600n, 7200n]) }
	}
	// Demand synchronization frees spare without serving anyone, which is the state where a
	// targeted service could overtake earlier requests.
	const queue = live(m).filter(p => p.batch !== 0n)
	if (queue.length !== 0 && priceValid(m)) {
		const reductions = queue.reduce((sum, p) => sum + p.k - p.remaining, 0n)
		if (random.chance(0.12)) {
			// Neither a synchronization nor a price serves the queue, so the next step can target it.
			plan.next = state => {
				const waiting = live(state).filter(p => p.batch !== 0n)
				const later = waiting.filter(p => p.batch === state.nextBatch)
				if (waiting.length === 0) return { c: 'serve', o, id: 0n }
				return { c: 'serve', o, id: random.pick(later.length !== 0 && random.chance(0.6) ? later : waiting).id }
			}
			if (m.demand !== 0n && random.chance(0.7)) return { c: 'syncDemand', value: m.demand - min(m.demand, (reductions * BigInt(1 + random.int(1200))) / 1000n) }
			return { c: 'price', price: (m.accepted * BigInt(850 + random.int(150))) / 1000n + 1n, until: m.now + 1n + 30n * DAY }
		}
		if (random.chance(0.15)) {
			const later = queue.filter(p => p.batch === m.nextBatch)
			return { c: 'serve', o, id: random.pick(later.length !== 0 && random.chance(0.6) ? later : queue).id }
		}
	}
	const roll = random.int(1000)
	if (roll < 70) return { c: 'deposit', o, amount: randomAmount(random, random.chance(0.15) ? 0 : 15, random.chance(0.5) ? 18 : 21) }
	if (roll < 110) return generateDemand(m, random)
	if (roll < 125) return { c: 'depositTarget', o, amount: randomAmount(random, 15, 21), target: random.pick([9_999n, 10_000n, 10_001n, 12_500n, 20_000n]) }
	if (roll < 215) return generateWithdraw(m, random, o, owners)
	if (roll < 255) return { c: 'target', o, target: random.pick([9_999n, 10_000n, 10_000n, 10_001n, 10_500n, 12_500n, 20_000n, 40_000n]) }
	if (roll < 425) return generateCommit(m, random, o)
	if (roll < 470) {
		const pending = live(m).filter(p => p.batch !== 0n)
		const mode = random.int(10)
		if (mode < 3 || (pending.length === 0 && mode < 8)) return { c: 'serve', o, id: 0n }
		if (mode < 8) return { c: 'serve', o, id: random.pick(pending).id }
		if (mode === 8 && m.cohortId !== 0n) return { c: 'serve', o, id: m.cohortId }
		return { c: 'serve', o, id: BigInt(1 + random.int(m.positions.length + 2)) }
	}
	if (roll < 510) return { c: 'claim', o }
	if (roll < 650) return generateTakeover(m, random, owners)
	if (roll < 740) return generatePrice(m, random)
	if (roll < 800) return generateDemand(m, random)
	if (roll < 830) return { c: 'fundEth', amount: randomAmount(random, random.chance(0.1) ? 0 : 9, 18) }
	if (roll < 855) return { c: 'fundRep', amount: randomAmount(random, random.chance(0.1) ? 0 : 9, 19) }
	if (roll < 870) return { c: 'creditTimed', amount: randomAmount(random, 0, 17) }
	if (roll < 880) return { c: 'checkpoint', o }
	if (roll < 885) return { c: 'priceError', value: random.pick([0n, 1n, 50_000n, 200_000n, 1_000_000n]) }
	if (roll < 935 && m.cohortId !== 0n) {
		const bids = Object.keys(m.bids)
		const bid = bids.length === 0 || random.chance(0.1) ? BigInt(random.int(5)) : BigInt(random.pick(bids))
		if (random.chance(0.6)) return { c: 'materialize', o, bid }
		const lots = m.bids[bid.toString()]?.lots ?? 1n
		const k = random.chance(0.7) ? lots * MINC : MINC
		const free = ownerOf(m, o).free
		return {
			c: 'takeoverBid',
			o,
			bid,
			k,
			minAward: 0n,
			maxOwn: MAX_UINT,
			bounds: { maximumOwnerPrincipal: MAX_UINT, maximumOwnerCommitment: random.chance(0.9) ? MAX_UINT : free, expectedTargetHealthFactorBps: targetOf(ownerOf(m, o)), expectedAcceptedPriceEpoch: random.chance(0.9) ? m.epoch : m.epoch + 1n, expectedSourceBatch: 0n },
		}
	}
	return generateTime(m, random)
}

type Scenario = { owners: number; steps: number; forkAt: number | undefined; setup: Operation[]; bootstrap: number }
const createScenario = (random: Random, steps: number, now: bigint): Scenario => {
	// Usually 4 to 8 owners; one sequence in eight is crowded to deepen the trees.
	const owners = random.chance(0.125) ? 12 + random.int(OWNER_COUNT - 11) : 4 + random.int(5)
	const setup: Operation[] = []
	const priceError = random.pick([0n, 0n, 1n, 50_000n, 200_000n, 1_000_000n])
	if (priceError !== 0n) setup.push({ c: 'priceError', value: priceError })
	const price = random.pick([WAD, WAD, 2n * WAD, WAD / 2n + 7n, 3n * WAD + 123_456_789n, 10n ** 16n, 123_456_789_123_456_789n])
	const until = now + 400n + random.pick([3n * DAY, 30n * DAY])
	const variant = random.int(10)
	if (variant < 3) {
		// Child-style start: imported cohorts and a funded auction cohort, then sealed imports.
		setup.push({ c: 'beginImport' })
		if (random.chance(0.5)) setup.push({ c: 'price', price, until })
		const lots = BigInt(3 + random.int(20))
		const repPerLot = 21n * BigInt(1 + random.int(100_000)) * 10n ** BigInt(8 + random.int(4))
		let taken = 0n
		let bid = 1n
		const withAuction = random.chance(0.8)
		if (withAuction) setup.push({ c: 'installAuction', lots, repPerLot })
		for (let o = 0; o < owners; o++) {
			const kind = random.int(4)
			if (kind === 0 && withAuction && taken < lots) {
				const filled = min(lots - taken, BigInt(1 + random.int(6)))
				setup.push({ c: 'setBid', bid, o, health: random.pick([10_000n, 12_500n, 20_000n]), lots: filled })
				taken += filled
				bid++
			} else if (kind < 3) {
				const k = MINC * BigInt(2 + random.int(40_000)) + BigInt(random.int(1000))
				const batch = BigInt(random.int(3))
				const remaining = batch !== 0n && random.chance(0.5) ? MINC + (BigInt(random.next()) * (k - 2n * MINC)) / 4294967296n : 0n
				const rep = (requiredRep(k, price, 10_000n) * BigInt(700 + random.int(900))) / 1000n + 1n
				setup.push({ c: 'importChoice', o, rep, k, batch, remaining, target: random.pick([10_000n, 12_500n]) })
			}
		}
		if (random.chance(0.3)) setup.push({ c: 'price', price, until })
		setup.push({ c: 'finishImport', demand: random.chance(0.5) ? 0n : MINC * BigInt(random.int(20_000)) })
		setup.push({ c: 'price', price, until })
	} else {
		if (variant < 9) setup.push({ c: 'price', price, until })
		for (let o = 0; o < owners; o++) {
			if (random.chance(0.85)) setup.push({ c: 'deposit', o, amount: randomAmount(random, 17, 21) })
		}
	}
	return { owners, steps, forkAt: random.chance(0.35) ? Math.floor(steps * (0.55 + random.int(40) / 100)) : undefined, setup, bootstrap: random.chance(0.8) ? owners + 1 : 0 }
}

// ---------------------------------------------------------------- chain driver

type Snapshot = Awaited<ReturnType<ReturnType<typeof createDriver>['read']>>
const stringify = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? `${item}n` : item))

const KNOWN_REVERTS = [
	'Repairs pay future income only',
	'Position requires additional backing',
	'Receiver commitment below minimum',
	'Portfolio backing insufficient',
	'Capital universe inactive',
	'Capital price stale',
	'Invalid capital deposit',
	'Invalid capital withdrawal',
	'Insufficient owner principal',
	'Owner collateral too low',
	'Health below protocol floor',
	'Chosen health target unmet',
	'Retirement pending',
	'Commitment below minimum',
	'Retirement below economic minimum',
	'Position is not retiring',
	'Position is not live',
	'Materialize an individual auction vault',
	'Healthy commitment insufficient',
	'Sync cannot add demand',
	'Invalid capital price',
	'Fork price already frozen',
	'Adverse observation missing',
	'Position does not need takeover',
	'Invalid takeover commitment',
	'Take entire residual commitment',
	'Takeover below economic minimum',
	'Takeover award below minimum',
	'Takeover price epoch changed',
	'Takeover owner target changed',
	'Takeover source cohort changed',
	'Receiver retirement differs',
	'Receiver consent exceeded',
	'Receiver collateral insufficient',
	'Takeover owner principal exceeds limit',
	'Takeover owner commitment exceeds limit',
	'Empty fee stream',
	'Auction capital unavailable',
	'Auction vault missing',
	'Auction vault already has principal',
	'Fork choice unavailable',
	'Fork backing release unavailable',
	'Commitment imports are open',
	'Capital imports are not complete',
	'Unknown commitment position',
	'Checkpoint fees before funding',
	'Duplicate test bid',
	'Invalid auction position',
	'Auction position is not active',
	'Auction split must be proportional',
	'Fork import unavailable',
	'Owner already imported',
	'Capital already used',
	'Commitment imports already initialized',
	'Fork principal unfunded',
	'Closed retirement commitment cannot increase',
	'Position is not active',
	'Retirement must reduce commitment',
	'Invalid commitment transfer',
	'Residual REP has no commitment',
	'Commitment cohorts differ',
	'Universe has not forked',
	'Invalid oracle uncertainty',
	'Liquidation price rounds to zero',
	'Fee budget exceeds token domain',
	'Collateral transfer amount mismatch',
	'Capital operation active',
] as const

const createDriver = (getEthereum: ReturnType<typeof useIsolatedAnvilNode>['getAnvilWindowEthereum']) => {
	let admin: WriteClient | undefined
	let owners: WriteClient[] = []
	let harness: Address = addressString(0n)
	let ledger: Address = addressString(0n)
	let index: Address = addressString(0n)
	let streams: Address = addressString(0n)
	let token: Address = addressString(0n)
	let weth: Address = addressString(0n)
	let adapter: Address = addressString(0n)
	let zoltar: Address = addressString(0n)
	let multicall: Address = addressString(0n)
	// The mock token caps supply at 11 million REP across owners, fee funding and imports.
	const WALLET = 250_000n * WAD
	const burnAddress = addressString(BURN_ADDRESS)
	const adminClient = () => {
		if (admin === undefined) throw new Error('Fuzz driver is not deployed')
		return admin
	}
	const ownerClient = (o: number) => {
		const client = owners[o]
		if (client === undefined) throw new Error(`Fuzz owner ${o} missing`)
		return client
	}
	const ownerAddress = (o: number) => ownerClient(o).account.address
	const deployContract = async (data: `0x${string}`) => {
		const receipt = await adminClient().waitForTransactionReceipt({ hash: await adminClient().sendTransaction({ data }) })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Fuzz deployment failed')
		return receipt.contractAddress
	}
	const deploy = async () => {
		const ethereum = getEthereum()
		await setupTestAccounts(ethereum)
		admin = createWriteClient(ethereum, TEST_ADDRESSES[0])
		owners = []
		for (let o = 0; o < OWNER_COUNT; o++) {
			const address = 0x00000000000000000000000000000000c0de0001n + BigInt(o)
			await ethereum.impersonateAccount(addressString(address))
			owners.push(createWriteClient(ethereum, address))
		}
		const components = await deployCapitalTestComponents(adminClient())
		if (components.contractAddress === undefined || components.contractAddress === null) throw new Error('Capital test components missing')
		harness = await deployContract(encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [components.contractAddress] }))
		ledger = await adminClient().readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'ledger' })
		index = await adminClient().readContract({ abi: capitalArtifact.abi, address: ledger, functionName: 'commitmentIndex' })
		streams = await adminClient().readContract({ abi: capitalArtifact.abi, address: ledger, functionName: 'feeStreams' })
		token = await adminClient().readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'token' })
		weth = await adminClient().readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'collateralToken' })
		zoltar = await adminClient().readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'zoltar' })
		adapter = await deployContract(encodeDeployData({ abi: adapterArtifact.abi, bytecode: `0x${adapterArtifact.evm.bytecode.object}`, args: [ledger] }))
		multicall = await deployContract(`0x${multicallArtifact.evm.bytecode.object}`)
		await ethereum.impersonateAccount(harness)
		for (const owner of owners) {
			await transact({ from: adminClient().account.address, to: harness, data: encodeFunctionData({ abi: harnessArtifact.abi, functionName: 'mint', args: [owner.account.address, WALLET] }) })
			await transact({ from: owner.account.address, to: token, data: encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'approve', args: [ledger, MAX_UINT] }) })
		}
	}
	const latestTimestamp = async () => (await adminClient().getBlock()).timestamp

	type Call = { from: Address; to: Address; data: `0x${string}`; value?: bigint }
	/** Mine one transaction at the next second. The shared wrapper polls receipts every 100 ms; this does not. */
	const transact = async (call: Call) => {
		const ethereum = getEthereum()
		const next = (await latestTimestamp()) + 1n
		await ethereum.request({ method: 'evm_setNextBlockTimestamp', params: [`0x${next.toString(16)}`] })
		const transaction = { from: call.from, to: call.to, data: call.data, value: `0x${(call.value ?? 0n).toString(16)}`, gas: '0x1c9c380', gasPrice: '0x0' }
		const hash = await ethereum.requestRaw({ method: 'eth_sendTransaction', params: [transaction] })
		for (let attempt = 0; attempt < 20_000; attempt++) {
			const receipt = await ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] })
			if (typeof receipt === 'object' && receipt !== null && 'status' in receipt) {
				if (receipt.status === '0x1') return
				// Replay the reverted call for its reason; the receipt, not the replay, decides the outcome.
				await ethereum.request({ method: 'eth_call', params: [transaction, 'latest'] })
				throw new Error('Transaction reverted without a replayable reason')
			}
			await new Promise(resolve => setTimeout(resolve, 0))
		}
		throw new Error('Transaction receipt missing')
	}
	const calls = async (op: Exclude<Operation, { c: 'time' }>): Promise<Call[]> => {
		const adminAddress = adminClient().account.address
		const asAdmin = (data: `0x${string}`, value?: bigint): Call => ({ from: adminAddress, to: harness, data, ...(value === undefined ? {} : { value }) })
		// A sponsored operation enters through the canonical feed (the harness) as a report operation.
		const sponsored = 'sponsored' in op && op.sponsored === true
		const asOwner = (o: number, data: `0x${string}`): Call => (sponsored ? { from: harness, to: ledger, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'executeReportOperation', args: [ownerAddress(o), data] }) } : { from: ownerAddress(o), to: ledger, data })
		const harnessAbi = harnessArtifact.abi
		const capitalAbi = capitalArtifact.abi
		switch (op.c) {
			case 'priceError':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'setPriceError', args: [op.value] }))]
			case 'price':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'setPrice', args: [op.price, Number(op.until)] }))]
			case 'price2':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'checkpointAndSetPrices', args: [op.first, op.second, Number(op.until)] }))]
			case 'demand':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'setDemand', args: [op.value] }))]
			case 'syncDemand':
				// The harness has no wrapper; the impersonated portfolio calls the ledger directly.
				return [{ from: harness, to: ledger, data: encodeFunctionData({ abi: capitalAbi, functionName: 'synchronizeDemand', args: [op.value] }) }]
			case 'deposit':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'depositFor', args: [ownerAddress(op.o), op.amount] }))]
			case 'depositTarget':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'depositAndSetHealthTarget', args: [op.amount, op.target] }))]
			case 'withdraw':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'withdrawPrincipal', args: [op.amount, ownerAddress(op.to)] }))]
			case 'target':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'setHealthTarget', args: [op.target] }))]
			case 'commit':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'setCommitment', args: [op.value] }))]
			case 'serve':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'serveRetirement', args: [op.id] }))]
			case 'claim':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'claimEarnings' }))]
			case 'takeover':
				if (op.bounds === undefined) return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'takeOver', args: [op.id, op.k, op.minAward, op.maxOwn] }))]
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'takeOverWithBounds', args: [op.id, op.k, op.minAward, op.maxOwn, op.bounds] }))]
			case 'takeoverBid':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'takeOverAuctionBid', args: [op.bid, op.k, op.minAward, op.maxOwn, op.bounds] }))]
			case 'fundEth':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'fundFees' }), op.amount)]
			case 'fundRep':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'fundRepFees', args: [op.amount] }))]
			case 'creditTimed':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'creditFees' }), op.amount)]
			case 'checkpoint':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'checkpoint' }))]
			case 'materialize':
				return [asOwner(op.o, encodeFunctionData({ abi: capitalAbi, functionName: 'materializeAuctionBid', args: [op.bid] }))]
			case 'beginImport':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'beginImport' }))]
			case 'installAuction':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'mint', args: [ledger, op.lots * op.repPerLot] })), asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'installAuction', args: [adapter, op.lots, op.repPerLot, MINC] }))]
			case 'setBid':
				return [{ from: adminAddress, to: adapter, data: encodeFunctionData({ abi: adapterArtifact.abi, functionName: 'setBid', args: [op.bid, ownerAddress(op.o), op.health, op.lots] }) }]
			case 'importChoice':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'mint', args: [ledger, op.rep] })), asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'importChoice', args: [ownerAddress(op.o), { rep: op.rep, commitment: op.k, batch: op.batch, remainingCommitment: op.remaining }, op.target] }))]
			case 'finishImport':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'finishImport', args: [op.demand] }))]
			case 'fork': {
				const existing = await adminClient().readContract({ abi: zoltarArtifact.abi, address: zoltar, functionName: 'forkTime' })
				const at = existing === 0n ? (await latestTimestamp()) + 1n - op.back : existing
				if (op.freeze) return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'setFork', args: [at] }))]
				return [{ from: adminAddress, to: zoltar, data: encodeFunctionData({ abi: zoltarArtifact.abi, functionName: 'setFork', args: [at] }) }]
			}
			case 'export':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'exportChoice', args: [ownerAddress(op.o)] }))]
			case 'releaseBacking':
				return [asAdmin(encodeFunctionData({ abi: harnessAbi, functionName: 'releaseForkBacking' }))]
			default:
				throw new Error('Unknown operation')
		}
	}
	const send = async (op: Operation) => {
		if (op.c === 'time') return getEthereum().setTime((await latestTimestamp()) + op.dt)
		for (const call of await calls(op)) await transact(call)
	}
	/** Number of blocks an operation mines when it succeeds; each advances the clock by one second. */
	const blocksOf = (op: Operation) => (op.c === 'installAuction' || op.c === 'importChoice' ? 2n : 1n)

	// Pure-JS selector hashing and generic decoding dominate a per-step read, so call data is
	// cached and static return words are sliced directly; `verifyDecoding` checks the layouts
	// against the typed ABI decoder once per run.
	const encoded = new Map<string, `0x${string}`>()
	const cached = (key: string, encode: () => `0x${string}`) => {
		const hit = encoded.get(key)
		if (hit !== undefined) return hit
		const data = encode()
		encoded.set(key, data)
		return data
	}
	const word = (data: string, offset: number) => {
		if (data.length < 2 + 64 * (offset + 1)) throw new Error('Return data too short')
		return BigInt(`0x${data.slice(2 + 64 * offset, 66 + 64 * offset)}`)
	}
	const accountFrom = (data: string) => ({ owner: addressString(word(data, 0)), batch: word(data, 1), rep: word(data, 2), commitment: word(data, 3), maxHealthyPrice: word(data, 4), releasedRep: word(data, 5), ethFees: word(data, 6), repFees: word(data, 7), remainingCommitment: word(data, 8) })
	const ownerFrom = (data: string) => ({ freeAttoRep: word(data, 0), feesAttoEth: word(data, 1), feesAttoRep: word(data, 2), targetHealthFactorBps: word(data, 3), positionId: word(data, 4) })
	const tripleFrom = (data: string) => [word(data, 0), word(data, 1), word(data, 2)] as const
	const pairFrom = (data: string) => [word(data, 0), word(data, 1)] as const
	const verifyDecoding = async () => {
		const client = adminClient()
		const holder = ownerAddress(0)
		const account = await client.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [1n] })
		const owner = await client.readContract({ abi: capitalArtifact.abi, address: ledger, functionName: 'ownerAccount', args: [holder] })
		const sample = await read(1, 1, 0n)
		const decodedAccount = sample.accounts[0]
		const decodedOwner = sample.stored[0]
		if (decodedAccount === undefined || decodedOwner === undefined) throw new Error('Decoding sample missing')
		expect({ ...decodedAccount, batch: BigInt(account.batch), owner: account.owner.toLowerCase() }).toEqual({ ...account, batch: BigInt(account.batch), owner: account.owner.toLowerCase() })
		expect({ ...decodedOwner, positionId: BigInt(owner.positionId) }).toEqual({ ...owner, positionId: BigInt(owner.positionId) })
		expect(sample.collaterals[0]).toEqual(await client.readContract({ abi: capitalArtifact.abi, address: ledger, functionName: 'ownerCollateral', args: [holder] }))
		expect(sample.totals).toEqual(await client.readContract({ abi: capitalArtifact.abi, address: ledger, functionName: 'totals' }))
		expect(sample.repBalances[0]).toBe(await client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [holder] }))
	}
	/** The complete observable state in one aggregate call. */
	const read = async (count: number, positions: number, conservative: bigint) => {
		const capitalAbi = capitalArtifact.abi
		const indexAbi = indexArtifact.abi
		const feesAbi = streamsArtifact.abi
		const tokenAbi = tokenArtifact.abi
		const adapterAbi = adapterArtifact.abi
		const batch: { target: Address; allowFailure: boolean; callData: `0x${string}` }[] = []
		let returned: readonly { success: boolean; returnData: `0x${string}` }[] = []
		const add = <TValue>(target: Address, callData: `0x${string}`, decode: (data: string) => TValue) => {
			const offset = batch.length
			batch.push({ target, allowFailure: false, callData })
			return () => {
				const entry = returned[offset]
				if (entry === undefined) throw new Error(`Aggregate result ${offset} missing`)
				return decode(entry.returnData)
			}
		}
		const first = (data: string) => word(data, 0)
		const capitalScalar = (functionName: 'acceptedPrice' | 'conservativePrice' | 'liquidationPrice' | 'acceptedPriceEpoch' | 'demandAttoEth' | 'totalFreeAttoRep' | 'retirementCashAttoRep' | 'priceValidUntil' | 'frozen' | 'pendingBurnCash') =>
			add(
				ledger,
				cached(`capital.${functionName}`, () => encodeFunctionData({ abi: capitalAbi, functionName })),
				first,
			)
		const indexScalar = (functionName: 'currentBatch' | 'nextBatch' | 'lastPositionId') =>
			add(
				index,
				cached(`index.${functionName}`, () => encodeFunctionData({ abi: indexAbi, functionName })),
				first,
			)
		const feeScalar = (functionName: 'outstandingEth' | 'outstandingRep' | 'deferredEth' | 'deferredRep' | 'releasedThrough') =>
			add(
				streams,
				cached(`fees.${functionName}`, () => encodeFunctionData({ abi: feesAbi, functionName })),
				first,
			)
		const balance = (asset: Address, holder: Address) =>
			add(
				asset,
				cached(`balance.${asset}.${holder}`, () => encodeFunctionData({ abi: tokenAbi, functionName: 'balanceOf', args: [holder] })),
				first,
			)
		const accepted = capitalScalar('acceptedPrice')
		const conservativePrice = capitalScalar('conservativePrice')
		const liquidation = capitalScalar('liquidationPrice')
		const epoch = capitalScalar('acceptedPriceEpoch')
		const demand = capitalScalar('demandAttoEth')
		const totalFree = capitalScalar('totalFreeAttoRep')
		const retirementCash = capitalScalar('retirementCashAttoRep')
		const validUntil = capitalScalar('priceValidUntil')
		const frozen = capitalScalar('frozen')
		const pendingBurn = capitalScalar('pendingBurnCash')
		const totals = add(
			ledger,
			cached('capital.totals', () => encodeFunctionData({ abi: capitalAbi, functionName: 'totals' })),
			tripleFrom,
		)
		const indexTotals = add(
			index,
			cached('index.totals', () => encodeFunctionData({ abi: indexAbi, functionName: 'totals' })),
			pairFrom,
		)
		const currentBatch = indexScalar('currentBatch')
		const nextBatch = indexScalar('nextBatch')
		const lastPositionId = indexScalar('lastPositionId')
		const eligibleCommitment = add(
			index,
			cached(`index.eligible.${conservative}`, () => encodeFunctionData({ abi: indexAbi, functionName: 'eligibleCommitment', args: [conservative] })),
			first,
		)
		const eligibleActiveCommitment = add(
			index,
			cached(`index.eligibleActive.${conservative}`, () => encodeFunctionData({ abi: indexAbi, functionName: 'eligibleActiveCommitment', args: [conservative] })),
			first,
		)
		const outstandingEth = feeScalar('outstandingEth')
		const outstandingRep = feeScalar('outstandingRep')
		const deferredEth = feeScalar('deferredEth')
		const deferredRep = feeScalar('deferredRep')
		const releasedThrough = feeScalar('releasedThrough')
		const supply = add(
			token,
			cached('token.supply', () => encodeFunctionData({ abi: tokenAbi, functionName: 'totalSupply' })),
			first,
		)
		const mockEth = add(
			adapter,
			cached('mock.eth', () => encodeFunctionData({ abi: adapterAbi, functionName: 'ethFees' })),
			first,
		)
		const mockRep = add(
			adapter,
			cached('mock.rep', () => encodeFunctionData({ abi: adapterAbi, functionName: 'repFees' })),
			first,
		)
		const ids = Array.from({ length: positions }, (_unused, offset) => BigInt(offset + 1))
		const addresses = Array.from({ length: count }, (_unused, o) => ownerAddress(o))
		const accounts = ids.map(id =>
			add(
				index,
				cached(`index.account.${id}`, () => encodeFunctionData({ abi: indexAbi, functionName: 'accountOf', args: [id] })),
				accountFrom,
			),
		)
		const startedAt = ids.map(id =>
			add(
				index,
				cached(`index.started.${id}`, () => encodeFunctionData({ abi: indexAbi, functionName: 'liquidationStarted', args: [id] })),
				first,
			),
		)
		const stored = addresses.map(address =>
			add(
				ledger,
				cached(`capital.owner.${address}`, () => encodeFunctionData({ abi: capitalAbi, functionName: 'ownerAccount', args: [address] })),
				ownerFrom,
			),
		)
		const collaterals = addresses.map(address =>
			add(
				ledger,
				cached(`capital.collateral.${address}`, () => encodeFunctionData({ abi: capitalAbi, functionName: 'ownerCollateral', args: [address] })),
				tripleFrom,
			),
		)
		const repBalances = [...addresses, ledger, harness].map(address => balance(token, address))
		const wethBalances = [...addresses, ledger, burnAddress].map(address => balance(weth, address))
		const [aggregate, timestamp] = await Promise.all([adminClient().readContract({ abi: multicallArtifact.abi, address: multicall, functionName: 'aggregate3', args: [batch] }), latestTimestamp()])
		returned = aggregate
		return {
			accepted: accepted(),
			conservative: conservativePrice(),
			liquidation: liquidation(),
			epoch: epoch(),
			validUntil: validUntil(),
			demand: demand(),
			totalFree: totalFree(),
			retirementCash: retirementCash(),
			currentBatch: currentBatch(),
			nextBatch: nextBatch(),
			lastPositionId: lastPositionId(),
			eligibleCommitment: eligibleCommitment(),
			eligibleActiveCommitment: eligibleActiveCommitment(),
			outstandingEth: outstandingEth(),
			outstandingRep: outstandingRep(),
			deferredEth: deferredEth(),
			pendingBurn: pendingBurn(),
			deferredRep: deferredRep(),
			releasedThrough: releasedThrough(),
			supply: supply(),
			mockEth: mockEth(),
			mockRep: mockRep(),
			frozen: frozen() !== 0n,
			totals: totals(),
			indexTotals: indexTotals(),
			accounts: accounts.map(decode => decode()),
			startedAt: startedAt.map(decode => decode()),
			stored: stored.map(decode => decode()),
			collaterals: collaterals.map(decode => decode()),
			repBalances: repBalances.map(decode => decode()),
			wethBalances: wethBalances.map(decode => decode()),
			timestamp,
		}
	}
	/** The fork authority's view of an owner's choice, simulated before the export transaction. */
	const previewExport = async (o: number) => {
		try {
			return (await adminClient().simulateContract({ abi: capitalArtifact.abi, address: ledger, functionName: 'exportChoice', args: [ownerAddress(o)], account: harness })).result
		} catch (error) {
			if (!(error instanceof Error) || !/revert/i.test(error.message)) throw error
			return undefined
		}
	}
	return { deploy, send, read, verifyDecoding, previewExport, blocksOf, latestTimestamp, ownerAddress, wallet: WALLET, addresses: () => ({ harness, ledger, index, streams, token, weth, adapter }) }
}

// ---------------------------------------------------------------- comparison and properties

const revertReason = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error)
	for (const reason of KNOWN_REVERTS) if (message.includes(reason)) return reason
	return `UNKNOWN: ${message.slice(0, 200)}`
}
const within = (actual: bigint, scaled: bigint, dust: bigint) => abs(actual * SCALE - scaled) <= (dust + 1n) * SCALE

const compare = (m: Model, a: Snapshot, owners: number, addressOf: (o: number) => Address, adapter: Address) => {
	const issues: string[] = []
	const check = (tag: string, actual: unknown, expected: unknown) => {
		if (actual !== expected) issues.push(`${tag}: actual ${String(actual)} expected ${String(expected)}`)
	}
	check('CLOCK', a.timestamp, m.now)
	check('PRICE.accepted', a.accepted, m.accepted)
	check('PRICE.conservative', a.conservative, m.cons)
	check('PRICE.liquidation', a.liquidation, m.liq)
	check('PRICE.epoch', a.epoch, m.epoch)
	check('PRICE.validUntil', a.validUntil, m.validUntil)
	check('DEMAND', a.demand, m.demand)
	check('FREE.total', a.totalFree, m.totalFree)
	check('RETIREMENT.cash', a.retirementCash, m.retCash)
	check('FROZEN', a.frozen, m.frozen)
	check('INDEX.rep', a.indexTotals[0], totalRep(m))
	check('INDEX.commitment', a.indexTotals[1], totalCommitment(m))
	check('TOTALS.healthy', a.totals[2], priceValid(m) ? eligible(m, m.cons) : 0n)
	check('ELIGIBLE', a.eligibleCommitment, eligible(m, m.cons))
	check('ELIGIBLE.active', a.eligibleActiveCommitment, eligibleActive(m, m.cons))
	check('POSITIONS.count', a.lastPositionId, BigInt(m.positions.length))
	check('STREAM.releasedThrough', a.releasedThrough, m.importing ? a.releasedThrough : m.releasedThrough)
	const [releasedEth, releasedRep] = integral(m, m.releasedThrough)
	check('STREAM.outstandingEth', a.outstandingEth, m.streams.reduce((sum, stream) => sum + stream.eth, 0n) - releasedEth)
	check('STREAM.outstandingRep', a.outstandingRep, m.streams.reduce((sum, stream) => sum + stream.rep, 0n) - releasedRep)
	check('STREAM.deferredEth', a.deferredEth, 0n)
	check('STREAM.deferredRep', a.deferredRep, 0n)
	check('BATCH.current', a.currentBatch, m.currentBatch)
	check('BATCH.next', a.nextBatch, m.nextBatch)
	let pendingEth = 0n
	let pendingRep = 0n
	let sumRep = 0n
	let sumCommitment = 0n
	let unclaimedRelease = 0n
	for (const p of m.positions) {
		const account = a.accounts[Number(p.id) - 1]
		if (account === undefined) continue
		const tag = `POSITION[${p.id}]`
		check(`${tag}.owner`, account.owner.toLowerCase(), (p.owner === ADAPTER ? adapter : addressOf(p.owner)).toLowerCase())
		check(`${tag}.rep`, account.rep, inTree(p) ? p.rep : 0n)
		check(`${tag}.commitment`, account.commitment, inTree(p) ? p.k : 0n)
		check(`${tag}.released`, account.releasedRep, p.retired && !p.repClaimed ? p.rep : 0n)
		if (inTree(p)) {
			check(`${tag}.batch`, account.batch, p.batch)
			check(`${tag}.maxHealthyPrice`, account.maxHealthyPrice, p.price)
			check(`${tag}.remaining`, account.remainingCommitment, p.remaining)
			// The stored key must be the exact threshold of the stored principal and commitment.
			check(`${tag}.key`, account.maxHealthyPrice, maxHealthyPrice(account.rep, account.commitment))
		}
		check(`LIQUIDATION[${p.id}].started`, a.startedAt[Number(p.id) - 1], started(m, p.id))
		if (!within(account.ethFees, p.ethFees, p.dust)) issues.push(`FEES.position[${p.id}].eth: actual ${account.ethFees} model ${p.ethFees / SCALE} dust ${p.dust}`)
		if (!within(account.repFees, p.repFees, p.dust)) issues.push(`FEES.position[${p.id}].rep: actual ${account.repFees} model ${p.repFees / SCALE} dust ${p.dust}`)
		pendingEth += account.ethFees
		pendingRep += account.repFees
		sumRep += account.rep
		sumCommitment += account.commitment
		unclaimedRelease += account.releasedRep
	}
	// (b) aggregates are exactly the sum of the positions, independent of the model.
	check('SUM.rep', a.indexTotals[0], sumRep)
	check('SUM.commitment', a.indexTotals[1], sumCommitment)
	check('SUM.released', a.retirementCash, unclaimedRelease)
	check('TOTALS.rep', a.totals[0], a.indexTotals[0])
	check('TOTALS.commitment', a.totals[1], a.indexTotals[1])
	let free = 0n
	let ownerEth = 0n
	let ownerRep = 0n
	let earnedEth = 0n
	let earnedRep = 0n
	for (let o = 0; o < owners; o++) {
		const owner = ownerOf(m, o)
		const stored = a.stored[o]
		const actualCollateral = a.collaterals[o]
		if (stored === undefined || actualCollateral === undefined) throw new Error('Owner read missing')
		const tag = `OWNER[${o}]`
		const bid = virtualBid(m, o)
		check(`${tag}.free`, stored.freeAttoRep, owner.free)
		check(`${tag}.positionId`, stored.positionId, owner.positionId)
		check(`${tag}.target`, stored.targetHealthFactorBps, bid === undefined ? owner.target : bid.health)
		const expected = collateral(m, o)
		check(`${tag}.principal`, actualCollateral[0], expected.principal)
		check(`${tag}.commitment`, actualCollateral[1], expected.commitment)
		check(`${tag}.withdrawable`, actualCollateral[2], expected.withdrawable)
		check(`${tag}.wallet`, a.repBalances[o], owner.walletRep)
		check(`${tag}.claimedEth`, a.wethBalances[o], owner.claimedEth)
		const p = findPosition(m, owner.positionId)
		const account = owner.positionId === 0n ? undefined : a.accounts[Number(owner.positionId) - 1]
		const actualEth = owner.claimedEth + stored.feesAttoEth + (account === undefined ? 0n : account.ethFees)
		const actualRep = owner.claimedRep + stored.feesAttoRep + (account === undefined ? 0n : account.repFees)
		const dust = owner.dust + (p === undefined ? 0n : p.dust)
		// (c) each owner's lifetime earnings equal its exact pro-rata share of every healthy interval.
		if (!within(actualEth, owner.settledEth + (p === undefined ? 0n : p.ethFees), dust)) issues.push(`FEES.owner[${o}].eth: actual ${actualEth} model ${(owner.settledEth + (p === undefined ? 0n : p.ethFees)) / SCALE} dust ${dust}`)
		if (!within(actualRep, owner.settledRep + (p === undefined ? 0n : p.repFees), dust)) issues.push(`FEES.owner[${o}].rep: actual ${actualRep} model ${(owner.settledRep + (p === undefined ? 0n : p.repFees)) / SCALE} dust ${dust}`)
		free += stored.freeAttoRep
		ownerEth += stored.feesAttoEth
		ownerRep += stored.feesAttoRep
		earnedEth += owner.claimedEth
		earnedRep += owner.claimedRep
	}
	check('SUM.free', a.totalFree, free)
	const ledgerRep = a.repBalances[owners]
	const ledgerEth = a.wethBalances[owners]
	const burnedEth = a.wethBalances[owners + 1]
	if (ledgerRep === undefined || ledgerEth === undefined || burnedEth === undefined) throw new Error('Balance read missing')
	// (a) custody: every REP and collateral unit the ledger holds has exactly one claimant.
	check('CONSERVATION.rep', ledgerRep + (m.backingReleased ? m.frozenBacking : 0n), a.indexTotals[0] + a.totalFree + a.retirementCash + pendingRep + ownerRep + a.mockRep + a.outstandingRep + a.deferredRep)
	check('CONSERVATION.eth', ledgerEth, pendingEth + ownerEth + a.mockEth + a.outstandingEth + a.deferredEth + a.pendingBurn)
	// (c) every funded unit is credited, still vesting, or burned: no dust is created or lost.
	check('FEES.totalEth', pendingEth + ownerEth + a.mockEth + earnedEth + burnedEth + a.outstandingEth + a.deferredEth + a.pendingBurn, m.fundedEth)
	check('FEES.unassignedEth', burnedEth + a.pendingBurn, m.unassignedEth)
	const burnedRep = m.genesisSupply + m.fundedRep + m.mintedToLedger - a.supply
	check('FEES.totalRep', pendingRep + ownerRep + a.mockRep + earnedRep + burnedRep + a.outstandingRep + a.deferredRep, m.fundedRep)
	check('FEES.burnedRep', burnedRep, m.burnedRep)
	// (b) commitment never falls below demand.
	if (a.indexTotals[1] < a.demand && !m.everImported) issues.push(`SOLVENCY.total: commitment ${a.indexTotals[1]} below demand ${a.demand}`)
	return issues
}

const principalOf = (a: Snapshot, o: number) => a.collaterals[o]?.[0] ?? 0n

/** Independent transition properties over the chain state before and after one successful step. */
const properties = (before: Snapshot, after: Snapshot, op: Operation, owners: number, result: TakeoverResult | undefined, unmaterialized: (o: number) => boolean) => {
	const issues: string[] = []
	if (op.c === 'beginImport' || op.c === 'installAuction' || op.c === 'setBid' || op.c === 'importChoice' || op.c === 'finishImport') return issues
	// (b) a non-price operation never deepens an existing shortfall of healthy commitment.
	if (op.c !== 'price' && op.c !== 'price2' && before.conservative === after.conservative) {
		const shortfallBefore = before.demand > before.eligibleCommitment ? before.demand - before.eligibleCommitment : 0n
		const shortfallAfter = after.demand > after.eligibleCommitment ? after.demand - after.eligibleCommitment : 0n
		if (shortfallAfter > shortfallBefore) issues.push(`SOLVENCY.shortfall: ${op.c} grew the healthy shortfall from ${shortfallBefore} to ${shortfallAfter}`)
	}
	// (b) cohort order: while the cohort that was current still has members, the next cohort is
	// served only through an explicit action on one of its positions, and a targeted service
	// leaves every earlier healthy request of the current cohort fully reserved.
	const bulkOnly = op.c === 'deposit' || op.c === 'depositTarget' || op.c === 'demand' || (op.c === 'serve' && op.id === 0n)
	const currentRemains = before.currentBatch !== 0n && after.accounts.some(account => account.commitment !== 0n && account.batch === before.currentBatch)
	if (currentRemains && (bulkOnly || op.c === 'serve')) {
		for (let offset = 0; offset < before.accounts.length; offset++) {
			const was = before.accounts[offset]
			const now = after.accounts[offset]
			if (was === undefined || now === undefined || was.commitment === 0n || was.batch !== before.nextBatch) continue
			if (now.commitment < was.commitment && !(op.c === 'serve' && op.id === BigInt(offset + 1))) issues.push(`ORDER.cohort: ${op.c} reduced next-cohort position ${offset + 1} while the current cohort still has members`)
		}
	}
	if (op.c === 'serve' && op.id !== 0n && after.timestamp < after.validUntil) {
		const target = before.accounts[Number(op.id) - 1]
		const served = after.accounts[Number(op.id) - 1]
		if (target !== undefined && served !== undefined && served.commitment < target.commitment) {
			const spare = after.eligibleCommitment > after.demand ? after.eligibleCommitment - after.demand : 0n
			let reserved = 0n
			for (const account of after.accounts) {
				if (account.commitment === 0n || account.batch === 0n || account.maxHealthyPrice < after.conservative) continue
				const earlierCohort = account.batch !== target.batch && account.batch === before.currentBatch
				const earlierInCohort = account.batch === target.batch && target.maxHealthyPrice >= before.conservative && account.maxHealthyPrice > target.maxHealthyPrice
				const anyHealthyBeforeUnhealthy = account.batch === target.batch && target.maxHealthyPrice < before.conservative
				if (earlierCohort || earlierInCohort || anyHealthyBeforeUnhealthy) reserved += account.commitment - account.remainingCommitment
			}
			if (spare < reserved) issues.push(`ORDER.reserved: targeted service of ${op.id} left spare ${spare} below earlier healthy requests ${reserved}`)
			if (after.eligibleCommitment < after.demand) issues.push(`ORDER.demand: targeted service of ${op.id} left healthy ${after.eligibleCommitment} below demand ${after.demand}`)
		}
	}
	const paid = result !== undefined && !result.cured ? result : undefined
	let sum = 0n
	for (let o = 0; o < owners; o++) {
		const delta = principalOf(after, o) - principalOf(before, o)
		sum += delta
		let expected = 0n
		if ((op.c === 'deposit' || op.c === 'depositTarget') && op.o === o) expected = op.amount
		if (op.c === 'withdraw' && op.o === o) expected = -op.amount
		if (paid !== undefined && (op.c === 'takeover' || op.c === 'takeoverBid')) {
			if (op.o === o) expected = paid.award
			if (paid.sourceOwner === o) expected = -paid.award
		}
		// (a)(d) repair never transfers principal ownership; deposits and withdrawals
		// change principal exactly once.
		if (delta !== expected) issues.push(`PRINCIPAL[${o}]: ${op.c} moved principal by ${delta}, expected ${expected}`)
		// (b) an owner's own action that removes backing or adds exposure leaves it at or above its target.
		const stored = after.stored[o]
		const storedBefore = before.stored[o]
		// An unmaterialized auction vault reports its bid's target while its own account still has none.
		if (stored === undefined || storedBefore === undefined || !('o' in op) || op.o !== o || unmaterialized(o)) continue
		if (op.c !== 'withdraw' && op.c !== 'commit' && op.c !== 'target' && op.c !== 'depositTarget' && op.c !== 'takeover' && op.c !== 'takeoverBid') continue
		const account = stored.positionId === 0n ? undefined : after.accounts[Number(stored.positionId) - 1]
		const accountBefore = storedBefore.positionId === 0n ? undefined : before.accounts[Number(storedBefore.positionId) - 1]
		if (account === undefined || account.commitment === 0n || after.timestamp >= after.validUntil) continue
		const health = stored.targetHealthFactorBps === 0n ? BPS : stored.targetHealthFactorBps
		const healthBefore = storedBefore.targetHealthFactorBps === 0n ? BPS : storedBefore.targetHealthFactorBps
		const riskier = accountBefore === undefined || account.rep < accountBefore.rep || account.commitment > accountBefore.commitment || health > healthBefore
		const required = requiredRep(account.commitment, after.conservative, health)
		if (riskier && account.rep < required) issues.push(`HEALTH.voluntary[${o}]: ${op.c} left principal ${account.rep} below required ${required}`)
		// A position admitted at its target is always counted as healthy capacity and never in distress.
		if (riskier && account.maxHealthyPrice < after.conservative) issues.push(`HEALTH.eligible[${o}]: ${op.c} left threshold ${account.maxHealthyPrice} below the conservative price ${after.conservative}`)
	}
	if (paid !== undefined && sum !== 0n) issues.push(`TAKEOVER.conservation: principal changed by ${sum}`)
	if (paid !== undefined && 'id' in op) {
		const source = before.accounts[Number(op.id) - 1]
		// (d) the award never exceeds the source position's own principal.
		if (source !== undefined && op.c === 'takeover' && paid.award > source.rep) issues.push(`TAKEOVER.award: ${paid.award} exceeds the source principal ${source.rep}`)
	}
	// (d) an unpaid cure leaves its target out of distress and pays the caller nothing.
	if (result?.cured && op.c === 'takeover') {
		if (after.startedAt[Number(op.id) - 1] !== 0n) issues.push(`TAKEOVER.cure: position ${op.id} is still in distress after an unpaid cure`)
		const cured = after.accounts[Number(op.id) - 1]
		if (cured !== undefined && cured.commitment !== 0n && cured.maxHealthyPrice < after.liquidation) issues.push(`TAKEOVER.cure: position ${op.id} is still below the liquidation price`)
	}
	// (a)(b) the withdrawable view is exact: more than it reports never leaves the ledger.
	// An unmaterialized auction vault is excluded: its view already includes the bid that the
	// production vault always materializes before it acts, which this harness's plain accounts do not.
	if (op.c === 'withdraw' && !unmaterialized(op.o)) {
		const view = before.collaterals[op.o]?.[2] ?? 0n
		if (op.amount > view) issues.push(`WITHDRAW.exceeds[${op.o}]: paid ${op.amount} above the reported withdrawable ${view}`)
	}
	return issues
}

// ---------------------------------------------------------------- runner

type Outcome = { failure: { tag: string; issues: string[]; step: number } | undefined; trace: Operation[] }

describe('audit fuzz: capital ledger against a naive reference model', () => {
	const node = useIsolatedAnvilNode()
	const driver = createDriver(node.getAnvilWindowEthereum)
	let baseline = ''
	let genesis = 0n
	let genesisReleasedThrough = 0n
	let genesisSupply = 0n

	beforeAll(async () => {
		await driver.deploy()
		genesis = await driver.latestTimestamp()
		const initial = await driver.read(0, 0, 0n)
		genesisReleasedThrough = initial.releasedThrough
		genesisSupply = initial.supply
		await node.setBaselineSnapshot()
	})
	const reset = async () => {
		const ethereum = node.getAnvilWindowEthereum()
		if (baseline !== '') await ethereum.anvilRevert(baseline)
		baseline = await ethereum.anvilSnapshot()
	}

	/** Run fixed operations (replay or shrink) or generate them from the seed while running. */
	const run = async (seed: number, steps: number, fixed: Operation[] | undefined): Promise<Outcome> => {
		await reset()
		const random = createRandom(seed)
		const scenario = createScenario(random, steps, genesis)
		const owners = scenario.owners
		let m = newModel(genesis, genesisReleasedThrough, driver.wallet, genesisSupply)
		let snapshot = await driver.read(owners, 0, 0n)
		const trace: Operation[] = []
		const plan: Plan = { next: undefined }
		const total = fixed === undefined ? scenario.setup.length + scenario.steps : fixed.length
		for (let step = 0; step < total; step++) {
			let op: Operation
			if (fixed !== undefined) {
				const next = fixed[step]
				if (next === undefined) throw new Error('Replay operation missing')
				op = next
			} else if (step < scenario.setup.length) {
				const next = scenario.setup[step]
				if (next === undefined) throw new Error('Setup operation missing')
				op = next
			} else if (step - scenario.setup.length < scenario.bootstrap && phaseOf(m) === 'open') op = bootstrap(m, random, owners, step - scenario.setup.length)
			else if (scenario.forkAt !== undefined && step - scenario.setup.length === scenario.forkAt && phaseOf(m) === 'open') op = { c: 'fork', back: random.pick([0n, 0n, 1n, 30n]), freeze: random.chance(0.7) }
			else if (plan.next !== undefined) {
				op = plan.next(m)
				plan.next = undefined
			} else op = generate(m, random, owners, plan)
			if (fixed === undefined && 'sponsored' in op === false && (op.c === 'deposit' || op.c === 'withdraw' || op.c === 'target' || op.c === 'commit' || op.c === 'serve' || op.c === 'claim' || op.c === 'takeover') && random.chance(0.06)) {
				op = { ...op, sponsored: true }
				if (op.c === 'takeover' && op.bounds !== undefined && random.chance(0.5)) op = { ...op, bounds: { ...op.bounds, expectedAcceptedPriceEpoch: 0n } }
			}
			trace.push(op)
			let exportIssue: string | undefined
			if (op.c === 'export') {
				const owner = ownerOf(m, op.o)
				const preview = await driver.previewExport(op.o)
				const exported = structuredClone(m)
				exported.now += 1n
				// An export renumbers the current cohort to 1 and the next one to 2.
				const exportedBatch = (batch: bigint) => {
					if (batch === 0n) return 0n
					return batch === exported.currentBatch ? 1n : 2n
				}
				let position: ModelPosition | undefined
				try {
					applyModel(exported, op)
					position = findPosition(exported, ownerOf(exported, op.o).positionId)
				} catch (error) {
					if (!(error instanceof ModelRevert)) throw error
				}
				if (preview !== undefined && m.frozen && !owner.exported) {
					const [choice, target] = preview
					const expectedChoice = position === undefined ? { rep: 0n, commitment: 0n, batch: 0n, remainingCommitment: 0n } : { rep: position.rep, commitment: position.k, batch: exportedBatch(position.batch), remainingCommitment: position.remaining }
					const actualChoice = { rep: choice.rep, commitment: choice.commitment, batch: BigInt(choice.batch), remainingCommitment: choice.remainingCommitment }
					if (stringify(actualChoice) !== stringify(expectedChoice) || target !== targetOf(ownerOf(exported, op.o))) exportIssue = `EXPORT: choice ${stringify(actualChoice)} target ${target}, expected ${stringify(expectedChoice)} target ${targetOf(ownerOf(exported, op.o))}`
				}
			}
			const next = structuredClone(m)
			let expected: string | undefined
			let result: TakeoverResult | undefined
			if (op.c === 'time') next.now += op.dt
			else {
				next.now += driver.blocksOf(op)
				try {
					result = applyModel(next, op)
				} catch (error) {
					if (!(error instanceof ModelRevert)) throw error
					expected = error.reason
				}
			}
			let actual: string | undefined
			try {
				await driver.send(op)
			} catch (error) {
				actual = revertReason(error)
			}
			const issues: string[] = []
			if (exportIssue !== undefined) issues.push(exportIssue)
			// (e) liveness and revert classification.
			if (expected === 'TOKEN' && actual !== undefined) actual = expected
			if (actual?.startsWith('UNKNOWN')) issues.push(`UNKNOWN-REVERT: ${op.c} reverted with ${actual}`)
			else if (expected === undefined && actual !== undefined) issues.push(`LIVENESS: ${op.c} must succeed but reverted with '${actual}'`)
			else if (expected !== undefined && actual === undefined) issues.push(`UNEXPECTED-SUCCESS: ${op.c} must revert with '${expected}'`)
			else if (expected !== undefined && actual !== undefined && expected !== actual) issues.push(`REVERT-REASON: ${op.c} reverted with '${actual}', model expects '${expected}'`)
			// (e) whatever the ledger reports as withdrawable can be withdrawn one block later while the
			// price it was computed at is still fresh.
			if (op.c === 'withdraw' && actual !== undefined && op.amount !== 0n && op.amount <= (snapshot.collaterals[op.o]?.[2] ?? 0n) && (op.amount <= (snapshot.stored[op.o]?.freeAttoRep ?? 0n) || next.now < snapshot.validUntil) && !m.importing && virtualBid(m, op.o) === undefined)
				issues.push(`WITHDRAW.view[${op.o}]: ${op.amount} within the reported withdrawable reverted with '${actual}'`)
			// (e) an owner of an active position can always ask for a full exit or for any reduction that
			// keeps the economic minimum on both sides, at a fresh or a stale price.
			if (op.c === 'commit' && actual !== undefined && phaseOf(m) === 'open') {
				const held = findPosition(m, ownerOf(m, op.o).positionId)
				if (held !== undefined && inTree(held) && held.batch === 0n && op.value < held.k && (op.value === 0n || (op.value >= MINC && held.k - op.value >= MINC))) issues.push(`LIVENESS.reduce[${op.o}]: lowering ${held.k} to ${op.value} reverted with '${actual}'`)
			}
			const succeeded = actual === undefined && expected === undefined
			if (succeeded) m = next
			else {
				// A reverted transaction is still mined and advances the clock.
				m = structuredClone(m)
				m.now = await driver.latestTimestamp()
			}
			const after = await driver.read(owners, m.positions.length, m.cons)
			if (op.c === 'claim' && succeeded) {
				// Payouts are fed back from the chain: the model checks each owner's lifetime total.
				const owner = ownerOf(m, op.o)
				const paidEth = (after.wethBalances[op.o] ?? 0n) - owner.claimedEth
				const paidRep = (after.repBalances[op.o] ?? 0n) - owner.walletRep
				if (paidEth < 0n || paidRep < 0n) issues.push(`CLAIM: negative payout ${paidEth} ${paidRep}`)
				owner.claimedEth += paidEth
				owner.claimedRep += paidRep
				owner.walletRep += paidRep
				const stored = after.stored[op.o]
				if (stored !== undefined && (stored.feesAttoEth !== 0n || stored.feesAttoRep !== 0n)) issues.push('CLAIM: fees remained after a claim')
			}
			if (issues.length === 0) {
				issues.push(...compare(m, after, owners, driver.ownerAddress, driver.addresses().adapter))
				if (succeeded && op.c !== 'time') issues.push(...properties(snapshot, after, op, owners, result, o => virtualBid(m, o) !== undefined))
			}
			snapshot = after
			if (issues.length !== 0) {
				const first = issues[0] ?? 'UNKNOWN'
				return { failure: { tag: first.split(/[:[.]/)[0] ?? first, issues, step }, trace }
			}
		}
		return { failure: undefined, trace }
	}

	const shrink = async (seed: number, steps: number, trace: Operation[], tag: string) => {
		let current = trace
		let attempts = 0
		const fails = async (candidate: Operation[]) => {
			attempts++
			const outcome = await run(seed, steps, candidate)
			return outcome.failure !== undefined && outcome.failure.tag === tag ? outcome.trace.slice(0, outcome.failure.step + 1) : undefined
		}
		for (let chunk = Math.max(1, Math.floor(current.length / 2)); chunk >= 1 && attempts < 400; chunk = Math.floor(chunk / 2)) {
			for (let start = 0; start < current.length && attempts < 400; ) {
				const candidate = [...current.slice(0, start), ...current.slice(start + chunk)]
				const reduced = candidate.length === current.length ? undefined : await fails(candidate)
				if (reduced !== undefined) current = reduced
				else start += chunk
			}
			if (chunk === 1) break
		}
		return current
	}

	test('random operation sequences keep the ledger equal to the reference model and every invariant intact', async () => {
		// The shared fixture reverts to its own snapshot before each test, which consumes ours.
		baseline = ''
		const firstSeed = Number(process.env['AUDIT_FUZZ_SEED_START'] ?? '1')
		const requested = process.env['AUDIT_FUZZ_SEEDS']
		const steps = Number(process.env['AUDIT_FUZZ_STEPS'] ?? '70')
		const budget = Number(process.env['AUDIT_FUZZ_BUDGET_MS'] ?? '10000')
		const startedAt = Date.now()
		const failures: string[] = []
		for (let seed = firstSeed; requested === undefined ? Date.now() - startedAt < budget : seed < firstSeed + Number(requested); seed++) {
			const outcome = await run(seed, steps, undefined)
			if (seed === firstSeed) await driver.verifyDecoding()
			if (outcome.failure === undefined) continue
			const failing = outcome.trace.slice(0, outcome.failure.step + 1)
			const minimal = process.env['AUDIT_FUZZ_SHRINK'] === '0' ? failing : await shrink(seed, steps, failing, outcome.failure.tag)
			const replay = await run(seed, steps, minimal)
			const report = [
				`seed ${seed} step ${outcome.failure.step} tag ${outcome.failure.tag}`,
				...outcome.failure.issues.slice(0, 12),
				`minimal sequence (${minimal.length} operations, owners ${createScenario(createRandom(seed), steps, genesis).owners}):`,
				...minimal.map((op, position) => `  ${position}: ${stringify(op)}`),
				'issues on the minimal sequence:',
				...(replay.failure?.issues.slice(0, 12) ?? ['(did not reproduce)']),
			].join('\n')
			console.log(`\nFUZZ FAILURE\n${report}\n`)
			failures.push(report)
			if (failures.length >= Number(process.env['AUDIT_FUZZ_MAX_FAILURES'] ?? '3')) break
		}
		expect(failures).toEqual([])
	})
})
