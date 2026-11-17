import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as artifact } from '../types/contractArtifact'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

// Stateful fuzz of SecurityPoolResolutionPremiumBook against an eager per-question model
// (each question's remaining units are reduced explicitly at every checkpoint; no trees).
// The model predicts whether each call must succeed, its return values and the resulting state.
// Fork ordering follows the coordinator: choices only grow and stop before the first recovery.
// Long run: AUDIT_FUZZ_SEEDS=60 AUDIT_FUZZ_FIRST_SEED=1 AUDIT_FUZZ_STEPS=160 AUDIT_FUZZ_SHRINK_MS=60000 bun ./tooling/testing/bun-test.mts --timeout 3000000 solidity/ts/tests/auditPremiumBookFuzz.test.ts

const SEEDS = Number(process.env['AUDIT_FUZZ_SEEDS'] ?? '5')
const FIRST_SEED = Number(process.env['AUDIT_FUZZ_FIRST_SEED'] ?? '1')
const STEPS = Number(process.env['AUDIT_FUZZ_STEPS'] ?? '150')
const SHRINK_MS = Number(process.env['AUDIT_FUZZ_SHRINK_MS'] ?? '60000')
const QUESTIONS = [1, 2, 3, 4, 5] as const
const SUPPLIES: Record<number, bigint> = { 1: 1n, 2: 3n, 3: 10n ** 18n, 4: (1n << 100n) + 12_345n, 5: 1_000_003n }
const WINDOW = 259_200 + 7 * 604_800
const RESPONSE = 259_200
const MAX_RATE = (1n << 96n) - 1n
const MAX_UNITS = (1n << 128n) - 1n
const MAX_INHERITED = 10n ** 12n
const MAX_TIME = (1 << 24) * (1 << 24) - 1
const START = 1_000
const MAX_BOOKS = 9

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
	| { k: 'fund'; u: number; q: number; cash: bigint }
	| { k: 'sched'; u: number; q: number; finalAfter: number }
	| { k: 'cancel'; u: number; q: number }
	| { k: 'check'; u: number; ts: number }
	| { k: 'freeze'; u: number }
	| { k: 'choose'; u: number; child: number; chosen: bigint; total: bigint }
	| { k: 'create'; u: number; child: number }
	| { k: 'recover'; u: number; q: number; shares: bigint; supply: bigint }
const show = (value: unknown) => JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? `${item}n` : item))

type ModelQuestion = { units: bigint; rate: bigint; end: number }
type ModelBook = {
	cash: bigint
	units: bigint
	ts: number
	minimumFinalAfter: number
	isSealed: boolean
	assigned: bigint
	recoveredUnits: bigint
	recoveredCash: bigint
	handedToChildren: bigint
	neutralAtRecovery: bigint | undefined
	depth: number
	questions: Map<number, ModelQuestion>
	recoveredShares: Map<number, bigint>
}
type Stats = { earned: bigint; unused: bigint; cancelled: bigint; recovered: bigint; funded: bigint; burned: bigint }
type Model = { books: Map<number, ModelBook>; branchCash: Map<number, bigint>; totalCash: bigint; stats: Stats }
const newStats = (): Stats => ({ earned: 0n, unused: 0n, cancelled: 0n, recovered: 0n, funded: 0n, burned: 0n })
const cloneModel = (model: Model): Model => ({
	totalCash: model.totalCash,
	stats: { ...model.stats },
	branchCash: new Map(model.branchCash),
	books: new Map([...model.books].map(([id, value]) => [id, { ...value, recoveredShares: new Map(value.recoveredShares), questions: new Map([...value.questions].map(([questionId, state]) => [questionId, { ...state }])) }])),
})
const newBook = (ts: number, minimumFinalAfter: number, depth: number): ModelBook => ({ cash: 0n, units: 0n, ts, minimumFinalAfter, isSealed: false, assigned: 0n, recoveredUnits: 0n, recoveredCash: 0n, handedToChildren: 0n, neutralAtRecovery: undefined, depth, questions: new Map(), recoveredShares: new Map() })

type Outcome = { ok: true; touched: number[]; returns?: bigint[] } | { ok: false; why: string }
const reject = (why: string): Outcome => ({ ok: false, why })
const takeUnits = (model: Model, book: ModelBook, units: bigint) => {
	if (units > book.units) throw new Error(`MODEL: taking ${units} units from a book holding ${book.units}`)
	const cash = units === book.units ? book.cash : (book.cash * units) / book.units
	book.units -= units
	book.cash -= cash
	model.totalCash -= cash
	return cash
}

