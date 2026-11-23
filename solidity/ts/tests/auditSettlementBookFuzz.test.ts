import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as artifact } from '../types/contractArtifact'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

// Stateful fuzz of SecurityPoolSettlementBook ETH accounting against an eager, per-question
// reference model (no trees, no lazy fees, no prefix sums). The model predicts for EVERY
// operation whether it must succeed and the exact resulting state; any difference fails.
// Recovery REP amounts are not modelled (auditSettlementRecoveryFuzz.test.ts does that); they
// are read back and checked for conservation; their quote gates the separate mint-funding requirement.
// Long run: AUDIT_FUZZ_SEEDS=40 AUDIT_FUZZ_FIRST_SEED=1 AUDIT_FUZZ_STEPS=150 AUDIT_FUZZ_SHRINK_MS=60000 bun ./tooling/testing/bun-test.mts --timeout 3000000 solidity/ts/tests/auditSettlementBookFuzz.test.ts

const SEEDS = Number(process.env['AUDIT_FUZZ_SEEDS'] ?? '6')
const FIRST_SEED = Number(process.env['AUDIT_FUZZ_FIRST_SEED'] ?? '1')
// Seeds 7016 and 7027 reach a recovery REP requirement above the 2^128 bound (#1320) with
// unrounded fee-stream ends, so they always run at fee end granularity 1.
const PRECISION_BOUND_SEEDS = [7016, 7027]
// Seeds 9100038 and 51312 (#1463, minimum outcome rate 1 attoETH) erode a question with a fee stream until the next mint
// exceeds the settlement principal bound.
const PRINCIPAL_BOUND_SEEDS = [9100038, 51312]
const REGRESSION_SEEDS = process.env['AUDIT_FUZZ_SEEDS'] === undefined ? [...PRECISION_BOUND_SEEDS, ...PRINCIPAL_BOUND_SEEDS] : []
const STEPS = Number(process.env['AUDIT_FUZZ_STEPS'] ?? '150')
const SHRINK_MS = Number(process.env['AUDIT_FUZZ_SHRINK_MS'] ?? '60000')
const QUESTIONS = [1, 2, 3, 4, 5, 6] as const
const SCALE = 10n ** 18n
const UNIT_SCALE = 10n ** 9n
const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d
const UNIT_BOUND = 1n << 128n
const RESPONSE = 259_200
const START = 1_000
const MAX_BOOKS = 8

const makeRandom = (seed: number) => {
	let state = BigInt(seed) * 0x9e3779b97f4a7c15n + 1n
	const next = () => {
		state ^= (state << 13n) & 0xffffffffffffffffn
		state ^= state >> 7n
		state ^= (state << 17n) & 0xffffffffffffffffn
		return state & 0xffffffffffffffffn
	}
	return {
		int: (maxExclusive: number) => Number(next() % BigInt(maxExclusive)),
		big: (maxInclusive: bigint) => (maxInclusive <= 0n ? 0n : ((next() << 128n) | (next() << 64n) | next()) % (maxInclusive + 1n)),
		pick: <T>(items: readonly T[]): T => {
			const item = items[Number(next() % BigInt(items.length))]
			if (item === undefined) throw new Error('empty pick')
			return item
		},
	}
}
type Random = ReturnType<typeof makeRandom>

type Op =
	| { k: 'mint'; b: number; q: number; cash: bigint; ts: number }
	| { k: 'redeem'; b: number; q: number; shares: bigint; ts: number }
	| { k: 'fee'; b: number; q: number; rate: bigint; end: number; ts: number }
	| { k: 'sched'; b: number; q: number; finalAfter: number; ts: number }
	| { k: 'freeze'; b: number; ts: number }
	| { k: 'enable'; b: number; on: boolean; ts: number }
	| { k: 'clock'; b: number; native: number }
	| { k: 'collect'; b: number; amount: bigint }
	| { k: 'seal'; b: number; ts: number }
	| { k: 'child'; b: number; cash: bigint; rec: bigint }
const show = (value: unknown) => JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? `${item}n` : item))

// principal mirrors feePrincipalAttoEth: claim weights at mint, scaled down by redemptions, untouched by fees.
type ModelQuestion = { units: bigint; supply: bigint; principal: bigint; finalAfter: number; rate: bigint; feeEnd: number; frozen: number }
type ModelBook = {
	remainder: bigint
	targetNumerator: bigint
	targetDenominator: bigint
	cash: bigint
	units: bigint
	feeCash: bigint
	ts: number
	offset: number
	isSealed: boolean
	enabled: boolean
	minimumFinalAfter: number
	rec: bigint
	depth: number
	children: number
	questions: Map<number, ModelQuestion>
	// conservation trackers (chain-observed)
	cashIn: bigint
	cashPaid: bigint
	feesAccrued: bigint
	recIn: bigint
	recPaid: bigint
}
type ModelFrozen = { cash: bigint; units: bigint; source: number; rec: bigint }
// granularity mirrors the book's feeEndGranularity: stream ends round down to a multiple of it.
type Model = { books: Map<number, ModelBook>; frozen: Map<number, ModelFrozen>; minimum: bigint; granularity: bigint }
const FEE_END_LIMIT = 1n << 33n

