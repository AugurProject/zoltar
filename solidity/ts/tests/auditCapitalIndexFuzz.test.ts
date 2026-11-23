import { auditFuzzSeeds, positiveFuzzInteger } from './auditFuzzBudget'
import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_Multicall3_Multicall3 as multicallArtifact,
	test_statoblast_CommitmentIndexHarness_CommitmentIndexHarness as harnessArtifact,
	test_statoblast_CapitalFeeStreamsHarness_CapitalFeeStreamsHarness as streamsHarnessArtifact,
	statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as streamsArtifact,
} from '../types/contractArtifact'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

// Seeded stateful fuzz of the commitment index and the fee streams on their own harnesses.
//
// `securityPoolCommitmentIndex.test.ts` already compares create, replace, observation and fee
// credits with a naive live ledger over 80 steps. This extends that model to everything else
// the index does: retirement requests, owner-targeted service, cohort promotion, splits and
// merges, cures, claims and liquidation clocks. Trees hold up to a few hundred leaves with
// clustered, equal and full-width keys, prices and demand are arbitrary per call, and the
// harness's structural validator runs after every step.
// Long run: AUDIT_FUZZ_SEEDS=<n> AUDIT_FUZZ_SEED_START=1 AUDIT_FUZZ_STEPS=260 AUDIT_FUZZ_SHRINK=0 (skip shrinking) bun ./tooling/testing/bun-test.mts --timeout 3600000 solidity/ts/tests/auditCapitalIndexFuzz.test.ts

const MAX_UINT = (1n << 256n) - 1n
const SCALE = 1n << 96n
const WAD = 10n ** 18n
const BPS = 10_000n
// Tolerated base units of tree rounding per credit event a position takes part in.
const DUST_PER_CREDIT = 24n
const STATUS = ['NotRetiring', 'ImportsOpen', 'DemandExceedsHealthy', 'EarlierRequests', 'InsufficientSpare', 'Ready'] as const

const min = (a: bigint, b: bigint) => (a < b ? a : b)
const max = (a: bigint, b: bigint) => (a > b ? a : b)
const abs = (a: bigint) => (a < 0n ? -a : a)
const ascending = (a: bigint, b: bigint) => {
	if (a < b) return -1
	return a > b ? 1 : 0
}

class ModelRevert extends Error {
	constructor(readonly reason: string) {
		super(reason)
	}
}
const requireModel = (condition: boolean, reason: string) => {
	if (!condition) throw new ModelRevert(reason)
}

type Position = { id: bigint; order: bigint; batch: bigint; rep: bigint; k: bigint; price: bigint; remaining: bigint; retired: boolean; repClaimed: boolean; distress: bigint | undefined; ethFees: bigint; repFees: bigint; dust: bigint; paidRep: bigint; paidEth: bigint; paidRepFees: bigint }
type Model = {
	now: bigint
	lastOrder: bigint
	positions: Position[]
	currentBatch: bigint
	nextBatch: bigint
	lastBatch: bigint
	observedPrice: bigint
	importsOpen: boolean
	imported: boolean
	released: bigint
	retiredCommitment: bigint
	creditedEth: bigint
	creditedRep: bigint
	unassignedEth: bigint
	unassignedRep: bigint
}

const find = (m: Model, id: bigint) => (id === 0n ? undefined : m.positions[Number(id) - 1])
const inTree = (p: Position) => !p.retired && p.k !== 0n
const live = (m: Model) => m.positions.filter(inTree)
const cohort = (m: Model, batch: bigint) =>
	live(m)
		.filter(p => p.batch === batch)
		.sort((a, b) => ascending(a.price, b.price) || ascending(a.id, b.id))
const eligible = (m: Model, price: bigint) => live(m).reduce((sum, p) => sum + (p.price >= price ? p.k : 0n), 0n)
const activeCommitment = (p: { batch: bigint; k: bigint; remaining: bigint }) => (p.batch === 0n ? p.k : p.remaining)
const eligibleActive = (m: Model, price: bigint) => live(m).reduce((sum, p) => sum + (p.price >= price ? activeCommitment(p) : 0n), 0n)
const started = (m: Model, p: Position) => (!inTree(p) || p.price >= m.observedPrice ? 0n : (p.distress ?? 0n))
const operational = (m: Model) => requireModel(!m.importsOpen, 'Commitment imports are open')
const known = (m: Model, id: bigint) => {
	const p = find(m, id)
	if (p === undefined) throw new ModelRevert('Unknown commitment position')
	return p
}
const reinsert = (p: Position) => {
	if (p.remaining !== 0n && p.k <= p.remaining) {
		p.remaining = 0n
		p.batch = 0n
	}
}
const create = (m: Model, batch: bigint, rep: bigint, k: bigint, price: bigint, remaining: bigint) => {
	requireModel(k !== 0n, 'Invalid commitment position')
	const id = BigInt(m.positions.length + 1)
	m.positions.push({ id, order: batch === 0n ? 0n : ++m.lastOrder, batch, rep, k, price, remaining, retired: false, repClaimed: false, distress: undefined, ethFees: 0n, repFees: 0n, dust: 0n, paidRep: 0n, paidEth: 0n, paidRepFees: 0n })
	return id
}
const replace = (m: Model, id: bigint, rep: bigint, k: bigint, price: bigint) => {
	operational(m)
	const p = known(m, id)
	requireModel(inTree(p), 'Position is not live')
	if (p.batch === m.currentBatch && m.currentBatch !== 0n) requireModel(k <= p.k, 'Closed retirement commitment cannot increase')
	p.rep = rep
	p.k = k
	p.price = price
	if (k === 0n) requireModel(rep === 0n, 'Uncommitted REP must leave index')
	reinsert(p)
}
const promote = (m: Model) => {
	if (m.currentBatch !== 0n && cohort(m, m.currentBatch).length !== 0) return
	m.currentBatch = 0n
	if (cohort(m, m.nextBatch).length === 0) return
	m.currentBatch = m.nextBatch
	m.nextBatch = ++m.lastBatch
}
const preview = (m: Model, id: bigint, price: bigint, demand: bigint) => {
	let effective = m.currentBatch
	if (effective === 0n || cohort(m, effective).length === 0) effective = cohort(m, m.nextBatch).length === 0 ? 0n : m.nextBatch
	const p = find(m, id)
	if (p === undefined || !inTree(p) || p.batch === 0n) return { status: 'NotRetiring' as const, reduction: 0n, ahead: 0n, effective }
	const reduction = p.k - p.remaining
	const healthy = eligible(m, price)
	const spare = healthy > demand ? healthy - demand : 0n
	const ahead = live(m)
		.filter(q => q.batch !== 0n && q.order < p.order)
		.reduce((sum, q) => sum + q.k - q.remaining, 0n)
	const statusOf = (): (typeof STATUS)[number] => {
		if (m.importsOpen) return 'ImportsOpen'
		if (healthy < demand) return 'DemandExceedsHealthy'
		if (spare < ahead) return 'EarlierRequests'
		return p.price >= price && spare - ahead < reduction ? 'InsufficientSpare' : 'Ready'
	}
	const status = statusOf()
	return { status, reduction, ahead, effective }
}
const retire = (m: Model, price: bigint, demand: bigint, id: bigint) => {
	operational(m)
	if (id === 0n) return
	const result = preview(m, id, price, demand)
	requireModel(result.status !== 'NotRetiring', 'Position is not retiring')
	promote(m)
	if (result.status !== 'Ready') return
	const p = known(m, id)
	m.retiredCommitment += result.reduction
	if (p.remaining === 0n) {
		m.released += p.rep
		p.retired = true
	} else {
		p.k = p.remaining
		reinsert(p)
	}
}