const apply = (model: Model, op: Op, blockTime: number): Outcome => {
	const book = model.books.get(op.u)
	switch (op.k) {
		case 'fund': {
			if (book === undefined || book.isSealed || op.cash === 0n) return reject('funding unavailable')
			if (book.units !== 0n && book.cash === 0n) return reject('book unfunded')
			const state = book.questions.get(op.q) ?? { units: 0n, rate: 0n, end: 0 }
			if (state.end !== 0) return reject('already active')
			const units = book.units === 0n ? op.cash : (op.cash * book.units + book.cash - 1n) / book.cash
			if (book.units + units > MAX_UNITS) return reject('unit domain')
			state.units += units
			book.units += units
			book.cash += op.cash
			model.totalCash += op.cash
			model.stats.funded += op.cash
			book.questions.set(op.q, state)
			return { ok: true, touched: [op.u], returns: [units] }
		}
		case 'sched': {
			if (book?.isSealed) return reject('sealed')
			const state = book?.questions.get(op.q)
			if (book === undefined || state === undefined || state.units === 0n) return { ok: true, touched: [op.u] }
			if (state.end === 0) {
				const rate = state.units / BigInt(WINDOW)
				state.rate = rate > MAX_RATE ? MAX_RATE : rate
			}
			// A floored or capped rate never stretches the stream past the prepaid window.
			const uncapped = state.rate === 0n ? BigInt(WINDOW) : state.units / state.rate
			const duration = uncapped > BigInt(WINDOW) ? BigInt(WINDOW) : uncapped
			const latest = BigInt(book.ts) + duration
			const maximumEnd = latest > BigInt(MAX_TIME) ? MAX_TIME : Number(latest)
			const end = op.finalAfter === 0 ? maximumEnd : Math.min(op.finalAfter, maximumEnd)
			if (end < book.ts) return reject('finality elapsed')
			state.end = end
			return { ok: true, touched: [op.u] }
		}
		case 'cancel': {
			if (book === undefined || book.isSealed) return { ok: true, touched: [op.u], returns: [0n] }
			const state = book.questions.get(op.q)
			if (state === undefined || state.units === 0n) return { ok: true, touched: [op.u], returns: [0n] }
			const cash = takeUnits(model, book, state.units)
			book.questions.delete(op.q)
			model.stats.cancelled += cash
			return { ok: true, touched: [op.u], returns: [cash] }
		}
		case 'check': {
			if (book?.isSealed) return { ok: true, touched: [op.u], returns: [0n, 0n] }
			if (book === undefined || op.ts < book.ts || op.ts > blockTime) return reject('invalid clock')
			let earned = 0n
			for (const state of book.questions.values()) {
				if (state.end === 0 || state.rate === 0n) continue
				const seconds = Math.min(op.ts, state.end) - Math.min(book.ts, state.end)
				if (seconds <= 0) continue
				const amount = state.rate * BigInt(seconds)
				if (amount > state.units) throw new Error(`MODEL: question earns ${amount} beyond its ${state.units} funded units`)
				state.units -= amount
				earned += amount
			}
			const earnedCash = earned === 0n ? 0n : takeUnits(model, book, earned)
			let unusedCash = 0n
			if (op.ts > book.minimumFinalAfter) {
				let unused = 0n
				for (const [id, state] of [...book.questions]) {
					if (state.end === 0 || state.end > op.ts - 1) continue
					unused += state.units
					book.questions.delete(id)
				}
				if (unused !== 0n) unusedCash = takeUnits(model, book, unused)
			}
			book.ts = op.ts
			model.stats.earned += earnedCash
			model.stats.unused += unusedCash
			return { ok: true, touched: [op.u], returns: [earnedCash, unusedCash] }
		}
		case 'freeze': {
			if (book === undefined) return reject('unknown source')
			book.isSealed = true
			return { ok: true, touched: [op.u] }
		}
		case 'choose': {
			if (book === undefined || !book.isSealed || model.books.has(op.child) || op.total === 0n || op.chosen > op.total) return reject('invalid choice')
			const amount = (book.cash * op.chosen) / op.total
			const previous = model.branchCash.get(op.child) ?? 0n
			if (amount < previous) return reject('choice decreased (checked subtraction)')
			book.assigned += amount - previous
			model.branchCash.set(op.child, amount)
			return { ok: true, touched: [op.u] }
		}
		case 'create': {
			if (book === undefined || !book.isSealed || model.books.has(op.child)) return reject('invalid child')
			const cash = model.branchCash.get(op.child) ?? 0n
			const child = newBook(book.ts, book.ts + RESPONSE, book.depth + 1)
			let burned = 0n
			if (cash === 0n || book.units / cash > MAX_INHERITED) {
				// The branch starts empty. Its dust leaves the source's assigned cash and custody
				// together, so the neutral cash that recovery divides does not change.
				if (cash > book.assigned) throw new Error('MODEL: branch cash exceeds assigned cash')
				book.assigned -= cash
				book.cash -= cash
				model.totalCash -= cash
				model.branchCash.set(op.child, 0n)
				model.stats.burned += cash
				burned = cash
			} else {
				child.cash = cash
				child.units = book.units
				child.questions = new Map([...book.questions].map(([id, state]) => [id, { ...state }]))
				book.handedToChildren += cash
			}
			model.books.set(op.child, child)
			return { ok: true, touched: [op.u, op.child], returns: [burned] }
		}
		case 'recover': {
			if (book === undefined || !book.isSealed) return reject('source not sealed')
			const questionUnits = book.questions.get(op.q)?.units ?? 0n
			if (questionUnits === 0n || op.shares === 0n) return { ok: true, touched: [op.u], returns: [0n] }
			const before = book.recoveredShares.get(op.q) ?? 0n
			const after = before + op.shares
			if (after > op.supply) return reject('recovery exceeds supply')
			const units = (questionUnits * after) / op.supply - (questionUnits * before) / op.supply
			if (book.assigned > book.cash) return reject('assigned cash exceeds book cash (checked subtraction)')
			const neutral = book.cash - book.assigned
			const cash = (neutral * (book.recoveredUnits + units)) / book.units - (neutral * book.recoveredUnits) / book.units
			if (cash > model.totalCash) throw new Error(`MODEL: recovery of ${cash} exceeds total custody ${model.totalCash}`)
			book.recoveredShares.set(op.q, after)
			book.recoveredUnits += units
			book.recoveredCash += cash
			// Once recovery starts, the cash it divides is fixed: later child creations cannot change it.
			if (book.neutralAtRecovery === undefined) book.neutralAtRecovery = neutral
			if (neutral !== book.neutralAtRecovery) throw new Error(`MODEL: neutral cash changed from ${book.neutralAtRecovery} to ${neutral} after recovery started`)
			model.totalCash -= cash
			model.stats.recovered += cash
			// Properties, not mirrors: recoveries never exceed the neutral cash or the book's units.
			if (book.recoveredUnits > book.units) throw new Error(`MODEL: recovered units ${book.recoveredUnits} exceed book units ${book.units}`)
			if (book.recoveredCash > neutral) throw new Error(`MODEL: recovered cash ${book.recoveredCash} exceeds neutral cash ${neutral}`)
			return { ok: true, touched: [op.u], returns: [cash] }
		}
		default:
			throw new Error('Unknown operation')
	}
}