const emptyQuestion = (): ModelQuestion => ({ units: 0n, supply: 0n, principal: 0n, finalAfter: 0, rate: 0n, feeEnd: 0, frozen: 0 })
const questionOf = (book: ModelBook, id: number) => {
	let state = book.questions.get(id)
	if (state === undefined) {
		state = emptyQuestion()
		book.questions.set(id, state)
	}
	return state
}
const cashFor = (cash: bigint, units: bigint, redeemed: bigint, remainder = 0n) => {
	if (redeemed === 0n) return 0n
	return redeemed === units ? cash : ((cash * UNIT_SCALE - remainder) * redeemed) / (units * UNIT_SCALE)
}
const reserved = (model: Model, supply: bigint) => (supply * model.minimum + SCALE - 1n) / SCALE
const netCash = (book: ModelBook) => book.cash * UNIT_SCALE - book.remainder
const requiredCash = (book: ModelBook) => ceilDiv(ceilDiv(book.units * book.targetNumerator, book.targetDenominator) + book.remainder, UNIT_SCALE)
const isCashFunded = (book: ModelBook) => book.cash >= requiredCash(book)
const isFunded = (book: ModelBook) => isCashFunded(book) && book.enabled
const feeBudget = (model: Model, book: ModelBook, state: ModelQuestion) => {
	const net = netCash(book)
	if (net === 0n || book.units === 0n) return 0n
	const floor = reserved(model, state.supply)
	if (floor > (state.units * net) / (book.units * UNIT_SCALE)) return 0n
	const floorUnits = ceilDiv(floor * book.units * UNIT_SCALE, net)
	return state.units > floorUnits ? state.units - floorUnits : 0n
}
const clearEmpty = (book: ModelBook) => {
	if (book.units === 0n) {
		book.remainder = 0n
		book.targetNumerator = 1n
		book.targetDenominator = 1n
	}
}
const initialModel = (minimum: bigint, granularity: bigint): Model => ({
	minimum,
	granularity,
	frozen: new Map(),
	books: new Map([[1, { cash: 0n, units: 0n, remainder: 0n, targetNumerator: 1n, targetDenominator: 1n, feeCash: 0n, ts: START, offset: 0, isSealed: false, enabled: true, minimumFinalAfter: 0, rec: 0n, depth: 0, children: 0, questions: new Map(), cashIn: 0n, cashPaid: 0n, feesAccrued: 0n, recIn: 0n, recPaid: 0n }]]),
})
const cloneModel = (model: Model): Model => ({
	minimum: model.minimum,
	granularity: model.granularity,
	frozen: new Map([...model.frozen].map(([id, value]) => [id, { ...value }])),
	books: new Map([...model.books].map(([id, value]) => [id, { ...value, questions: new Map([...value.questions].map(([questionId, state]) => [questionId, { ...state }])) }])),
})

type Outcome = { ok: true; touched: number[]; frozenTouched: number[]; paid?: bigint; created?: number } | { ok: false; why: string }
const reject = (why: string): Outcome => ({ ok: false, why })

const isMature = (book: ModelBook, state: ModelQuestion) => book.ts > book.minimumFinalAfter && state.finalAfter !== 0 && state.finalAfter < book.ts

// Reference semantics. Mutates `model`; callers clone first and discard on rejection.
const advance = (model: Model, bookId: number, book: ModelBook, ts: number, frozenTouched: number[], maturity?: number | 'all'): string | undefined => {
	if (ts < book.ts) return 'clock backwards'
	const before = book.ts + book.offset
	const after = ts + book.offset
	if (isFunded(book) && after > before) {
		let fees = 0n
		for (const state of book.questions.values()) {
			if (state.frozen !== 0 || state.rate === 0n) continue
			const seconds = Math.min(after, state.feeEnd) - Math.min(before, state.feeEnd)
			if (seconds <= 0) continue
			const fee = state.rate * BigInt(seconds)
			state.units -= fee
			if (state.units < 0n) throw new Error('MODEL: fee exhausted question weights')
			fees += fee
		}
		const earned = (fees * netCash(book)) / (book.units === 0n ? 1n : book.units) + book.remainder
		const paid = earned / UNIT_SCALE
		book.remainder = earned % UNIT_SCALE
		book.cash -= paid
		book.units -= fees
		book.feeCash += paid
		book.feesAccrued += paid
	}
	book.ts = ts
	if (maturity === undefined) return undefined
	const candidates = maturity === 'all' ? [...book.questions.values()] : [questionOf(book, maturity)]
	const due = candidates.filter(state => state.frozen === 0 && isMature(book, state))
	const matured = due.reduce((total, state) => total + state.units, 0n)
	if (matured === 0n) return undefined
	const cash = cashFor(book.cash, book.units, matured, book.remainder)
	book.cash -= cash
	book.units -= matured
	clearEmpty(book)
	const frozenId = model.frozen.size + 1
	model.frozen.set(frozenId, { cash, units: matured, source: bookId, rec: 0n })
	for (const state of due) state.frozen = frozenId
	frozenTouched.push(frozenId)
	return undefined
}