const credit = (m: Model, price: bigint, eth: bigint, rep: bigint) => {
	const recipients = live(m).filter(p => p.price >= price)
	const share = recipients.reduce((sum, p) => sum + p.k, 0n)
	if (share === 0n) return false
	for (const p of recipients) {
		p.ethFees += (eth * p.k * SCALE) / share
		p.repFees += (rep * p.k * SCALE) / share
		p.dust += DUST_PER_CREDIT
	}
	m.creditedEth += eth
	m.creditedRep += rep
	return true
}

type Operation =
	| { c: 'create'; rep: bigint; k: bigint; price: bigint }
	| { c: 'replace'; id: bigint; rep: bigint; k: bigint; price: bigint; recover: boolean }
	| { c: 'request'; id: bigint; remaining: bigint; minimum: bigint }
	| { c: 'retire'; id: bigint; price: bigint; demand: bigint }
	| { c: 'split'; id: bigint; rep: bigint; k: bigint; oldPrice: bigint; newPrice: bigint }
	| { c: 'transfer'; from: bigint; to: bigint; rep: bigint; k: bigint; oldPrice: bigint; newPrice: bigint }
	| { c: 'cure'; id: bigint; price: bigint; multiplier: bigint; minimum: bigint; demand: bigint; target: bigint; ownerExit: boolean }
	| { c: 'observe'; first: bigint; second: bigint | undefined }
	| { c: 'credit'; price: bigint; eth: bigint; rep: bigint; proportional: boolean }
	| { c: 'claim'; id: bigint }
	| { c: 'initCohorts' }
	| { c: 'import'; rep: bigint; k: bigint; price: bigint; batch: bigint; remaining: bigint }
	| { c: 'seal' }

const apply = (m: Model, op: Operation) => {
	switch (op.c) {
		case 'create':
			operational(m)
			create(m, 0n, op.rep, op.k, op.price, 0n)
			return
		case 'replace':
			replace(m, op.id, op.rep, op.k, op.price)
			if (op.recover) known(m, op.id).distress = undefined
			return
		case 'request': {
			operational(m)
			const p = known(m, op.id)
			requireModel(p.batch === 0n && inTree(p), 'Position is not active')
			requireModel(op.remaining < p.k, 'Retirement must reduce commitment')
			requireModel(op.remaining === 0n || (op.remaining >= op.minimum && p.k - op.remaining >= op.minimum), 'Retirement below economic minimum')
			p.batch = m.nextBatch
			p.order = ++m.lastOrder
			p.remaining = op.remaining
			return
		}
		case 'retire':
			retire(m, op.price, op.demand, op.id)
			return
		case 'split': {
			operational(m)
			const source = known(m, op.id)
			requireModel(!source.retired && op.k !== 0n && op.k <= source.k && op.rep <= source.rep, 'Invalid commitment transfer')
			requireModel(op.k !== source.k || op.rep === source.rep, 'Residual REP has no commitment')
			const batch = source.batch
			source.rep -= op.rep
			source.k -= op.k
			source.price = op.oldPrice
			let transferred = 0n
			if (source.remaining > source.k) {
				transferred = source.remaining - source.k
				source.remaining = source.k
			}
			reinsert(source)
			create(m, batch, op.rep, op.k, op.newPrice, transferred)
			return
		}
		case 'transfer': {
			operational(m)
			requireModel(op.from !== op.to, 'Same commitment position')
			const source = known(m, op.from)
			const receiver = known(m, op.to)
			requireModel(receiver.batch === 0n || source.batch === receiver.batch, 'Commitment cohorts differ')
			requireModel(!source.retired && inTree(receiver), 'Position is not live')
			requireModel(op.k !== 0n && op.k <= source.k && op.rep <= source.rep, 'Invalid commitment transfer')
			requireModel(op.k !== source.k || op.rep === source.rep, 'Residual REP has no commitment')
			source.rep -= op.rep
			source.k -= op.k
			source.price = op.oldPrice
			if (receiver.batch !== 0n) receiver.order = ++m.lastOrder
			receiver.rep += op.rep
			receiver.k += op.k
			receiver.price = op.newPrice
			if (source.remaining > source.k) {
				if (receiver.batch !== 0n) receiver.remaining += source.remaining - source.k
				source.remaining = source.k
			}
			reinsert(source)
			reinsert(receiver)
			return
		}
		case 'cure': {
			operational(m)
			const p = find(m, op.id)
			if (p === undefined || !inTree(p) || !(p.k > op.target)) throw new ModelRevert('Position is not live')
			const supported = (((p.rep * BPS) / op.multiplier) * WAD) / op.price
			if (supported >= p.k) {
				p.distress = undefined
				return
			}
			const total = live(m).reduce((sum, q) => sum + q.k, 0n)
			const spare = total > op.demand ? total - op.demand : 0n
			if ((op.ownerExit || op.target !== 0n) && p.k - supported < op.minimum) return
			let removed = min(p.k - op.target, min(max(p.k - supported, op.minimum), spare))
			if (removed < op.minimum && removed !== p.k) removed = 0n
			const rest = p.k - op.target - removed
			if (!op.ownerExit && rest !== 0n && rest < op.minimum) {
				if (removed >= op.minimum && p.k - op.target <= spare) removed = p.k - op.target
				else removed = removed >= op.minimum + (op.minimum - rest) ? removed - (op.minimum - rest) : 0n
			}
			if (p.rep !== 0n && removed === p.k) removed = 0n
			const remaining = p.k - removed
			if (removed !== 0n) {
				if (remaining === 0n) replace(m, p.id, 0n, 0n, 0n)
				else replace(m, p.id, p.rep, remaining, (((p.rep * BPS) / op.multiplier) * WAD) / remaining)
			}
			if (remaining <= supported) p.distress = undefined
			return
		}
		case 'observe':
			operational(m)
			for (const price of op.second === undefined ? [op.first] : [op.first, op.second]) {
				m.observedPrice = price
				for (const p of live(m)) {
					if (p.price >= price) p.distress = undefined
					else if (p.distress === undefined) p.distress = m.now
				}
			}
			return
		case 'credit': {
			if (!op.proportional) {
				operational(m)
				requireModel(credit(m, op.price, op.eth, op.rep), 'No eligible recipients')
				return
			}
			const total = live(m).reduce((sum, p) => sum + p.k, 0n)
			const share = op.price === 0n ? 0n : eligible(m, op.price)
			const assignedEth = total === 0n ? 0n : (op.eth * share) / total
			const assignedRep = total === 0n ? 0n : (op.rep * share) / total
			if (share !== 0n) {
				operational(m)
				credit(m, op.price, assignedEth, assignedRep)
			}
			m.unassignedEth += op.eth - assignedEth
			m.unassignedRep += op.rep - assignedRep
			return
		}
		case 'claim': {
			operational(m)
			const p = known(m, op.id)
			if (p.retired && !p.repClaimed) {
				p.repClaimed = true
				p.paidRep += p.rep
			}
			// Paid fees are read back from the chain; the model keeps the lifetime total.
			return
		}
		case 'initCohorts':
			requireModel(!m.imported && m.positions.length === 0, 'Commitment imports already initialized')
			m.currentBatch = 1n
			m.nextBatch = 2n
			m.lastBatch = 2n
			m.imported = true
			m.importsOpen = true
			return
		case 'import':
			requireModel(m.importsOpen, 'Commitment imports are sealed')
			requireModel(op.batch === 0n || op.batch === m.currentBatch || op.batch === m.nextBatch, 'Unknown imported cohort')
			requireModel(op.remaining < op.k && (op.batch !== 0n || op.remaining === 0n), 'Invalid imported retirement target')
			create(m, op.batch, op.rep, op.k, op.price, op.remaining)
			return
		case 'seal':
			requireModel(m.importsOpen, 'Commitment imports are sealed')
			m.importsOpen = false
			return
		default:
			throw new Error('Unknown operation')
	}
}