const childSlots = (source: number) => [source * 10 + 1, source * 10 + 2, source * 10 + 3]

const generate = (model: Model, random: Random, blockStart: number, index: number, huge: boolean): Op[] => {
	const ids = [...model.books.keys()]
	const open = ids.filter(id => model.books.get(id)?.isSealed === false)
	const forked = ids.filter(id => model.books.get(id)?.isSealed === true)
	const unsealedOrAny = () => (open.length !== 0 ? random.pick(open) : random.pick(ids))
	const u = forked.length !== 0 && (open.length === 0 || random.int(3) === 0) ? random.pick(forked) : unsealedOrAny()
	const book = model.books.get(u)
	if (book === undefined) throw new Error('unreachable')
	const q = random.pick(QUESTIONS)
	if (book.isSealed) {
		const slots = childSlots(u)
		const uncreated = slots.filter(id => !model.books.has(id))
		const choice = book.neutralAtRecovery !== undefined ? 8 + random.int(12) : random.int(20)
		if (book.neutralAtRecovery === undefined && uncreated.length !== 0 && choice < 9) {
			const child = random.pick(uncreated)
			const total = 10n ** 18n
			// Keep the sum of branch commitments within the fork's total, and each branch monotonic.
			let others = 0n
			for (const slot of slots) if (slot !== child) others += ((model.branchCash.get(slot) ?? 0n) * total + book.cash - 1n) / (book.cash === 0n ? 1n : book.cash)
			const room = total > others ? total - others : 0n
			const previous = book.cash === 0n ? 0n : ((model.branchCash.get(child) ?? 0n) * total + book.cash - 1n) / book.cash
			const boundary = book.units === 0n || book.cash === 0n ? 0n : (book.units * total) / (MAX_INHERITED * book.cash)
			let chosen = random.pick([0n, 1n, 1_000n, 10n ** 9n, boundary, boundary + 1n, boundary + random.big(boundary), 10n ** 15n, 10n ** 17n, total / 2n, total / 3n, room, random.big(room)])
			if (chosen > room) chosen = room
			if (chosen < previous && random.int(12) !== 0) chosen = previous
			return [{ k: 'choose', u, child, chosen, total }]
		}
		if (uncreated.length !== 0 && choice < 13 && model.books.size < MAX_BOOKS) {
			const chosen = uncreated.filter(id => (model.branchCash.get(id) ?? 0n) !== 0n)
			return [{ k: 'create', u, child: chosen.length !== 0 && random.int(5) !== 0 ? random.pick(chosen) : random.pick(uncreated) }]
		}
		if (choice < 18) {
			const withUnits = QUESTIONS.filter(id => (book.questions.get(id)?.units ?? 0n) !== 0n && (book.recoveredShares.get(id) ?? 0n) < (SUPPLIES[id] ?? 0n))
			const target = withUnits.length !== 0 && random.int(8) !== 0 ? random.pick(withUnits) : q
			const supply = SUPPLIES[target] ?? 1n
			const left = supply - (book.recoveredShares.get(target) ?? 0n)
			const shares = random.pick([left, random.big(left), random.big(left), 1n, left / 2n, left / 7n, random.int(10) === 0 ? left + 1n : left])
			return [{ k: 'recover', u, q: target, shares, supply }]
		}
		return [
			random.pick<Op>([
				{ k: 'check', u, ts: book.ts + 5 },
				{ k: 'cancel', u, q },
				{ k: 'sched', u, q, finalAfter: 0 },
				{ k: 'fund', u, q, cash: 5n },
				{ k: 'freeze', u },
			]),
		]
	}
	const room = blockStart - 1_000 - book.ts
	const pickDelta = () => {
		const delta = random.pick([0, 1, 1, 2, 5, 60, 3_600, 86_400, RESPONSE - 1, RESPONSE, RESPONSE + 1, WINDOW / 2, WINDOW - 1, WINDOW, WINDOW + 1])
		return delta > room ? 1 : delta
	}
	const choice = random.int(100)
	const active = (wanted: (state: ModelQuestion | undefined) => boolean) => {
		const matching = QUESTIONS.filter(id => wanted(book.questions.get(id)))
		return matching.length !== 0 && random.int(6) !== 0 ? random.pick(matching) : q
	}
	if (choice < 22) {
		const target = active(state => state === undefined || state.end === 0)
		const base = huge && random.int(2) === 0 ? random.pick([10n ** 36n, 4n * 10n ** 36n, 3n * 10n ** 37n, 8n * 10n ** 37n]) : random.pick([1n, 7n, 1_000n, BigInt(WINDOW) - 1n, BigInt(WINDOW), BigInt(WINDOW) * 3n + 1n, 10n ** 9n, 10n ** 18n, BigInt(WINDOW) * 10n ** 18n, 10n ** 24n])
		return [{ k: 'fund', u, q: target, cash: random.int(40) === 0 ? 0n : base + random.big(base / 3n) }]
	}
	if (choice < 44) {
		const target = active(state => state !== undefined && state.units !== 0n)
		const ts = book.ts
		const finalAfter = random.pick([0, 0, ts, ts + 1, ts + 2, ts + 60, ts + 86_400, ts + RESPONSE, ts + RESPONSE + 1, ts + WINDOW - 1, ts + WINDOW, ts + WINDOW + 5, ts + 2 * WINDOW, Math.max(1, ts - 1), book.minimumFinalAfter === 0 ? ts + 7 : book.minimumFinalAfter, book.minimumFinalAfter + 1])
		return [{ k: 'sched', u, q: target, finalAfter }]
	}
	if (choice < 50) return [{ k: 'cancel', u, q: active(state => state !== undefined && state.units !== 0n) }]
	if (choice < 92) return [{ k: 'check', u, ts: random.int(40) === 0 ? Math.max(0, book.ts - 1) : book.ts + pickDelta() }]
	if (choice < 97 && index >= 20 * (book.depth + 1) && book.depth <= 2 && model.books.size + 2 <= MAX_BOOKS && (book.cash !== 0n || random.int(8) === 0)) return [{ k: 'freeze', u }]
	return [{ k: 'check', u, ts: book.ts + pickDelta() }]
}