const apply = (model: Model, op: Op, blockTime: number): Outcome => {
	const book = model.books.get(op.b)
	if (book === undefined) return reject('unknown book')
	const frozenTouched: number[] = []
	const touched = [op.b]
	const active = () => (book.isSealed ? 'sealed' : undefined)
	switch (op.k) {
		case 'mint': {
			const problem = active() ?? advance(model, op.b, book, op.ts, frozenTouched)
			if (problem !== undefined) return reject(problem)
			if (!isCashFunded(book)) return reject('runoff')
			if (op.cash === 0n) return reject('zero funding')
			const state = questionOf(book, op.q)
			if (state.frozen !== 0 || state.finalAfter !== 0) return reject('mint closed')
			const added = book.units === 0n ? op.cash * UNIT_SCALE : (op.cash * UNIT_SCALE * book.units) / netCash(book)
			if (added === 0n || (book.units !== 0n && (added * netCash(book)) / book.units < (op.cash - 1n) * UNIT_SCALE)) return reject('unit precision')
			let shares: bigint
			if (state.supply === 0n) {
				if (state.units !== 0n) throw new Error('MODEL: units without supply')
				shares = op.cash
			} else {
				if (state.units === 0n) return reject('exhausted')
				if ((((state.units * netCash(book)) / book.units) * (SCALE / UNIT_SCALE)) / state.supply < model.minimum) return reject('below minimum')
				shares = (added * state.supply) / state.units
			}
			if (shares === 0n) return reject('no shares')
			// A fee-eroded question mints many shares per weight, so its principal can outgrow the bound.
			const principal = state.principal + (state.supply === 0n ? added : ceilDiv(state.principal * shares, state.supply))
			if (principal >= UNIT_BOUND) return reject('principal precision bound')
			if (book.units + added >= UNIT_BOUND || book.cash + op.cash >= UNIT_BOUND) return reject('precision bound')
			state.units += added
			state.supply += shares
			state.principal = principal
			book.cash += op.cash
			book.units += added
			book.cashIn += op.cash
			return { ok: true, touched, frozenTouched }
		}
		case 'redeem': {
			if (!book.isSealed) {
				const problem = advance(model, op.b, book, op.ts, frozenTouched, op.q)
				if (problem !== undefined) return reject(problem)
			}
			const state = questionOf(book, op.q)
			if (op.shares === 0n || op.shares > state.supply) return reject('invalid burn')
			const burned = op.shares === state.supply ? state.units : (state.units * op.shares) / state.supply
			let cash: bigint
			let availableCash: bigint
			if (state.frozen === 0) {
				if (book.isSealed) return reject('use child')
				availableCash = book.cash
				cash = cashFor(book.cash, book.units, burned, book.remainder)
				book.cash -= cash
				book.units -= burned
				clearEmpty(book)
			} else {
				const frozen = model.frozen.get(state.frozen)
				if (frozen === undefined) throw new Error('MODEL: missing frozen book')
				if (frozen.source !== op.b) return reject('use source final claim')
				availableCash = frozen.cash
				cash = cashFor(frozen.cash, frozen.units, burned)
				frozen.cash -= cash
				frozen.units -= burned
				frozenTouched.push(state.frozen)
			}
			// A payout is bounded by its own active or frozen book's cash custody.
			if (cash > availableCash) throw new Error(`MODEL: redemption pays ${cash} beyond its book's ${availableCash} cash`)
			state.units -= burned
			state.principal = (state.principal * (state.supply - op.shares)) / state.supply
			state.rate = (state.rate * (state.supply - op.shares)) / state.supply
			state.supply -= op.shares
			book.cashPaid += cash
			return { ok: true, touched, frozenTouched, paid: cash }
		}
		case 'fee': {
			const problem = active() ?? advance(model, op.b, book, op.ts, frozenTouched)
			if (problem !== undefined) return reject(problem)
			const state = questionOf(book, op.q)
			if (state.frozen !== 0) return reject('final claim fees closed')
			const clock = book.ts + book.offset
			let rate = op.rate
			let end = op.end
			if (rate !== 0n) {
				if (state.finalAfter !== 0 || end <= clock) return reject('invalid interval')
				const affordable = BigInt(clock) + feeBudget(model, book, state) / rate
				const requested = BigInt(end) < FEE_END_LIMIT ? BigInt(end) : FEE_END_LIMIT - 1n
				let last = requested < affordable ? requested : affordable
				last -= last % model.granularity
				if (last <= BigInt(clock)) rate = 0n
				else end = Number(last)
			}
			state.rate = rate
			state.feeEnd = rate === 0n ? 0 : end
			return { ok: true, touched, frozenTouched }
		}
		case 'sched': {
			const problem = active() ?? advance(model, op.b, book, op.ts, frozenTouched)
			if (problem !== undefined) return reject(problem)
			const state = questionOf(book, op.q)
			if (state.frozen !== 0 || isMature(book, state)) return reject('final claim immutable')
			if (op.finalAfter !== 0 && op.finalAfter < op.ts) return reject('finality elapsed')
			if (op.finalAfter !== 0 && state.rate !== 0n && state.feeEnd > book.ts + book.offset) return reject('stop fees first')
			state.finalAfter = op.finalAfter
			return { ok: true, touched, frozenTouched }
		}
		case 'freeze': {
			const problem = active() ?? advance(model, op.b, book, op.ts, frozenTouched, 'all')
			if (problem !== undefined) return reject(problem)
			return { ok: true, touched, frozenTouched }
		}
		case 'enable': {
			const problem = active() ?? advance(model, op.b, book, op.ts, frozenTouched)
			if (problem !== undefined) return reject(problem)
			if (op.on && book.ts + book.offset > blockTime) return reject('fee activation in the future')
			book.enabled = op.on
			return { ok: true, touched, frozenTouched }
		}
		case 'clock': {
			if (book.isSealed) return reject('sealed')
			if (book.enabled) return reject('pause first')
			if (op.native < book.ts + book.offset) return reject('fee clock backwards')
			book.offset = op.native - book.ts
			return { ok: true, touched, frozenTouched }
		}
		case 'collect': {
			if (op.amount > book.feeCash) return reject('fee escrow insufficient')
			book.feeCash -= op.amount
			return { ok: true, touched, frozenTouched }
		}
		case 'seal': {
			const problem = active() ?? advance(model, op.b, book, op.ts, frozenTouched, 'all')
			if (problem !== undefined) return reject(problem)
			book.isSealed = true
			return { ok: true, touched, frozenTouched }
		}
		case 'child': {
			if (!book.isSealed) return reject('source not sealed')
			const targetNumerator = book.units !== 0n && isCashFunded(book) ? book.cash * UNIT_SCALE : book.targetNumerator
			const targetDenominator = book.units !== 0n && isCashFunded(book) ? book.units : book.targetDenominator
			if (op.cash > ceilDiv(ceilDiv(book.units * targetNumerator, targetDenominator), UNIT_SCALE)) return reject('child cash exceeds liabilities')
			if (op.rec !== 0n && book.units === 0n) return reject('no claimants')
			if (op.rec < book.rec || op.rec >= UNIT_BOUND) return reject('invalid child recovery')
			const childId = model.books.size + 1
			model.books.set(childId, {
				cash: op.cash,
				remainder: 0n,
				targetNumerator,
				targetDenominator,
				units: book.units,
				feeCash: 0n,
				ts: book.ts,
				offset: book.offset,
				isSealed: false,
				enabled: book.enabled,
				minimumFinalAfter: book.ts,
				rec: op.rec,
				depth: book.depth + 1,
				children: 0,
				questions: new Map([...book.questions].map(([id, state]) => [id, { ...state }])),
				cashIn: op.cash,
				cashPaid: 0n,
				feesAccrued: 0n,
				recIn: op.rec,
				recPaid: 0n,
			})
			book.children++
			return { ok: true, touched: [op.b, childId], frozenTouched, created: childId }
		}
		default:
			throw new Error('Unknown operation')
	}
}