const REVERTS = [
	'Unknown commitment position',
	'Position is not live',
	'Closed retirement commitment cannot increase',
	'Uncommitted REP must leave index',
	'Invalid commitment position',
	'Position is not active',
	'Retirement must reduce commitment',
	'Retirement below economic minimum',
	'Position is not retiring',
	'Invalid commitment transfer',
	'Residual REP has no commitment',
	'Same commitment position',
	'Commitment cohorts differ',
	'No eligible recipients',
	'Commitment imports are open',
	'Commitment imports are sealed',
	'Commitment imports already initialized',
	'Unknown imported cohort',
	'Invalid imported retirement target',
] as const
const reasonOf = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error)
	for (const reason of REVERTS) if (message.includes(reason)) return reason
	return `UNKNOWN: ${message.slice(0, 200)}`
}

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
const stringify = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? `${item}n` : item))

/** Clustered, equal, boundary and full-width health keys. */
const randomPrice = (random: Random, wide: boolean) => {
	const mode = random.int(10)
	if (mode < 5) return BigInt(1 + random.int(12))
	if (mode < 7) return BigInt(random.int(1000))
	if (!wide) return BigInt(random.int(40))
	if (mode === 7) return BigInt(1 + random.int(100)) << BigInt(random.int(250))
	if (mode === 8) return MAX_UINT - BigInt(random.int(3))
	return 0n
}
const randomCommitment = (random: Random) => (random.chance(0.8) ? BigInt(1 + random.int(60)) : BigInt(1 + random.int(1_000_000)) * 10n ** BigInt(random.int(15)))