const drainOps = (model: Model, blockStart: number): Op[] => {
	const ops: Op[] = []
	for (const [u, book] of model.books) {
		if (book.isSealed) {
			for (const id of QUESTIONS) {
				const supply = SUPPLIES[id] ?? 1n
				const left = supply - (book.recoveredShares.get(id) ?? 0n)
				if ((book.questions.get(id)?.units ?? 0n) === 0n || left === 0n) continue
				if (left > 2n) ops.push({ k: 'recover', u, q: id, shares: left / 2n, supply })
				ops.push({ k: 'recover', u, q: id, shares: left - (left > 2n ? left / 2n : 0n), supply })
			}
			continue
		}
		const ts = Math.min(blockStart - 500, Math.max(book.ts, book.minimumFinalAfter) + 2 * WINDOW)
		if (ts >= book.ts) ops.push({ k: 'check', u, ts })
		for (const id of QUESTIONS) ops.push({ k: 'cancel', u, q: id })
	}
	return ops
}

describe('audit fuzz: resolution premium book against an eager reference model', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let ethereum: AnvilWindowEthereum
	let blockStart = 0
	let baseline = ''

	beforeAll(async () => {
		ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
	})

	const run = async (source: (model: Model, index: number) => Op[] | undefined, record: Op[] | undefined): Promise<string | undefined> => {
		// Anvil slows down as blocks accumulate, so every lifecycle starts from the same snapshot.
		await ethereum.anvilRevert(baseline)
		baseline = await ethereum.anvilSnapshot()
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('deployment address missing')
		const address: Address = receipt.contractAddress
		const target = { abi: artifact.abi, address }
		const transact = async (data: Hex) => {
			const request = { from: client.account.address, to: address, data, gas: '0x1c9c380', gasPrice: '0x0' }
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
		await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'register', args: [0n, START] }))
		let model: Model = { books: new Map([[0, newBook(START, 0, 0)]]), branchCash: new Map(), totalCash: 0n, stats: newStats() }
		const history: string[] = []

		// Simulates first (for return values), then sends.
		const send = async (op: Op): Promise<{ reverted: string | undefined; returns?: bigint[] }> => {
			try {
				const u = BigInt(op.u)
				switch (op.k) {
					case 'fund': {
						const quote = await client.simulateContract({ ...target, functionName: 'fund', args: [u, BigInt(op.q), op.cash] })
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'fund', args: [u, BigInt(op.q), op.cash] }))
						return { reverted: undefined, returns: [quote.result] }
					}
					case 'sched':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'schedule', args: [u, BigInt(op.q), op.finalAfter] }))
						return { reverted: undefined }
					case 'cancel': {
						const quote = await client.simulateContract({ ...target, functionName: 'cancel', args: [u, BigInt(op.q)] })
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'cancel', args: [u, BigInt(op.q)] }))
						return { reverted: undefined, returns: [quote.result] }
					}
					case 'check': {
						const quote = await client.simulateContract({ ...target, functionName: 'checkpoint', args: [u, op.ts] })
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'checkpoint', args: [u, op.ts] }))
						return { reverted: undefined, returns: [quote.result[0], quote.result[1]] }
					}
					case 'freeze':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'freeze', args: [u] }))
						return { reverted: undefined }
					case 'choose':
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'choose', args: [u, BigInt(op.child), op.chosen, op.total] }))
						return { reverted: undefined }
					case 'create': {
						const quote = await client.simulateContract({ ...target, functionName: 'createChild', args: [u, BigInt(op.child)] })
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'createChild', args: [u, BigInt(op.child)] }))
						return { reverted: undefined, returns: [quote.result] }
					}
					case 'recover': {
						const quote = await client.simulateContract({ ...target, functionName: 'recover', args: [u, BigInt(op.q), op.shares, op.supply] })
						await transact(encodeFunctionData({ abi: artifact.abi, functionName: 'recover', args: [u, BigInt(op.q), op.shares, op.supply] }))
						return { reverted: undefined, returns: [quote.result] }
					}
					default:
						throw new Error('Unknown operation')
				}
			} catch (error) {
				return { reverted: String(error instanceof Error ? error.message : error).slice(0, 400) }
			}
		}

		const checkBook = async (universe: number): Promise<string | undefined> => {
			const expected = model.books.get(universe)
			if (expected === undefined) return undefined
			const u = BigInt(universe)
			const [chain, minimumFinalAfter, ...questions] = await Promise.all([
				client.readContract({ ...target, functionName: 'totals', args: [u] }),
				client.readContract({ ...target, functionName: 'minimumFinalAfter', args: [u] }),
				...QUESTIONS.map(id => client.readContract({ ...target, functionName: 'question', args: [u, BigInt(id)] })),
			])
			const where = `universe ${universe}`
			if (chain[0] !== expected.cash) return `${where}: cash ${chain[0]} != model ${expected.cash}`
			if (chain[1] !== expected.units) return `${where}: units ${chain[1]} != model ${expected.units}`
			if (Number(chain[2]) !== expected.ts) return `${where}: clock ${chain[2]} != model ${expected.ts}`
			if (chain[3] !== expected.isSealed) return `${where}: sealed ${chain[3]} != model ${expected.isSealed}`
			if (Number(minimumFinalAfter) !== expected.minimumFinalAfter) return `${where}: minimumFinalAfter ${minimumFinalAfter} != model ${expected.minimumFinalAfter}`
			let questionUnits = 0n
			let questionCash = 0n
			for (const [index, id] of QUESTIONS.entries()) {
				const read = questions[index]
				if (read === undefined) throw new Error('missing read')
				const want = expected.questions.get(id)?.units ?? 0n
				if (read[0] !== want) return `${where} q${id}: units ${read[0]} != model ${want} (book units ${chain[1]})`
				const wantCash = want === 0n ? 0n : (expected.cash * want) / expected.units
				if (read[1] !== wantCash) return `${where} q${id}: cash ${read[1]} != model ${wantCash}`
				questionUnits += read[0]
				questionCash += read[1]
			}
			if (questionUnits !== chain[1]) return `${where}: INVARIANT sum of question units ${questionUnits} != book units ${chain[1]}`
			if (questionCash > chain[0]) return `${where}: INVARIANT question cash ${questionCash} exceeds book cash ${chain[0]}`
			if (chain[1] === 0n && chain[0] !== 0n && !chain[3]) return `${where}: INVARIANT cash ${chain[0]} stranded in a book without units`
			if (chain[0] === 0n && chain[1] !== 0n && !chain[3]) return `${where}: INVARIANT units ${chain[1]} without cash (funding would revert)`
			for (const child of childSlots(universe)) {
				const branch = await client.readContract({ ...target, functionName: 'branchCash', args: [BigInt(child)] })
				if (branch !== (model.branchCash.get(child) ?? 0n)) return `${where}: branchCash[${child}] ${branch} != model ${model.branchCash.get(child) ?? 0n}`
			}
			return undefined
		}
		// totalCash must equal the cash still owed by every book, counted once.
		const checkGlobal = async (): Promise<string | undefined> => {
			const totalCash = await client.readContract({ ...target, functionName: 'totalCash' })
			if (totalCash !== model.totalCash) return `totalCash ${totalCash} != model ${model.totalCash}`
			let owed = 0n
			for (const book of model.books.values()) {
				if (!book.isSealed) owed += book.cash
				else {
					if (book.handedToChildren + book.recoveredCash > book.cash) return `INVARIANT sealed book paid out ${book.handedToChildren} + ${book.recoveredCash} of ${book.cash}`
					owed += book.cash - book.handedToChildren - book.recoveredCash
				}
			}
			if (owed !== totalCash) return `INVARIANT totalCash ${totalCash} != cash owed by books ${owed}`
			const stats = model.stats
			if (stats.funded !== stats.earned + stats.unused + stats.cancelled + stats.recovered + stats.burned + totalCash)
				return `CONSERVATION funded ${stats.funded} != earned ${stats.earned} + unused ${stats.unused} + cancelled ${stats.cancelled} + recovered ${stats.recovered} + burned ${stats.burned} + remaining ${totalCash}`
			return undefined
		}

		const execute = async (op: Op, index: number): Promise<string | undefined> => {
			history.push(`#${index} ${show(op)}`)
			const context = () => `\n  last operations:\n    ${history.slice(-25).join('\n    ')}`
			const next = cloneModel(model)
			let outcome: Outcome
			try {
				outcome = apply(next, op, blockStart)
			} catch (error) {
				return `${String(error instanceof Error ? error.message : error)} at ${show(op)}${context()}`
			}
			const result = await send(op)
			if (outcome.ok && result.reverted !== undefined) return `UNEXPECTED REVERT (model: must succeed) at ${show(op)}: ${result.reverted}${context()}`
			if (!outcome.ok && result.reverted === undefined) return `UNEXPECTED SUCCESS (model: must revert, ${outcome.why}) at ${show(op)}${context()}`
			if (!outcome.ok) return undefined
			model = next
			if (outcome.returns !== undefined && show(outcome.returns) !== show(result.returns)) return `returned ${show(result.returns)} != model ${show(outcome.returns)} at ${show(op)}${context()}`
			for (const id of outcome.touched) {
				const problem = await checkBook(id)
				if (problem !== undefined) return `${problem}\n  after ${show(op)}${context()}`
			}
			const problem = await checkGlobal()
			if (problem !== undefined) return `${problem}\n  after ${show(op)}${context()}`
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
		}
		for (const id of model.books.keys()) {
			const problem = await checkBook(id)
			if (problem !== undefined) return `${problem} (final full check)`
		}
		return undefined
	}

	const runSeed = async (seed: number): Promise<string | undefined> => {
		const random = makeRandom(seed)
		const huge = seed % 4 === 0
		const recorded: Op[] = []
		let drained = false
		const failure = await run((model, index) => {
			if (index < STEPS) return generate(model, random, blockStart, index, huge)
			if (drained) {
				for (const [universe, book] of model.books) {
					if (!book.isSealed) {
						if (book.units !== 0n || book.cash !== 0n) throw new Error(`LOCKED CASH: drained universe ${universe} retains cash ${book.cash} units ${book.units}`)
						continue
					}
					// Every share of every funded question was recovered. The source must hold nothing
					// beyond cash assigned to branches that were never created: no neutral cash is stranded.
					let pending = 0n
					for (const child of childSlots(universe)) if (!model.books.has(child)) pending += model.branchCash.get(child) ?? 0n
					if (book.units !== 0n && book.recoveredUnits !== book.units) throw new Error(`sealed universe ${universe}: recovered units ${book.recoveredUnits} != book units ${book.units} after full recovery`)
					const stranded = book.cash - book.handedToChildren - book.recoveredCash - pending
					if (stranded < 0n) throw new Error(`OVERPAID: sealed universe ${universe} paid ${-stranded} more than it held`)
					if (stranded !== 0n) throw new Error(`STRANDED CASH: sealed universe ${universe} keeps ${stranded} that no recovery or child can claim`)
				}
				return undefined
			}
			drained = true
			return drainOps(model, blockStart)
		}, recorded).catch(error => String(error instanceof Error ? error.message : error))
		if (failure === undefined) return undefined
		const replay = (ops: Op[]) => run((_model, index) => (index < ops.length ? ops.slice(index, index + 1) : undefined), undefined).catch(error => String(error instanceof Error ? error.message : error))
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
		return `seed ${seed}: ${failure}\n--- shrunk to ${best.length} operations ---\n${best.map(show).join('\n')}\n--- shrunk failure ---\n${bestFailure}`
	}

	test('random lifecycles match the reference model exactly', async () => {
		await getAnvilWindowEthereum().advanceTime(400_000_000n)
		blockStart = Number((await client.getBlock()).timestamp)
		baseline = await ethereum.anvilSnapshot()
		const failures: string[] = []
		for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
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