// Random operation generator. It only reads the model; every emitted operation is concrete.
const generate = (model: Model, random: Random, blockStart: number, index: number): Op[] => {
	const ids = [...model.books.keys()]
	const open = ids.filter(id => model.books.get(id)?.isSealed === false)
	const needChild = ids.filter(id => {
		const book = model.books.get(id)
		return book?.isSealed && book.children < 2
	})
	if (needChild.length !== 0 && model.books.size < MAX_BOOKS && random.int(3) !== 0) {
		const b = random.pick(needChild)
		const source = model.books.get(b)
		if (source === undefined) throw new Error('unreachable')
		const limit = source.units !== 0n && isCashFunded(source) ? source.cash : ceilDiv(ceilDiv(source.units * source.targetNumerator, source.targetDenominator), UNIT_SCALE)
		const cash = random.pick([0n, limit, limit, limit, source.units, source.units, source.units === 0n ? 0n : source.units - 1n, random.big(limit), limit / 2n, 1n, limit + 1n])
		const extra = source.units === 0n || random.int(4) !== 0 ? 0n : random.pick([1n, 3n, 10n ** 6n, 10n ** 18n + random.big(10n ** 18n), (1n << 127n) - source.rec - 1n])
		return [{ k: 'child', b, cash, rec: source.rec + extra }]
	}
	const b = open.length !== 0 && random.int(5) !== 0 ? random.pick(open) : random.pick(ids)
	const book = model.books.get(b)
	if (book === undefined) throw new Error('unreachable')
	const anyQuestion = random.pick(QUESTIONS)
	const prefer = (wanted: (state: ModelQuestion) => boolean) => {
		const matching = QUESTIONS.filter(id => wanted(book.questions.get(id) ?? emptyQuestion()))
		return matching.length !== 0 && random.int(6) !== 0 ? random.pick(matching) : anyQuestion
	}
	const choice = book.isSealed ? random.int(20) : random.int(100)
	const pickQuestion = () => {
		if (book.isSealed) return anyQuestion
		if (choice < 20) return prefer(state => state.finalAfter === 0 && state.frozen === 0)
		if (choice < 36) return prefer(state => state.supply !== 0n)
		if (choice < 56) return prefer(state => state.supply !== 0n && state.finalAfter === 0)
		return choice < 65 ? prefer(state => state.supply !== 0n && state.frozen === 0) : anyQuestion
	}
	const q = pickQuestion()
	const state = book.questions.get(q) ?? emptyQuestion()
	const shares = () => (state.supply === 0n ? 1n : random.pick([state.supply, state.supply, random.big(state.supply - 1n) + 1n, random.big(state.supply - 1n) + 1n, 1n, state.supply > 1n ? state.supply - 1n : 1n, state.supply + 1n]))
	if (book.isSealed) {
		if (choice < 15) {
			const frozenQuestions = QUESTIONS.filter(id => (book.questions.get(id)?.frozen ?? 0) !== 0 && (book.questions.get(id)?.supply ?? 0n) !== 0n)
			const target = frozenQuestions.length !== 0 && random.int(6) !== 0 ? random.pick(frozenQuestions) : q
			const supply = book.questions.get(target)?.supply ?? 0n
			return [{ k: 'redeem', b, q: target, shares: supply === 0n ? 1n : random.pick([supply, random.big(supply - 1n) + 1n]), ts: book.ts }]
		}
		if (choice < 17) return [{ k: 'collect', b, amount: random.pick([book.feeCash, random.big(book.feeCash), book.feeCash + 1n]) }]
		if (choice < 18) return [{ k: 'freeze', b, ts: book.ts + 1 }]
		if (choice < 19) return [{ k: 'mint', b, q, cash: 5n, ts: book.ts }]
		return [{ k: 'sched', b, q, finalAfter: 0, ts: book.ts }]
	}
	const ts = random.int(40) === 0 ? Math.max(0, book.ts - 1) : book.ts + random.pick([0, 0, 0, 0, 1, 1, 1, 2, 3, 5, 30, 1_000, 86_400, RESPONSE - 1, RESPONSE, RESPONSE + 1])
	const clock = ts + book.offset
	if (choice < 20) {
		const cash = random.int(40) === 0 ? (1n << 120n) + random.big(1n << 100n) : random.pick([1n, 2n, 7n, 1000n, 10n ** 9n, 10n ** 18n, 3n * 10n ** 20n]) + random.big(1000n)
		return [{ k: 'mint', b, q, cash: random.int(50) === 0 ? 0n : cash, ts }]
	}
	if (choice < 36) return [{ k: 'redeem', b, q, shares: shares(), ts }]
	if (choice < 56) {
		const budget = feeBudget(model, book, state)
		const seconds = random.pick([1, 2, 5, 60, 5_000, 300_000, 20_000_000])
		const divisor = BigInt(random.pick([1, 2, 3, 7, 50, 1_000, 100_000, 5_000_000]))
		let rate = random.pick([0n, 1n, budget / divisor, budget / divisor, budget / divisor + 1n, budget / divisor + 1n, budget / divisor + random.big(3n), budget + 1n, random.big(budget)])
		if (rate >= 1n << 96n) rate = (1n << 96n) - 1n
		const end = random.int(12) === 0 ? Math.max(0, clock - random.int(3)) : clock + seconds
		const stream: Op[] = [{ k: 'fee', b, q, rate, end, ts }]
		if (random.int(2) === 0) stream.push({ k: 'freeze', b, ts: ts + random.pick([1, 2, 5, 60, 5_000]) })
		return stream
	}
	if (choice < 65) {
		const finalAfter = random.pick([0, 0, 0, ts, ts + 1, ts + 1, ts + 2, ts + 5, ts + 30, ts + 1_000, ts + RESPONSE, ts + 300_000, Math.max(1, ts - 1), book.minimumFinalAfter === 0 ? ts + 3 : book.minimumFinalAfter, book.minimumFinalAfter + 1])
		const ops: Op[] = []
		if (state.rate !== 0n && state.feeEnd > clock && random.int(4) !== 0) ops.push({ k: 'fee', b, q, rate: 0n, end: 0, ts })
		ops.push({ k: 'sched', b, q, finalAfter, ts })
		return ops
	}
	if (choice < 80) return [{ k: 'freeze', b, ts }]
	if (choice < 86) return [{ k: 'enable', b, on: book.enabled ? random.int(3) !== 0 : random.int(5) !== 0, ts }]
	if (choice < 90) {
		const native = random.int(15) === 0 ? blockStart + 5_000_000 : book.ts + book.offset + random.pick([0, 1, 7, 3_000, 400_000])
		if (book.enabled && random.int(5) !== 0)
			return [
				{ k: 'enable', b, on: false, ts },
				{ k: 'clock', b, native: Math.max(native, clock) },
			]
		return [{ k: 'clock', b, native: random.int(10) === 0 ? Math.max(0, native - 2) : native }]
	}
	if (choice < 94) return [{ k: 'collect', b, amount: random.pick([book.feeCash, random.big(book.feeCash), book.feeCash + 1n]) }]
	if (book.depth <= 1 && model.books.size + 2 <= MAX_BOOKS && index >= 35 * (book.depth + 1)) return [{ k: 'seal', b, ts }]
	return [{ k: 'freeze', b, ts }]
}