const generate = (m: Model, random: Random, wide: boolean, capacity: number): Operation => {
	const alive = live(m)
	const queued = alive.filter(p => p.batch !== 0n)
	const active = alive.filter(p => p.batch === 0n)
	const anyId = () => (m.positions.length === 0 || random.chance(0.03) ? BigInt(random.int(m.positions.length + 3)) : random.pick(m.positions).id)
	const liveId = () => (alive.length === 0 || random.chance(0.05) ? anyId() : random.pick(alive).id)
	const price = () => randomPrice(random, wide)
	if (m.importsOpen) {
		if (random.chance(0.04)) return { c: 'seal' }
		const k = randomCommitment(random)
		const batch = BigInt(random.int(4))
		const strayRemaining = () => (random.chance(0.05) ? 1n : 0n)
		return { c: 'import', rep: k * BigInt(random.int(9)), k, price: price(), batch, remaining: batch !== 0n && random.chance(0.5) ? (k * BigInt(random.int(1001))) / 1000n : strayRemaining() }
	}
	const roll = random.int(100)
	const createBelow = () => {
		if (alive.length < capacity / 2) return 45
		return alive.length < capacity ? 26 : 4
	}
	if (roll < createBelow()) {
		const k = randomCommitment(random)
		return { c: 'create', rep: k * BigInt(random.int(9)) + BigInt(random.int(3)), k: random.chance(0.02) ? 0n : k, price: price() }
	}
	if (roll < 38) {
		const p = find(m, liveId())
		const near = (k: bigint) => (random.chance(0.5) ? k : max(0n, k - BigInt(random.int(5))))
		const k = p === undefined || random.chance(0.4) ? randomCommitment(random) : near(p.k)
		return { c: 'replace', id: p === undefined ? anyId() : p.id, rep: k === 0n && random.chance(0.9) ? 0n : k * BigInt(random.int(9)), k, price: price(), recover: random.chance(0.3) }
	}
	if (roll < 50) {
		const p = active.length === 0 || random.chance(0.08) ? find(m, liveId()) : random.pick(active)
		if (p === undefined) return { c: 'request', id: anyId(), remaining: 0n, minimum: 1n }
		const partial = random.chance(0.5)
		return { c: 'request', id: p.id, remaining: partial ? (p.k * BigInt(random.int(1001))) / 1000n : 0n, minimum: random.pick([1n, 1n, 1n, 2n, 10n]) }
	}
	if (roll < 64) {
		const capacityAt = price()
		const healthy = eligible(m, capacityAt)
		const demand = random.pick([0n, 0n, healthy, healthy + 1n, (healthy * BigInt(random.int(1001))) / 1000n, (healthy * BigInt(900 + random.int(101))) / 1000n])
		const targeted = queued.length !== 0 && random.chance(0.5)
		const untargeted = () => (random.chance(0.06) ? anyId() : 0n)
		return { c: 'retire', id: targeted ? random.pick(queued).id : untargeted(), price: capacityAt, demand }
	}
	if (roll < 72) {
		const p = find(m, liveId())
		if (p === undefined) return { c: 'split', id: anyId(), rep: 0n, k: 1n, oldPrice: 0n, newPrice: 0n }
		const partial = (k: bigint) => (random.chance(0.05) ? k + 1n : (k * BigInt(1 + random.int(1000))) / 1000n)
		const k = random.chance(0.3) ? p.k : partial(p.k)
		const rep = k === p.k && random.chance(0.9) ? p.rep : (p.rep * BigInt(random.int(1001))) / 1000n
		return { c: 'split', id: p.id, rep, k, oldPrice: price(), newPrice: price() }
	}
	if (roll < 80) {
		const source = find(m, liveId())
		if (source === undefined) return { c: 'transfer', from: anyId(), to: anyId(), rep: 0n, k: 1n, oldPrice: 0n, newPrice: 0n }
		const peers = alive.filter(p => p.batch === source.batch && p.id !== source.id)
		const receiver = peers.length !== 0 && random.chance(0.9) ? random.pick(peers).id : liveId()
		const k = random.chance(0.3) ? source.k : (source.k * BigInt(1 + random.int(1000))) / 1000n
		const rep = k === source.k && random.chance(0.9) ? source.rep : (source.rep * BigInt(random.int(1001))) / 1000n
		return { c: 'transfer', from: source.id, to: receiver, rep, k, oldPrice: price(), newPrice: price() }
	}
	if (roll < 84) {
		const p = find(m, liveId())
		const total = alive.reduce((sum, q) => sum + q.k, 0n)
		return {
			c: 'cure',
			id: p === undefined ? anyId() : p.id,
			price: WAD * BigInt(1 + random.int(12)),
			multiplier: random.pick([10_000n, 10_500n, 20_000n]),
			minimum: random.pick([1n, 2n, 5n]),
			demand: (total * BigInt(random.int(1100))) / 1000n,
			target: p === undefined || random.chance(0.6) ? 0n : (p.k * BigInt(random.int(1001))) / 1000n,
			ownerExit: random.chance(0.3),
		}
	}
	if (roll < 90) return { c: 'observe', first: price(), second: random.chance(0.25) ? price() : undefined }
	if (roll < 96) return { c: 'credit', price: random.chance(0.15) ? 0n : price(), eth: BigInt(1 + random.int(1_000_000)), rep: BigInt(random.int(1_000_000)) * 10n ** BigInt(random.int(12)), proportional: random.chance(0.5) }
	return { c: 'claim', id: anyId() }
}

type Call = { from: Address; to: Address; data: `0x${string}` }
const word = (data: string, offset: number) => {
	if (data.length < 2 + 64 * (offset + 1)) throw new Error('Return data too short')
	return BigInt(`0x${data.slice(2 + 64 * offset, 66 + 64 * offset)}`)
}

describe('audit fuzz: commitment index and fee streams against naive reference models', () => {
	const node = useIsolatedAnvilNode()
	let admin: WriteClient | undefined
	let harness: Address = addressString(0n)
	let index: Address = addressString(0n)
	let multicall: Address = addressString(0n)
	const streamHarnesses: { address: Address; streams: Address; duration: bigint; deployedAt: bigint }[] = []
	let baseline = ''
	let genesis = 0n
	const client = () => {
		if (admin === undefined) throw new Error('Fuzz client missing')
		return admin
	}
	const latest = async () => (await client().getBlock()).timestamp
	const transact = async (call: Call) => {
		const ethereum = node.getAnvilWindowEthereum()
		const next = (await latest()) + 1n
		await ethereum.request({ method: 'evm_setNextBlockTimestamp', params: [`0x${next.toString(16)}`] })
		const transaction = { from: call.from, to: call.to, data: call.data, value: '0x0', gas: '0x1000000', gasPrice: '0x0' }
		const hash = await ethereum.requestRaw({ method: 'eth_sendTransaction', params: [transaction] })
		for (let attempt = 0; attempt < 20_000; attempt++) {
			const receipt = await ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] })
			if (typeof receipt === 'object' && receipt !== null && 'status' in receipt) {
				if (receipt.status === '0x1') return
				await ethereum.request({ method: 'eth_call', params: [transaction, 'latest'] })
				throw new Error('Transaction reverted without a replayable reason')
			}
			await new Promise(resolve => setTimeout(resolve, 0))
		}
		throw new Error('Transaction receipt missing')
	}
	const deployContract = async (data: `0x${string}`) => {
		const receipt = await client().waitForTransactionReceipt({ hash: await client().sendTransaction({ data }) })
		if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Fuzz deployment failed')
		return receipt.contractAddress
	}
	const reset = async () => {
		const ethereum = node.getAnvilWindowEthereum()
		if (baseline !== '') await ethereum.anvilRevert(baseline)
		baseline = await ethereum.anvilSnapshot()
	}

	beforeAll(async () => {
		const ethereum = node.getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		admin = createWriteClient(ethereum, TEST_ADDRESSES[0])
		harness = await deployContract(`0x${harnessArtifact.evm.bytecode.object}`)
		index = await client().readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'index' })
		multicall = await deployContract(`0x${multicallArtifact.evm.bytecode.object}`)
		for (const duration of [1n, 2n, 7n, 100n, 3_600n, 86_400n]) {
			const address = await deployContract(encodeDeployData({ abi: streamsHarnessArtifact.abi, bytecode: `0x${streamsHarnessArtifact.evm.bytecode.object}`, args: [Number(duration)] }))
			streamHarnesses.push({ address, streams: await client().readContract({ abi: streamsHarnessArtifact.abi, address, functionName: 'streams' }), duration, deployedAt: await latest() })
		}
		genesis = await latest()
		await node.setBaselineSnapshot()
	})

	const send = async (op: Operation) => {
		const abi = harnessArtifact.abi
		const from = client().account.address
		const owner = addressString(0xabcdn)
		const data = (() => {
			switch (op.c) {
				case 'create':
					return encodeFunctionData({ abi, functionName: 'create', args: [owner, op.rep, op.k, op.price] })
				case 'replace':
					return encodeFunctionData({ abi, functionName: op.recover ? 'recover' : 'replace', args: [op.id, op.rep, op.k, op.price] })
				case 'request':
					return encodeFunctionData({ abi, functionName: 'requestWithMinimum', args: [op.id, op.remaining, op.minimum] })
				case 'retire':
					return op.id === 0n ? encodeFunctionData({ abi, functionName: 'retire', args: [op.price, op.demand] }) : encodeFunctionData({ abi, functionName: 'retirePosition', args: [op.id, op.price, op.demand] })
				case 'split':
					return encodeFunctionData({ abi, functionName: 'split', args: [op.id, owner, op.rep, op.k, op.oldPrice, op.newPrice] })
				case 'transfer':
					return encodeFunctionData({ abi, functionName: 'transferTo', args: [op.from, op.to, op.rep, op.k, op.oldPrice, op.newPrice] })
				case 'cure':
					return encodeFunctionData({ abi, functionName: 'cure', args: [op.id, op.price, op.multiplier, op.minimum, op.demand, op.target, op.ownerExit] })
				case 'observe':
					return op.second === undefined ? encodeFunctionData({ abi, functionName: 'observeHealthy', args: [op.first] }) : encodeFunctionData({ abi, functionName: 'observeHealthyTwice', args: [op.first, op.second] })
				case 'credit':
					return encodeFunctionData({ abi, functionName: op.proportional ? 'creditProportional' : 'credit', args: [op.price, op.eth, op.rep] })
				case 'claim':
					return encodeFunctionData({ abi, functionName: 'claim', args: [op.id] })
				case 'initCohorts':
					return encodeFunctionData({ abi, functionName: 'initCohorts', args: [1n, 2n] })
				case 'import':
					return encodeFunctionData({ abi, functionName: 'importPartial', args: [owner, op.rep, op.k, op.price, op.batch, op.remaining] })
				case 'seal':
					return encodeFunctionData({ abi, functionName: 'sealImports' })
				default:
					throw new Error('Unknown operation')
			}
		})()
		await transact({ from, to: harness, data })
	}

	const encoded = new Map<string, `0x${string}`>()
	const cached = (key: string, encode: () => `0x${string}`) => {
		const hit = encoded.get(key)
		if (hit !== undefined) return hit
		const data = encode()
		encoded.set(key, data)
		return data
	}
	type Probe = { id: bigint; price: bigint; demand: bigint }
	const read = async (positions: number, prices: bigint[], probes: Probe[]) => {
		const indexAbi = indexArtifact.abi
		const harnessAbi = harnessArtifact.abi
		const batch: { target: Address; allowFailure: boolean; callData: `0x${string}` }[] = []
		const add = (target: Address, callData: `0x${string}`) => batch.push({ target, allowFailure: true, callData }) - 1
		const ids = Array.from({ length: positions }, (_unused, offset) => BigInt(offset + 1))
		const validate = add(
			harness,
			cached('validate', () => encodeFunctionData({ abi: harnessAbi, functionName: 'validateAll' })),
		)
		const totals = add(
			index,
			cached('totals', () => encodeFunctionData({ abi: indexAbi, functionName: 'totals' })),
		)
		const scalars = (['currentBatch', 'nextBatch', 'lastPositionId'] as const).map(functionName =>
			add(
				index,
				cached(functionName, () => encodeFunctionData({ abi: indexAbi, functionName })),
			),
		)
		const tallies = (['releasedRep', 'retiredCommitment', 'unassignedEth', 'unassignedRep'] as const).map(functionName =>
			add(
				harness,
				cached(functionName, () => encodeFunctionData({ abi: harnessAbi, functionName })),
			),
		)
		const eligibleAt = prices.map(price => add(index, encodeFunctionData({ abi: indexAbi, functionName: 'eligibleCommitment', args: [price] })))
		const activeAt = prices.map(price => add(index, encodeFunctionData({ abi: indexAbi, functionName: 'eligibleActiveCommitment', args: [price] })))
		const accounts = ids.map(id =>
			add(
				index,
				cached(`account.${id}`, () => encodeFunctionData({ abi: indexAbi, functionName: 'accountOf', args: [id] })),
			),
		)
		const startedAt = ids.map(id =>
			add(
				index,
				cached(`started.${id}`, () => encodeFunctionData({ abi: indexAbi, functionName: 'liquidationStarted', args: [id] })),
			),
		)
		const paidRep = ids.map(id =>
			add(
				harness,
				cached(`paidRep.${id}`, () => encodeFunctionData({ abi: harnessAbi, functionName: 'paidRep', args: [id] })),
			),
		)
		const paidEth = ids.map(id =>
			add(
				harness,
				cached(`paidEth.${id}`, () => encodeFunctionData({ abi: harnessAbi, functionName: 'paidEthFees', args: [id] })),
			),
		)
		const paidRepFees = ids.map(id =>
			add(
				harness,
				cached(`paidRepFees.${id}`, () => encodeFunctionData({ abi: harnessAbi, functionName: 'paidRepFees', args: [id] })),
			),
		)
		const previews = probes.map(probe => add(index, encodeFunctionData({ abi: indexAbi, functionName: 'previewRetirement', args: [probe.id, probe.price, probe.demand] })))
		const [returned, timestamp] = await Promise.all([client().readContract({ abi: multicallArtifact.abi, address: multicall, functionName: 'aggregate3', args: [batch] }), latest()])
		const data = (offset: number) => {
			const entry = returned[offset]
			if (entry === undefined) throw new Error('Aggregate entry missing')
			if (!entry.success && offset !== validate) throw new Error(`Aggregate call ${offset} failed`)
			return entry
		}
		const first = (offset: number) => word(data(offset).returnData, 0)
		return {
			structure: data(validate).success,
			rep: word(data(totals).returnData, 0),
			commitment: word(data(totals).returnData, 1),
			scalars: scalars.map(first),
			tallies: tallies.map(first),
			eligible: eligibleAt.map(first),
			active: activeAt.map(first),
			accounts: accounts.map(offset => {
				const bytes = data(offset).returnData
				return { batch: word(bytes, 1), rep: word(bytes, 2), commitment: word(bytes, 3), price: word(bytes, 4), released: word(bytes, 5), ethFees: word(bytes, 6), repFees: word(bytes, 7), remaining: word(bytes, 8) }
			}),
			started: startedAt.map(first),
			paidRep: paidRep.map(first),
			paidEth: paidEth.map(first),
			paidRepFees: paidRepFees.map(first),
			previews: previews.map(offset => {
				const bytes = data(offset).returnData
				return { status: STATUS[Number(word(bytes, 0))], effective: word(bytes, 1), ahead: word(bytes, 4), reduction: word(bytes, 5) }
			}),
			timestamp,
		}
	}

	const within = (actual: bigint, scaled: bigint, dust: bigint) => abs(actual * SCALE - scaled) <= (dust + 1n) * SCALE

	const run = async (seed: number, steps: number, fixed: Operation[] | undefined) => {
		await reset()
		const random = createRandom(seed)
		const wide = random.chance(0.5)
		const capacity = random.pick([6, 20, 60, 150, 300])
		const imports = random.chance(0.25)
		let m: Model = { now: genesis, lastOrder: 0n, positions: [], currentBatch: 0n, nextBatch: 1n, lastBatch: 1n, observedPrice: 0n, importsOpen: false, imported: false, released: 0n, retiredCommitment: 0n, creditedEth: 0n, creditedRep: 0n, unassignedEth: 0n, unassignedRep: 0n }
		const trace: Operation[] = []
		const total = fixed === undefined ? steps : fixed.length
		for (let step = 0; step < total; step++) {
			const fresh = (): Operation => (step === 0 && imports ? { c: 'initCohorts' } : generate(m, random, wide, capacity))
			const op = fixed === undefined ? fresh() : fixed[step]
			if (op === undefined) throw new Error('Replay operation missing')
			trace.push(op)
			const next = structuredClone(m)
			next.now += 1n
			let expected: string | undefined
			try {
				apply(next, op)
			} catch (error) {
				if (!(error instanceof ModelRevert)) throw error
				expected = error.reason
			}
			let actual: string | undefined
			try {
				await send(op)
			} catch (error) {
				actual = reasonOf(error)
			}
			const issues: string[] = []
			if (actual?.startsWith('UNKNOWN')) issues.push(`UNKNOWN-REVERT: ${op.c} reverted with ${actual}`)
			else if (expected === undefined && actual !== undefined) issues.push(`LIVENESS: ${op.c} must succeed but reverted with '${actual}'`)
			else if (expected !== undefined && actual === undefined) issues.push(`UNEXPECTED-SUCCESS: ${op.c} must revert with '${expected}'`)
			else if (expected !== undefined && actual !== undefined && expected !== actual) issues.push(`REVERT-REASON: ${op.c} reverted with '${actual}', model expects '${expected}'`)
			if (actual === undefined && expected === undefined) m = next
			else {
				m = structuredClone(m)
				m.now += 1n
			}
			const prices = [0n, randomPrice(random, wide), randomPrice(random, wide), MAX_UINT]
			const queued = live(m).filter(p => p.batch !== 0n)
			const probes: Probe[] = []
			for (let probe = 0; probe < 4 && queued.length !== 0; probe++) {
				const price = randomPrice(random, wide)
				const healthy = eligible(m, price)
				probes.push({ id: random.pick(queued).id, price, demand: random.pick([0n, healthy, (healthy * BigInt(random.int(1001))) / 1000n]) })
			}
			const a = await read(m.positions.length, prices, probes)
			const check = (tag: string, actualValue: unknown, expectedValue: unknown) => {
				if (actualValue !== expectedValue) issues.push(`${tag}: actual ${String(actualValue)} expected ${String(expectedValue)}`)
			}
			if (issues.length === 0) {
				check('CLOCK', a.timestamp, m.now)
				check('STRUCTURE', a.structure, true)
				check(
					'TOTALS.rep',
					a.rep,
					live(m).reduce((sum, p) => sum + p.rep, 0n),
				)
				check(
					'TOTALS.commitment',
					a.commitment,
					live(m).reduce((sum, p) => sum + p.k, 0n),
				)
				check('BATCH.current', a.scalars[0], m.currentBatch)
				check('BATCH.next', a.scalars[1], m.nextBatch)
				check('POSITIONS.count', a.scalars[2], BigInt(m.positions.length))
				check('RETIRED.rep', a.tallies[0], m.released)
				check('RETIRED.commitment', a.tallies[1], m.retiredCommitment)
				check('FEES.unassignedEth', a.tallies[2], m.unassignedEth)
				check('FEES.unassignedRep', a.tallies[3], m.unassignedRep)
				prices.forEach((price, offset) => {
					check(`ELIGIBLE[${price}]`, a.eligible[offset], eligible(m, price))
					check(`ELIGIBLE.active[${price}]`, a.active[offset], eligibleActive(m, price))
				})
				let feesEth = 0n
				let feesRep = 0n
				for (const p of m.positions) {
					const account = a.accounts[Number(p.id) - 1]
					if (account === undefined) throw new Error('Account read missing')
					const tag = `POSITION[${p.id}]`
					check(`${tag}.rep`, account.rep, inTree(p) ? p.rep : 0n)
					check(`${tag}.commitment`, account.commitment, inTree(p) ? p.k : 0n)
					check(`${tag}.released`, account.released, p.retired && !p.repClaimed ? p.rep : 0n)
					check(`${tag}.price`, account.price, p.price)
					check(`${tag}.remaining`, account.remaining, p.remaining)
					if (inTree(p)) check(`${tag}.batch`, account.batch, p.batch)
					check(`LIQUIDATION[${p.id}]`, a.started[Number(p.id) - 1], started(m, p))
					check(`${tag}.paidRep`, a.paidRep[Number(p.id) - 1], p.paidRep)
					const paidEth = a.paidEth[Number(p.id) - 1] ?? 0n
					const paidRepFees = a.paidRepFees[Number(p.id) - 1] ?? 0n
					if (!within(paidEth + account.ethFees, p.ethFees, p.dust)) issues.push(`FEES.eth[${p.id}]: actual ${paidEth + account.ethFees} model ${p.ethFees / SCALE} dust ${p.dust}`)
					if (!within(paidRepFees + account.repFees, p.repFees, p.dust)) issues.push(`FEES.rep[${p.id}]: actual ${paidRepFees + account.repFees} model ${p.repFees / SCALE} dust ${p.dust}`)
					feesEth += paidEth + account.ethFees
					feesRep += paidRepFees + account.repFees
				}
				// Every credited unit belongs to exactly one position: tree rounding creates and loses nothing.
				check('FEES.conservedEth', feesEth, m.creditedEth)
				check('FEES.conservedRep', feesRep, m.creditedRep)
				probes.forEach((probe, offset) => {
					const actualPreview = a.previews[offset]
					const expectedPreview = preview(m, probe.id, probe.price, probe.demand)
					check(`PREVIEW[${probe.id}].status`, actualPreview?.status, expectedPreview.status)
					check(`PREVIEW[${probe.id}].ahead`, actualPreview?.ahead, expectedPreview.ahead)
					check(`PREVIEW[${probe.id}].reduction`, actualPreview?.reduction, expectedPreview.reduction)
					check(`PREVIEW[${probe.id}].effective`, actualPreview?.effective, expectedPreview.effective)
				})
			}
			if (issues.length !== 0) return { failure: { tag: (issues[0] ?? 'UNKNOWN').split(/[:[.]/)[0] ?? 'UNKNOWN', issues, step }, trace }
		}
		return { failure: undefined, trace }
	}
	const shrink = async (seed: number, steps: number, trace: Operation[], tag: string) => {
		let current = trace
		let attempts = 0
		for (let chunk = Math.max(1, Math.floor(current.length / 2)); chunk >= 1 && attempts < 500; chunk = Math.floor(chunk / 2)) {
			for (let start = 0; start < current.length && attempts < 500; ) {
				attempts++
				const outcome = await run(seed, steps, [...current.slice(0, start), ...current.slice(start + chunk)])
				if (outcome.failure !== undefined && outcome.failure.tag === tag) current = outcome.trace.slice(0, outcome.failure.step + 1)
				else start += chunk
			}
			if (chunk === 1) break
		}
		return current
	}

	test('#1255 transfers into active capital discard acquired retirement requests in the reference model', async () => {
		baseline = ''
		const trace: Operation[] = [
			{ c: 'create', rep: 100n, k: 10n, price: 10n },
			{ c: 'create', rep: 100n, k: 10n, price: 10n },
			{ c: 'request', id: 1n, remaining: 4n, minimum: 1n },
			{ c: 'transfer', from: 1n, to: 2n, rep: 70n, k: 7n, oldPrice: 10n, newPrice: 10n },
			{ c: 'create', rep: 100n, k: 10n, price: 10n },
			{ c: 'request', id: 3n, remaining: 3n, minimum: 1n },
			{ c: 'transfer', from: 3n, to: 2n, rep: 20n, k: 2n, oldPrice: 10n, newPrice: 10n },
			{ c: 'transfer', from: 2n, to: 3n, rep: 10n, k: 1n, oldPrice: 10n, newPrice: 10n },
			{ c: 'transfer', from: 3n, to: 2n, rep: 80n, k: 8n, oldPrice: 10n, newPrice: 10n },
		]
		const outcome = await run(1, trace.length, trace)
		expect(outcome.failure).toBeUndefined()
	})

	test('#1463 a cure that would cut the whole commitment of a REP-backed position removes nothing (seed 120000)', async () => {
		baseline = ''
		const trace: Operation[] = [
			{ c: 'create', rep: 138n, k: 34n, price: 1n },
			{ c: 'replace', id: 1n, rep: 10n, k: 10n, price: 8n, recover: false },
			{ c: 'create', rep: 573773600000000001n, k: 71721700000000000n, price: 11n },
			{ c: 'cure', id: 1n, price: 5n * WAD, multiplier: 20_000n, minimum: 5n, demand: 2853080884168020n, target: 0n, ownerExit: false },
		]
		const outcome = await run(1, trace.length, trace)
		expect(outcome.failure).toBeUndefined()
	})

	test('#1463 an owner exit with a sub-minimum deficit keeps its commitment', async () => {
		baseline = ''
		// Supported commitment is 9 of 10; the deficit of 1 is below the minimum of 2 and spare would allow a cut.
		const trace: Operation[] = [
			{ c: 'create', rep: 18n * WAD, k: 10n, price: 2n * WAD },
			{ c: 'create', rep: 1000n * WAD, k: 100n, price: 2n * WAD },
			{ c: 'cure', id: 1n, price: 2n * 10n ** 36n, multiplier: 10_000n, minimum: 2n, demand: 0n, target: 0n, ownerExit: true },
		]
		const outcome = await run(1, trace.length, trace)
		expect(outcome.failure).toBeUndefined()
	})

	test('random index operations keep every aggregate, cohort, fee, clock and preview equal to the reference model', async () => {
		// The shared fixture reverts to its own snapshot before each test, which consumes ours.
		baseline = ''
		const steps = positiveFuzzInteger('AUDIT_FUZZ_STEPS', 260)
		const failures: string[] = []
		const seeds = auditFuzzSeeds([1, 2, 3, 19, 37, 54])
		for (const seed of seeds) {
			const outcome = await run(seed, steps, undefined)
			if (outcome.failure === undefined) continue
			const failing = outcome.trace.slice(0, outcome.failure.step + 1)
			const minimal = process.env['AUDIT_FUZZ_SHRINK'] === '0' ? failing : await shrink(seed, steps, failing, outcome.failure.tag)
			const replay = await run(seed, steps, minimal)
			const report = [
				`seed ${seed} step ${outcome.failure.step} tag ${outcome.failure.tag}`,
				`Replay: AUDIT_FUZZ_SEEDS=1 AUDIT_FUZZ_SEED_START=${seed} AUDIT_FUZZ_STEPS=${steps} bun ./tooling/testing/bun-test.mts solidity/ts/tests/auditCapitalIndexFuzz.test.ts`,
				...outcome.failure.issues.slice(0, 10),
				`minimal sequence (${minimal.length} operations):`,
				...minimal.map((op, position) => `  ${position}: ${stringify(op)}`),
				'issues on the minimal sequence:',
				...(replay.failure?.issues.slice(0, 10) ?? ['(did not reproduce)']),
			].join('\n')
			console.log(`\nINDEX FUZZ FAILURE\n${report}\n`)
			failures.push(report)
			if (failures.length >= 3) break
		}
		expect(failures).toEqual([])
	})

	test('random funding and release schedules pay each stream exactly its linear amount', async () => {
		baseline = ''
		const from = client().account.address
		const seeds = auditFuzzSeeds([1, 2, 3, 19, 37, 54])
		for (const seed of seeds) {
			await reset()
			const random = createRandom(seed)
			const target = random.pick(streamHarnesses)
			const abi = streamsHarnessArtifact.abi
			const streams: { start: bigint; eth: bigint; rep: bigint }[] = []
			const integral = (at: bigint) => {
				let eth = 0n
				let rep = 0n
				for (const stream of streams) {
					if (at >= stream.start + target.duration) {
						eth += stream.eth * target.duration
						rep += stream.rep * target.duration
						continue
					}
					const elapsed = at > stream.start ? at - stream.start : 0n
					eth += stream.eth * elapsed
					rep += stream.rep * elapsed
				}
				return [eth / target.duration, rep / target.duration] as const
			}
			let releasedThrough = target.deployedAt
			const amount = () => (random.chance(0.1) ? 0n : BigInt(1 + random.int(1_000_000)) * 10n ** BigInt(random.int(20)) + BigInt(random.int(100_000)))
			const trace: string[] = []
			for (let step = 0; step < 120; step++) {
				const now = (await latest()) + 1n
				const roll = random.int(100)
				let expected: string | undefined
				let data: `0x${string}`
				if (roll < 25) {
					const jump = random.pick([1n, 2n, target.duration - 1n, target.duration, target.duration + 1n, BigInt(1 + random.int(Number(target.duration) * 3))])
					await node.getAnvilWindowEthereum().setTime(now - 1n + max(1n, jump))
					trace.push(`time +${max(1n, jump)}`)
					continue
				}
				if (roll < 55) {
					const eth = amount()
					const rep = amount()
					if (eth === 0n && rep === 0n) expected = 'Empty fee stream'
					else streams.push({ start: now, eth, rep })
					if (expected === undefined) releasedThrough = now
					data = encodeFunctionData({ abi, functionName: 'add', args: [eth, rep] })
					trace.push(`add ${eth} ${rep} at ${now}`)
				} else if (roll < 70) {
					const values = [amount(), amount(), amount(), amount()] as const
					if (values[0] === 0n && values[1] === 0n) expected = 'Empty fee stream'
					else if (values[2] === 0n && values[3] === 0n) expected = 'Empty fee stream'
					else {
						streams.push({ start: now, eth: values[0], rep: values[1] }, { start: now, eth: values[2], rep: values[3] })
						releasedThrough = now
					}
					data = encodeFunctionData({ abi, functionName: 'addTwice', args: [...values] })
					trace.push(`addTwice ${values.join(' ')} at ${now}`)
				} else if (roll < 75) {
					const eth = amount() + 1n
					if (releasedThrough !== now) expected = 'Checkpoint fees before funding'
					else streams.push({ start: now, eth, rep: 0n })
					data = encodeFunctionData({ abi, functionName: 'addWithoutCheckpoint', args: [eth, 0n] })
					trace.push(`addWithoutCheckpoint ${eth} at ${now}`)
				} else {
					// Split one wall-clock interval at an arbitrary earlier boundary, as the ledger does at a price expiry.
					const until = random.pick([now, now, releasedThrough, releasedThrough + (BigInt(random.next()) * (now - releasedThrough)) / 4294967296n, now + 1n, releasedThrough === 0n ? 0n : releasedThrough - 1n])
					if (until > now) expected = 'Future fee checkpoint'
					else if (until < releasedThrough) expected = 'Fee time moved backwards'
					else releasedThrough = until
					data = encodeFunctionData({ abi, functionName: 'release', args: [Number(until)] })
					trace.push(`release ${until} at ${now}`)
				}
				let actual: string | undefined
				try {
					await transact({ from, to: target.address, data })
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					actual = ['Empty fee stream', 'Checkpoint fees before funding', 'Future fee checkpoint', 'Fee time moved backwards'].find(reason => message.includes(reason)) ?? `UNKNOWN: ${message.slice(0, 160)}`
				}
				const context = `seed ${seed} duration ${target.duration}\n${trace.join('\n')}`
				expect(`${actual}\n${context}`).toBe(`${expected}\n${context}`)
				const [releasedEth, releasedRep] = integral(releasedThrough)
				const fundedEth = streams.reduce((sum, stream) => sum + stream.eth, 0n)
				const fundedRep = streams.reduce((sum, stream) => sum + stream.rep, 0n)
				const future = releasedThrough + BigInt(random.int(Number(target.duration) * 2 + 2))
				const [futureEth, futureRep] = integral(future)
				const [paidEth, paidRep, outstanding, through, quote] = await Promise.all([
					client().readContract({ abi, address: target.address, functionName: 'releasedEth' }),
					client().readContract({ abi, address: target.address, functionName: 'releasedRep' }),
					client().readContract({ abi: streamsArtifact.abi, address: target.streams, functionName: 'fundedOutstanding' }),
					client().readContract({ abi: streamsArtifact.abi, address: target.streams, functionName: 'releasedThrough' }),
					client().readContract({ abi: streamsArtifact.abi, address: target.streams, functionName: 'preview', args: [Number(future)] }),
				])
				expect(`${stringify({ paidEth, paidRep, outstanding, through: BigInt(through), quote })}\n${context}`).toBe(
					`${stringify({ paidEth: releasedEth, paidRep: releasedRep, outstanding: [fundedEth - releasedEth, fundedRep - releasedRep], through: releasedThrough, quote: [futureEth - releasedEth, futureRep - releasedRep] })}\n${context}`,
				)
			}
		}
	})
})