// Final phase: every payable claim must be redeemable, leaving no cash behind.
const drainOps = (model: Model): Op[] => {
	const ops: Op[] = []
	for (const [b, book] of model.books) {
		let ts = book.ts
		if (!book.isSealed) {
			let last = Math.max(book.ts, book.minimumFinalAfter)
			for (const state of book.questions.values()) last = Math.max(last, state.finalAfter)
			ts = last + 2
			ops.push({ k: 'freeze', b, ts })
		}
		for (const [q, state] of book.questions) {
			if (state.supply === 0n) continue
			const frozen = state.frozen === 0 ? undefined : model.frozen.get(state.frozen)
			if (frozen === undefined ? book.isSealed : frozen.source !== b) continue
			if (state.supply > 3n) ops.push({ k: 'redeem', b, q, shares: state.supply / 3n, ts })
			ops.push({ k: 'redeem', b, q, shares: state.supply - (state.supply > 3n ? state.supply / 3n : 0n), ts })
		}
	}
	return ops
}

describe('audit fuzz: settlement book ETH accounting against an eager reference model', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let ethereum: AnvilWindowEthereum
	let blockStart = 0
	let baseline = ''

	beforeAll(async () => {
		ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		await ethereum.advanceTime(50_000_000n)
		blockStart = Number((await client.getBlock()).timestamp)
		await setBaselineSnapshot()
	})
	// Each test starts from the shared baseline; lifecycles revert to this per-test snapshot.
	beforeEach(async () => {
		baseline = await ethereum.anvilSnapshot()
	})

	// Runs one lifecycle. `source` yields the next operations given the model; returns the failure text or undefined.
	const run = async (minimum: bigint, granularity: bigint, source: (model: Model, index: number) => Op[] | undefined, record: Op[] | undefined): Promise<string | undefined> => {
		// Anvil slows down as blocks accumulate, so every lifecycle starts from the same snapshot.
		await ethereum.anvilRevert(baseline)
		baseline = await ethereum.anvilSnapshot()
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address, minimum, granularity] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('deployment address missing')
		const address: Address = receipt.contractAddress
		const target = { abi: artifact.abi, address }
		// Raw sends skip the provider's 100 ms receipt polling; a failed receipt is replayed for its reason.
		const transact = async (data: Hex) => {
			const request = { from: client.account.address, to: address, data, gas: '0x1000000', gasPrice: '0x0' }
			const hash = await ethereum.requestRaw({ method: 'eth_sendTransaction', params: [request] })
			for (let attempt = 0; attempt < 20_000; attempt++) {
				const mined = await ethereum.requestRaw({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => undefined)
				if (typeof mined === 'object' && mined !== null && 'status' in mined) {
					if (mined.status === '0x1') return
					const reason = await ethereum.requestRaw({ method: 'eth_call', params: [request, 'latest'] }).then(
						() => 'reverted on chain (replay succeeds)',
						error => String(error instanceof Error ? error.message : error),
					)
					throw new Error(reason)
				}
				await new Promise(resolve => setTimeout(resolve, 1))
			}
			throw new Error('no receipt')
		}
		await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'createBook', args: [START] }))
		let model = initialModel(minimum, granularity)
		const history: string[] = []

		const send = async (op: Op): Promise<{ reverted: string | undefined; returned?: readonly [bigint, bigint, bigint] }> => {
			try {
				const b = BigInt(op.b)
				switch (op.k) {
					case 'mint':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'mint', args: [b, BigInt(op.q), op.cash, 0n, op.ts] }))
						return { reverted: undefined }
					case 'redeem': {
						const quote = await client.simulateContract({ ...target, functionName: 'redeem', args: [b, BigInt(op.q), op.shares, 0n, op.ts] })
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'redeem', args: [b, BigInt(op.q), op.shares, 0n, op.ts] }))
						return { reverted: undefined, returned: [quote.result[0], quote.result[1], quote.result[2]] }
					}
					case 'fee':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'replaceFeeStream', args: [b, BigInt(op.q), op.rate, op.end, op.ts] }))
						return { reverted: undefined }
					case 'sched':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'scheduleFinality', args: [b, BigInt(op.q), op.finalAfter, op.ts] }))
						return { reverted: undefined }
					case 'freeze':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'freezeMatured', args: [b, op.ts] }))
						return { reverted: undefined }
					case 'enable':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'setFeeAccrualEnabled', args: [b, op.on, op.ts] }))
						return { reverted: undefined }
					case 'clock':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'setFeeClock', args: [b, op.native] }))
						return { reverted: undefined }
					case 'collect':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'collectFees', args: [b, op.amount] }))
						return { reverted: undefined }
					case 'seal':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'sealForFork', args: [b, op.ts] }))
						return { reverted: undefined }
					case 'child':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'createChildBook', args: [b, op.cash, op.rec] }))
						return { reverted: undefined }
					default:
						throw new Error('Unknown operation')
				}
			} catch (error) {
				return { reverted: String(error instanceof Error ? error.message : error).slice(0, 400) }
			}
		}

		const readBook = async (bookId: number) => {
			const [value, required] = await Promise.all([client.readContract({ ...target, functionName: 'books', args: [BigInt(bookId)] }), client.readContract({ ...target, functionName: 'requiredCash', args: [BigInt(bookId)] })])
			return { required, cash: value[0], units: value[1], feeCash: value[2], ts: Number(value[6]), isSealed: value[7], enabled: value[11], minimumFinalAfter: Number(value[12]), offset: Number(value[13]), rec: value[15] }
		}
		const readFrozen = async (frozenId: number) => {
			const value = await client.readContract({ ...target, functionName: 'frozenBooks', args: [BigInt(frozenId)] })
			return { cash: value[0], units: value[1], source: Number(value[2]), rec: value[3] }
		}

		// Compare one book (and its own frozen books) with the model and check chain-side invariants.
		const checkBook = async (bookId: number, quotes: boolean): Promise<string | undefined> => {
			const expected = model.books.get(bookId)
			if (expected === undefined) return undefined
			const [chain, ...questions] = await Promise.all([readBook(bookId), ...QUESTIONS.map(id => client.readContract({ ...target, functionName: 'scaledQuestion', args: [BigInt(bookId), BigInt(id)] }))])
			expected.rec = chain.rec
			const where = `book ${bookId}`
			if (chain.required !== requiredCash(expected)) return `${where}: required cash ${chain.required} != model ${requiredCash(expected)}`
			if (chain.cash !== expected.cash) return `${where}: cash ${chain.cash} != model ${expected.cash}`
			if (chain.units !== expected.units) return `${where}: units ${chain.units} != model ${expected.units}`
			if (chain.feeCash !== expected.feeCash) return `${where}: feeCash ${chain.feeCash} != model ${expected.feeCash}`
			if (chain.ts !== expected.ts) return `${where}: security pool clock ${chain.ts} != model ${expected.ts}`
			if (chain.offset !== expected.offset) return `${where}: fee offset ${chain.offset} != model ${expected.offset}`
			if (chain.isSealed !== expected.isSealed || chain.enabled !== expected.enabled || chain.minimumFinalAfter !== expected.minimumFinalAfter) return `${where}: flags differ ${show(chain)}`
			let liveUnits = 0n
			for (const [index, id] of QUESTIONS.entries()) {
				const read = questions[index]
				if (read === undefined) throw new Error('missing read')
				const [state, frozenBookId] = read
				const want = expected.questions.get(id) ?? emptyQuestion()
				const label = `${where} q${id}`
				if (state.units !== want.units) return `${label}: units ${state.units} != model ${want.units} (book units ${chain.units})`
				if (state.outcomeSupplyAttoShares !== want.supply) return `${label}: supply ${state.outcomeSupplyAttoShares} != model ${want.supply}`
				if (state.feePrincipalAttoEth !== want.principal) return `${label}: principal ${state.feePrincipalAttoEth} != model ${want.principal}`
				if (Number(state.finalAfter) !== want.finalAfter) return `${label}: finalAfter ${state.finalAfter} != model ${want.finalAfter}`
				if (state.feeRateAttoEthPerSecond !== want.rate) return `${label}: rate ${state.feeRateAttoEthPerSecond} != model ${want.rate}`
				if (want.rate !== 0n && Number(state.feeEnd) !== want.feeEnd) return `${label}: feeEnd ${state.feeEnd} != model ${want.feeEnd}`
				if (Number(frozenBookId) !== want.frozen) return `${label}: frozen book ${frozenBookId} != model ${want.frozen}`
				// Claim weights are compared exactly above; their cash value changes with redemption dust.
				if (frozenBookId === 0n) liveUnits += state.units
				if (quotes && want.supply !== 0n) {
					const [quoteCash, quoteUnits] = await client.readContract({ ...target, functionName: 'quoteRedemption', args: [BigInt(bookId), BigInt(id), want.supply] })
					const frozen = want.frozen === 0 ? undefined : model.frozen.get(want.frozen)
					const frozenCash = (book: ModelFrozen) => (book.source === bookId ? cashFor(book.cash, book.units, want.units) : 0n)
					const wantCash = frozen === undefined ? cashFor(expected.cash, expected.units, want.units, expected.remainder) : frozenCash(frozen)
					const wantUnits = frozen !== undefined && frozen.source !== bookId ? 0n : want.units
					if (quoteCash !== wantCash || quoteUnits !== ceilDiv(wantUnits, UNIT_SCALE)) return `${label}: quoteRedemption (${quoteCash}, ${quoteUnits}) != model (${wantCash}, ${wantUnits})`
				}
				if (quotes) {
					// Would sealing at `cutoff` copy this question to children as a live liability?
					for (const cutoff of expected.isSealed ? [expected.ts] : [expected.ts, expected.ts + 1, expected.ts + RESPONSE + 1]) {
						const right = await client.readContract({ ...target, functionName: 'hasLiveForkRecoveryRight', args: [BigInt(bookId), BigInt(id), cutoff] })
						const matures = cutoff > expected.minimumFinalAfter && want.finalAfter !== 0 && want.finalAfter <= cutoff - 1
						const wantRight = want.frozen === 0 && want.supply !== 0n && !(expected.isSealed ? false : matures)
						if (right !== wantRight) return `${label}: hasLiveForkRecoveryRight(${cutoff}) ${right} != model ${wantRight}`
					}
				}
			}
			// The aggregate fee integral and the per-question lazy fees must agree exactly.
			if (liveUnits !== chain.units) return `${where}: INVARIANT sum of live question units ${liveUnits} != book units ${chain.units} (fee drift ${chain.units - liveUnits})`
			let frozenCash = 0n
			let frozenRec = 0n
			let frozenUnits = 0n
			for (const [frozenId, frozenModel] of model.frozen) {
				if (frozenModel.source !== bookId) continue
				const frozen = await readFrozen(frozenId)
				frozenModel.rec = frozen.rec
				if (frozen.cash !== frozenModel.cash || frozen.units !== frozenModel.units || frozen.source !== frozenModel.source) return `frozen book ${frozenId}: ${show(frozen)} != model ${show(frozenModel)}`
				frozenCash += frozen.cash
				frozenRec += frozen.rec
				frozenUnits += frozen.units
			}
			let frozenQuestionUnits = 0n
			for (const want of expected.questions.values()) {
				const frozen = want.frozen === 0 ? undefined : model.frozen.get(want.frozen)
				if (frozen !== undefined && frozen.source === bookId) frozenQuestionUnits += want.units
			}
			if (frozenQuestionUnits !== frozenUnits) return `${where}: INVARIANT frozen question units ${frozenQuestionUnits} != own frozen books ${frozenUnits}`
			if (expected.cashIn !== expected.cashPaid + expected.feesAccrued + chain.cash + frozenCash) return `${where}: CASH CONSERVATION funded ${expected.cashIn} != paid ${expected.cashPaid} + fees ${expected.feesAccrued} + book ${chain.cash} + frozen ${frozenCash}`
			if (expected.recIn !== expected.recPaid + chain.rec + frozenRec) return `${where}: REP CONSERVATION funded ${expected.recIn} != paid ${expected.recPaid} + book ${chain.rec} + frozen ${frozenRec}`
			if (chain.cash === chain.units && chain.cash !== expected.cashIn - expected.cashPaid - expected.feesAccrued - frozenCash) return `${where}: fully backed book lost cash`
			return undefined
		}
		const checkAll = async () => {
			if (Number(await client.readContract({ ...target, functionName: 'lastBookId' })) !== model.books.size) return 'book count differs'
			if (Number(await client.readContract({ ...target, functionName: 'lastFrozenBookId' })) !== model.frozen.size) return `frozen book count ${await client.readContract({ ...target, functionName: 'lastFrozenBookId' })} != model ${model.frozen.size}`
			for (const id of model.books.keys()) {
				const problem = await checkBook(id, true)
				if (problem !== undefined) return problem
			}
			return undefined
		}

		const execute = async (op: Op, index: number): Promise<string | undefined> => {
			history.push(`#${index} ${show(op)}`)
			const context = () => `\n  last operations:\n    ${history.slice(-25).join('\n    ')}`
			// A mint behind a freeze that may empty the REP basket: split so the model sees the basket first.
			const book = model.books.get(op.b)
			if (op.k === 'mint' && book !== undefined && !book.isSealed && book.rec !== 0n && op.ts > book.ts) {
				const problem = await execute({ k: 'freeze', b: op.b, ts: op.ts }, index)
				if (problem !== undefined) return problem
			}
			const blockTime = op.k === 'enable' ? Number((await client.getBlock()).timestamp) + 1 : 0
			const next = cloneModel(model)
			let outcome: Outcome
			try {
				outcome = apply(next, op, blockTime)
				// REP ownership is outside this ETH model; cash-only minting must still respect its separate funding quote.
				// A requirement of 2^128 attoREP or more is unrepresentable and rejected with a reason, never a panic.
				if (outcome.ok && op.k === 'mint' && book !== undefined && book.rec !== 0n) {
					const required = await client.readContract({ ...target, functionName: 'quoteMintRecoveryRep', args: [BigInt(op.b), BigInt(op.q), op.cash] }).catch((error: unknown) => {
						if (error instanceof Error && error.message.includes('Recovery REP exceeds precision bound')) return undefined
						throw error
					})
					if (required === undefined) outcome = reject('recovery precision bound')
					else if (required !== 0n) outcome = reject('recovery funding needed')
				}
			} catch (error) {
				return `${String(error instanceof Error ? error.message : error)} at ${show(op)}${context()}`
			}
			const result = await send(op)
			if (outcome.ok && result.reverted !== undefined) return `UNEXPECTED REVERT (model: must succeed) at ${show(op)}: ${result.reverted}${context()}`
			if (!outcome.ok && result.reverted === undefined) return `UNEXPECTED SUCCESS (model: must revert, ${outcome.why}) at ${show(op)}${context()}`
			if (!outcome.ok) return undefined
			model = next
			if (op.k === 'redeem' && result.returned !== undefined) {
				const [cash, , recovery] = result.returned
				if (cash !== outcome.paid) return `redeem returned cash ${cash} != model ${outcome.paid} at ${show(op)}${context()}`
				const paying = model.books.get(op.b)
				if (paying !== undefined) paying.recPaid += recovery
			}
			for (const id of outcome.touched) {
				const problem = await checkBook(id, false)
				if (problem !== undefined) return `${problem}\n  after ${show(op)}${context()}`
			}
			return undefined
		}

		let index = 0
		for (;;) {
			const ops = source(model, index)
			if (ops === undefined) break
			for (const op of ops) {
				record?.push(op)
				const problem = await execute(op, index)
				if (problem !== undefined) return problem
				index++
			}
			if (index % 16 === 0) {
				const problem = await checkAll()
				if (problem !== undefined) return `${problem} (periodic full check)\n    ${history.slice(-25).join('\n    ')}`
			}
		}
		const problem = await checkAll()
		if (problem !== undefined) return `${problem} (final full check)\n    ${history.slice(-25).join('\n    ')}`
		return undefined
	}

	const runSeed = async (seed: number): Promise<string | undefined> => {
		const random = makeRandom(seed)
		const minimum = random.pick([1n, 1n, 1n, SCALE / 2n, SCALE / 2n, (SCALE * 9n) / 10n, 333_333_333_333_333_333n, 333_333_333_333_333_333n, seed % 9 === 0 ? SCALE : SCALE - 1n])
		// Derived from the seed so the random stream, and every existing seed's operations, stay unchanged.
		const granularity = PRECISION_BOUND_SEEDS.includes(seed) ? 1n : ([1n, 16n, 4_096n][seed % 3] ?? 1n)
		const recorded: Op[] = []
		let drained = false
		const failure = await run(
			minimum,
			granularity,
			(model, index) => {
				if (index < STEPS) return generate(model, random, blockStart, index)
				if (drained) {
					// After the drain every question must be empty and no cash may remain claimable-but-stuck.
					for (const [bookId, book] of model.books) {
						for (const [questionId, state] of book.questions) {
							const frozen = state.frozen === 0 ? undefined : model.frozen.get(state.frozen)
							const payableHere = frozen === undefined ? !book.isSealed : frozen.source === bookId
							if (payableHere && state.supply !== 0n) throw new Error(`drain left supply in book ${bookId} q${questionId}`)
						}
						if (!book.isSealed && (book.units !== 0n || book.cash !== 0n)) throw new Error(`LOCKED CASH: drained book ${bookId} retains cash ${book.cash} units ${book.units}`)
					}
					for (const [frozenId, frozen] of model.frozen) if (frozen.units !== 0n || frozen.cash !== 0n) throw new Error(`LOCKED CASH: frozen book ${frozenId} retains cash ${frozen.cash} units ${frozen.units}`)
					return undefined
				}
				drained = true
				return drainOps(model)
			},
			recorded,
		).catch(error => String(error instanceof Error ? error.message : error))
		if (failure === undefined) return undefined
		// Shrink: drop operations while the lifecycle still fails (any failure).
		const replay = (ops: Op[]) => run(minimum, granularity, (_model, index) => (index < ops.length ? ops.slice(index, index + 1) : undefined), undefined).catch(error => String(error instanceof Error ? error.message : error))
		let best = recorded
		let bestFailure = failure
		const deadline = Date.now() + SHRINK_MS
		for (let chunk = Math.max(1, Math.floor(best.length / 2)); chunk >= 1 && Date.now() < deadline; chunk = Math.floor(chunk / 2)) {
			for (let start = 0; start < best.length && Date.now() < deadline; ) {
				const candidate = [...best.slice(0, start), ...best.slice(start + chunk)]
				const result = await replay(candidate)
				if (result !== undefined) {
					best = candidate
					bestFailure = result
				} else start += chunk
			}
			if (chunk === 1) break
		}
		return `seed ${seed} (minimum rate ${minimum}, fee end granularity ${granularity}): ${failure}\n--- shrunk to ${best.length} operations ---\n${best.map(show).join('\n')}\n--- shrunk failure ---\n${bestFailure}`
	}

	test('#1463 mints into a fee-eroded question revert at the settlement principal bound', async () => {
		// Shrunk traces of seeds 9100038 and 51312 at minimum outcome rate 1 attoETH and fee end granularity 1.
		const traces: Op[][] = [
			[
				{ k: 'mint', b: 1, q: 1, cash: 1000000000000000981n, ts: 606844 },
				{ k: 'fee', b: 1, q: 1, rate: 1000000000000000979000000000n, end: 21386461, ts: 1386461 },
				{ k: 'mint', b: 1, q: 1, cash: 1000000000000000954n, ts: 1386525 },
			],
			[
				{ k: 'mint', b: 1, q: 1, cash: 1000000000000000968n, ts: 1042812 },
				{ k: 'mint', b: 1, q: 1, cash: 300000000000000000191n, ts: 1302018 },
				{ k: 'fee', b: 1, q: 1, rate: 6020000000000000017140000000n, end: 21302022, ts: 1302022 },
				{ k: 'mint', b: 1, q: 1, cash: 1000000000000000804n, ts: 1906977 },
			],
		]
		for (const trace of traces) {
			// The model predicts the final mint's revert; the chain replay must agree with every step.
			const model = initialModel(1n, 1n)
			const outcomes = trace.map(op => apply(model, op, 0))
			expect(outcomes.at(-1)).toEqual({ ok: false, why: 'principal precision bound' })
			expect(outcomes.slice(0, -1).every(outcome => outcome.ok)).toBe(true)
			expect(await run(1n, 1n, (_model, index) => (index < trace.length ? trace.slice(index, index + 1) : undefined), undefined)).toBeUndefined()
		}
	})

	test('random lifecycles match the reference model exactly', async () => {
		const failures: string[] = []
		const seeds = [...Array.from({ length: SEEDS }, (_, offset) => FIRST_SEED + offset), ...REGRESSION_SEEDS]
		for (const seed of seeds) {
			const failure = await runSeed(seed)
			if (failure !== undefined) {
				failures.push(failure)
				console.log(failure)
				if (failures.length >= 2) break
			}
		}
		expect(failures).toEqual([])
	})
})
