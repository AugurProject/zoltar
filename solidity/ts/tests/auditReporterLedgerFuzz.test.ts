import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, getAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts, sortStringArrayByKeccak } from '../testSupport/simulator/utils/utilities'
import { ensureZoltarDeployed, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import {
	ReputationToken_ReputationToken as repTokenArtifact,
	Zoltar_Zoltar as zoltarArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as artifact,
	test_statoblast_SecurityPoolReporterLedgerHarness_SecurityPoolReporterLedgerHarness as harness,
	test_statoblast_SecurityPoolReporterLedgerHarness_SecurityPoolReporterAuthorityHarness as authorityArtifact,
} from '../types/contractArtifact'

// Stateful fuzz of SecurityPoolReporterLedger through its canonical game/authority harnesses and
// the real Zoltar (real forks, real REP burns and child mints). The reference model keeps an
// explicit balance, deadline and finalizing universe per question; it predicts whether each
// call must succeed and the exact ledger state and token custody afterwards.
// Long run: AUDIT_FUZZ_SEEDS=60 AUDIT_FUZZ_FIRST_SEED=1 AUDIT_FUZZ_STEPS=120 AUDIT_FUZZ_SHRINK_MS=60000 bun ./tooling/testing/bun-test.mts --timeout 3000000 solidity/ts/tests/auditReporterLedgerFuzz.test.ts

const SEEDS = Number(process.env['AUDIT_FUZZ_SEEDS'] ?? '4')
const FIRST_SEED = Number(process.env['AUDIT_FUZZ_FIRST_SEED'] ?? '1')
const STEPS = Number(process.env['AUDIT_FUZZ_STEPS'] ?? '100')
const SHRINK_MS = Number(process.env['AUDIT_FUZZ_SHRINK_MS'] ?? '60000')
// Seed 51108 at 170 steps (#1463) needs a second drain pass: its first freeze matures a forked question into an unplanned final claim.
const REGRESSION_SEEDS = process.env['AUDIT_FUZZ_SEEDS'] === undefined ? [{ seed: 51108, steps: 170 }] : []
// A drain pass can seal a universe and create final claims, so drains repeat until nothing is withdrawable.
const MAX_DRAIN_PASSES = 6
const RESPONSE = 259_200
const DAY = 86_400
const QUESTION_SLOTS = [0, 1, 2, 3, 4] as const // slots 0 and 1 are real Zoltar questions
const OUTCOMES = [1, 2] as const
const erc20 = repTokenArtifact.abi

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

// Universes are named by their outcome path from the genesis universe ('' , '1', '12', ...).
type Op =
	| { k: 'reg'; u: string; q: number; at: number }
	| { k: 'dep'; u: string; q: number; amount: bigint; thresholdPlus?: bigint; at: number }
	| { k: 'wd'; u: string; q: number; amount: bigint; at: number }
	| { k: 'sch'; u: string; q: number; finalAfter: number; at: number }
	| { k: 'chk'; u: string; at: number }
	| { k: 'trig'; u: string; q: number; at: number }
	| { k: 'xfork'; u: string; q: number; at: number }
	| { k: 'frz'; u: string; at: number }
	| { k: 'child'; u: string; outcome: number; at: number }
const show = (value: unknown) => JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? `${item}n` : item))

type ModelQuestion = { balance: bigint; finalAfter: number; finalIn: string | undefined; sourceGame: string | undefined; scheduledIn: string | undefined; haircut: boolean }
type ModelBook = { live: bigint; final: bigint; ts: number; isSealed: boolean; minimumFinalAfter: number; questions: Map<number, ModelQuestion>; registered: Set<number> }
type Model = { books: Map<string, ModelBook>; forkTime: Map<string, number>; forkQuestion: Map<string, number>; now: number }
const emptyQuestion = (): ModelQuestion => ({ balance: 0n, finalAfter: 0, finalIn: undefined, sourceGame: undefined, scheduledIn: undefined, haircut: false })
const cloneModel = (model: Model): Model => ({
	now: model.now,
	forkTime: new Map(model.forkTime),
	forkQuestion: new Map(model.forkQuestion),
	books: new Map([...model.books].map(([id, value]) => [id, { ...value, registered: new Set(value.registered), questions: new Map([...value.questions].map(([questionId, state]) => [questionId, { ...state }])) }])),
})
const questionOf = (book: ModelBook, id: number) => {
	let state = book.questions.get(id)
	if (state === undefined) {
		state = emptyQuestion()
		book.questions.set(id, state)
	}
	return state
}
// What the ledger shows in `universe`: a claim finalized elsewhere has no balance here.
const view = (universe: string, state: ModelQuestion) => ({ finalClaim: state.finalIn !== undefined, balance: state.finalIn !== undefined && state.finalIn !== universe ? 0n : state.balance })

type Environment = { threshold: bigint; burnDivisor: bigint; earliestFork: number; ownerBalance: bigint }
type Outcome = { ok: true; touched: string[] } | { ok: false; why: string }
const reject = (why: string): Outcome => ({ ok: false, why })

const freeze = (universe: string, book: ModelBook, timestamp: number): string | undefined => {
	if (timestamp < book.ts) return 'clock backwards'
	book.ts = timestamp
	if (timestamp === 0 || timestamp <= book.minimumFinalAfter) return undefined
	let matured = 0n
	for (const state of book.questions.values()) if (state.finalIn === undefined && state.finalAfter !== 0 && state.finalAfter <= timestamp - 1) matured += state.balance
	if (matured === 0n) return undefined
	if (matured > book.live) throw new Error(`MODEL: matured ${matured} exceeds live ${book.live}`)
	book.live -= matured
	book.final += matured
	for (const state of book.questions.values()) if (state.finalIn === undefined && state.finalAfter !== 0 && state.finalAfter <= timestamp - 1) state.finalIn = universe
	return undefined
}
const sealFork = (model: Model, universe: string, book: ModelBook): string | undefined => {
	const forkTime = model.forkTime.get(universe)
	if (forkTime === undefined) return 'fork missing'
	const problem = freeze(universe, book, forkTime)
	if (problem !== undefined) return problem
	book.isSealed = true
	return undefined
}

const apply = (model: Model, op: Op, time: number, environment: Environment, realQuestion: boolean): Outcome => {
	const book = model.books.get(op.u)
	const forkTime = model.forkTime.get(op.u)
	const portfolioTime = forkTime ?? time
	model.now = time
	switch (op.k) {
		case 'reg': {
			if (book === undefined) return reject('universe not registered')
			if (book.registered.has(op.q)) return reject('game already bound')
			if (!book.isSealed) {
				const problem = freeze(op.u, book, portfolioTime)
				if (problem !== undefined) return reject(problem)
			}
			const state = questionOf(book, op.q)
			const seen = view(op.u, state)
			if (seen.finalClaim && seen.balance === 0n) return reject('use source reporter claim')
			if (!((!book.isSealed && forkTime === undefined) || (seen.finalClaim && seen.balance !== 0n))) return reject('universe sealed')
			state.sourceGame = `${op.u}:${op.q}`
			book.registered.add(op.q)
			return { ok: true, touched: [op.u] }
		}
		case 'dep': {
			if (book === undefined || !book.registered.has(op.q)) return reject('game not registered')
			if (book.isSealed || forkTime !== undefined) return reject('universe forked')
			const problem = freeze(op.u, book, time)
			if (problem !== undefined) return reject(problem)
			const state = questionOf(book, op.q)
			if (state.finalIn !== undefined) return reject('claim is final')
			state.balance += op.amount
			book.live += op.amount
			return { ok: true, touched: [op.u] }
		}
		case 'wd': {
			if (book === undefined || !book.registered.has(op.q)) return reject('game not registered')
			if (!book.isSealed) {
				if (forkTime === undefined) {
					const problem = freeze(op.u, book, time)
					if (problem !== undefined) return reject(problem)
				} else {
					const problem = sealFork(model, op.u, book)
					if (problem !== undefined) return reject(problem)
				}
			}
			const state = questionOf(book, op.q)
			const seen = view(op.u, state)
			if (book.isSealed && !seen.finalClaim) return reject('use child escrow')
			if (op.amount > seen.balance) return reject('escrow insufficient')
			state.balance -= op.amount
			if (seen.finalClaim) {
				book.final -= op.amount
			} else {
				book.live -= op.amount
			}
			return { ok: true, touched: [op.u] }
		}
		case 'sch': {
			if (book === undefined || !book.registered.has(op.q)) return reject('game not registered')
			if (book.isSealed || forkTime !== undefined) return reject('universe forked')
			const problem = freeze(op.u, book, time)
			if (problem !== undefined) return reject(problem)
			const state = questionOf(book, op.q)
			if (state.finalIn !== undefined) return reject('finality immutable')
			if (op.finalAfter !== 0 && op.finalAfter < time) return reject('finality elapsed')
			state.finalAfter = op.finalAfter
			state.scheduledIn = op.u
			return { ok: true, touched: [op.u] }
		}
		case 'chk': {
			if (book === undefined) return reject('universe not registered')
			if (!book.isSealed) {
				const problem = freeze(op.u, book, portfolioTime)
				if (problem !== undefined) return reject(problem)
			}
			return { ok: true, touched: [op.u] }
		}
		case 'trig': {
			if (book === undefined) return reject('universe not registered')
			if (book.isSealed || forkTime !== undefined) return reject('universe forked')
			const problem = freeze(op.u, book, time)
			if (problem !== undefined) return reject(problem)
			const state = questionOf(book, op.q)
			if (state.finalIn !== undefined || state.balance < environment.threshold) return reject('lacks admission')
			if (!realQuestion) return reject('zoltar: question does not exist')
			if (time < environment.earliestFork) return reject('zoltar: parent response period')
			const haircut = environment.threshold / environment.burnDivisor
			state.balance -= haircut
			state.haircut = true
			book.live -= haircut
			model.forkTime.set(op.u, time)
			model.forkQuestion.set(op.u, op.q)
			const sealProblem = sealFork(model, op.u, book)
			if (sealProblem !== undefined) throw new Error(`MODEL: trigger could not seal: ${sealProblem}`)
			return { ok: true, touched: [op.u] }
		}
		case 'xfork': {
			if (forkTime !== undefined) return reject('zoltar: already forked')
			if (!realQuestion) return reject('zoltar: question does not exist')
			if (book === undefined) return reject('fuzz: only registered universes are forked')
			if (time < environment.earliestFork) return reject('zoltar: parent response period')
			if (environment.ownerBalance < environment.threshold) return reject('zoltar: owner lacks threshold')
			model.forkTime.set(op.u, time)
			model.forkQuestion.set(op.u, op.q)
			return { ok: true, touched: [op.u] }
		}
		case 'frz': {
			if (book === undefined) return reject('universe not registered')
			if (book.isSealed) return { ok: true, touched: [op.u] }
			const problem = sealFork(model, op.u, book)
			if (problem !== undefined) return reject(problem)
			return { ok: true, touched: [op.u] }
		}
		case 'child': {
			if (book === undefined) return reject('universe not registered')
			if (!book.isSealed) return reject('source not sealed')
			const childId = `${op.u}${op.outcome}`
			if (model.books.has(childId)) return reject('child exists')
			const child: ModelBook = { live: book.live, final: 0n, ts: book.ts, isSealed: false, minimumFinalAfter: book.ts + RESPONSE, registered: new Set(), questions: new Map([...book.questions].map(([id, state]) => [id, { ...state }])) }
			const forkQuestion = model.forkQuestion.get(op.u)
			if (forkQuestion === undefined) throw new Error('MODEL: sealed universe without fork question')
			const fixed = child.questions.get(forkQuestion)
			if (fixed !== undefined && fixed.finalIn === undefined && fixed.balance !== 0n) {
				fixed.finalAfter = child.minimumFinalAfter
				fixed.scheduledIn = childId
			}
			model.books.set(childId, child)
			return { ok: true, touched: [op.u, childId] }
		}
		default:
			throw new Error('Unknown operation')
	}
}

const generate = (model: Model, random: Random, index: number, threshold: bigint): Op[] => {
	const ids = [...model.books.keys()]
	const u = random.pick(ids)
	const book = model.books.get(u)
	if (book === undefined) throw new Error('unreachable')
	const forked = model.forkTime.has(u)
	const step = () => random.pick([8, 8, 8, 9, 9, 10, 12, 12, 20, 20, 100, 3_600, DAY, RESPONSE - 5, RESPONSE, RESPONSE + 9])
	let at = model.now + step()
	const q = random.pick(QUESTION_SLOTS)
	const registered = [...book.registered]
	const anyRegistered = () => (registered.length !== 0 && random.int(8) !== 0 ? random.pick(registered) : q)
	if (book.isSealed) {
		const missing = OUTCOMES.filter(outcome => !model.books.has(`${u}${outcome}`))
		const choice = random.int(20)
		if (missing.length !== 0 && u.length < 2 && choice < 9) return [{ k: 'child', u, outcome: random.pick(missing), at }]
		if (choice < 15) {
			const target = anyRegistered()
			const seen = view(u, book.questions.get(target) ?? emptyQuestion())
			return [{ k: 'wd', u, q: target, amount: random.pick([seen.balance, random.big(seen.balance), seen.balance / 2n, 1n, seen.balance + 1n]), at }]
		}
		if (choice < 17) return [{ k: 'reg', u, q, at }]
		return [
			random.pick<Op>([
				{ k: 'chk', u, at },
				{ k: 'frz', u, at },
				{ k: 'dep', u, q: anyRegistered(), amount: 5n, at },
				{ k: 'sch', u, q: anyRegistered(), finalAfter: 0, at },
				{ k: 'trig', u, q, at },
			]),
		]
	}
	if (forked) {
		const choice = random.int(10)
		if (choice < 4) return [{ k: 'frz', u, at }]
		if (choice < 7) {
			const target = anyRegistered()
			const seen = view(u, book.questions.get(target) ?? emptyQuestion())
			return [{ k: 'wd', u, q: target, amount: random.pick([seen.balance, random.big(seen.balance), 1n]), at }]
		}
		return [
			random.pick<Op>([
				{ k: 'chk', u, at },
				{ k: 'dep', u, q: anyRegistered(), amount: 5n, at },
				{ k: 'reg', u, q, at },
				{ k: 'sch', u, q: anyRegistered(), finalAfter: at + 50, at },
			]),
		]
	}
	const choice = random.int(100)
	if (choice < 12 || registered.length === 0) {
		const unregistered = QUESTION_SLOTS.filter(id => !book.registered.has(id))
		return [{ k: 'reg', u, q: unregistered.length !== 0 && random.int(6) !== 0 ? random.pick(unregistered) : q, at }]
	}
	if (choice < 36) return [{ k: 'dep', u, q: anyRegistered(), amount: random.pick([0n, 1n, 7n, 10n ** 9n, 10n ** 18n, 10n ** 18n + random.big(10n ** 19n), threshold / 7n]), at }]
	if (choice < 52) {
		const target = anyRegistered()
		const seen = view(u, book.questions.get(target) ?? emptyQuestion())
		return [{ k: 'wd', u, q: target, amount: random.pick([seen.balance, random.big(seen.balance), random.big(seen.balance), seen.balance / 2n, 1n, seen.balance + 1n]), at }]
	}
	if (choice < 72) {
		const finalAfter = random.pick([0, 0, 0, at, at + 1, at + 2, at + 9, at + 10, at + 25, at + 120, at + 4_000, at + 4_000, at + RESPONSE, at + 30 * DAY, at + 300 * DAY, at - 1, book.minimumFinalAfter === 0 ? at + 15 : Math.max(at, book.minimumFinalAfter), Math.max(at, book.minimumFinalAfter + 1)])
		const target = anyRegistered()
		// Exercise the strict cutoff: act exactly at the deadline, one second before and one after.
		if (random.int(4) === 0) {
			const deadline = at + 8
			const probe = deadline + random.pick([-1, 0, 0, 0, 1])
			return [
				{ k: 'sch', u, q: target, finalAfter: deadline, at },
				random.pick<Op>([
					{ k: 'chk', u, at: probe },
					{ k: 'wd', u, q: target, amount: 1n, at: probe },
					{ k: 'dep', u, q: target, amount: 3n, at: probe },
					{ k: 'sch', u, q: target, finalAfter: probe + 40, at: probe },
				]),
			]
		}
		return [{ k: 'sch', u, q: target, finalAfter, at }]
	}
	if (choice < 84) return [{ k: 'chk', u, at }]
	if (index >= 18 && choice < 96 && u.length < 2) {
		// A child may fork only 70 days after its parent; jump there before trying.
		if (u !== '') at = Math.max(at, (model.forkTime.get(u.slice(0, -1)) ?? 0) + 71 * DAY + random.int(50))
		const real = registered.filter(id => id < 2 && book.questions.get(id)?.finalIn === undefined)
		if (real.length === 0 && !book.registered.has(0) && random.int(4) !== 0) return [{ k: 'reg', u, q: 0, at }]
		const target = real.length !== 0 && random.int(10) !== 0 ? random.pick(real) : q
		if (choice < 92) {
			const ops: Op[] = []
			// Top the triggering question up to the admission threshold first (resolved at execution).
			if (random.int(6) !== 0) ops.push({ k: 'dep', u, q: target, amount: 0n, thresholdPlus: random.pick([0n, 0n, 1n, 10n ** 18n]), at })
			ops.push({ k: 'trig', u, q: target, at: at + 9 })
			return ops
		}
		return [{ k: 'xfork', u, q: random.int(8) === 0 ? q : random.pick([0, 1]), at }]
	}
	return [{ k: 'chk', u, at: at + random.pick([0, RESPONSE, 30 * DAY]) }]
}

// Final phase: seal what forked, create nothing new, and withdraw every balance payable somewhere.
const drainOps = (model: Model): Op[] => {
	const ops: Op[] = []
	let at = model.now + 10
	for (const [u, book] of model.books) {
		if (!book.isSealed && model.forkTime.has(u)) {
			ops.push({ k: 'frz', u, at })
			at += 10
		}
		for (const [q, state] of book.questions) {
			const seen = view(u, state)
			if (seen.balance === 0n) continue
			const sealedLater = book.isSealed || model.forkTime.has(u)
			if (sealedLater && !seen.finalClaim) continue
			if (!book.registered.has(q)) {
				ops.push({ k: 'reg', u, q, at })
				at += 10
			}
			ops.push({ k: 'wd', u, q, amount: seen.balance / 3n, at })
			at += 10
			ops.push({ k: 'wd', u, q, amount: seen.balance - seen.balance / 3n, at })
			at += 10
		}
	}
	return ops
}

// After the generated steps, drain repeatedly, then require that no REP stays locked anywhere.
const drainThenCheck = (steps: (model: Model, index: number, threshold: bigint) => Op[] | undefined) => {
	let draining = false
	let passes = 0
	return (model: Model, index: number, threshold: bigint): Op[] | undefined => {
		if (!draining) {
			const ops = steps(model, index, threshold)
			if (ops !== undefined) return ops
			draining = true
		}
		const ops = drainOps(model)
		if (ops.length !== 0) {
			if (passes >= MAX_DRAIN_PASSES) throw new Error(`DRAIN DID NOT CONVERGE: ${ops.length} withdrawal operations remain after ${passes} passes`)
			passes++
			return ops
		}
		for (const [path, book] of model.books) {
			if (book.final !== 0n) throw new Error(`LOCKED REP: universe '${path}' retains final ${book.final} after the drain`)
			if (!book.isSealed && !model.forkTime.has(path) && book.live !== 0n) throw new Error(`LOCKED REP: universe '${path}' retains live ${book.live} after the drain`)
		}
		return undefined
	}
}

// Shrinking keeps a candidate only when it fails the same way, not with an unrelated harness error.
const FAILURE_CLASSES = ['LOCKED REP', 'DRAIN DID NOT CONVERGE', 'UNEXPECTED REVERT', 'UNEXPECTED SUCCESS', 'INVARIANT', 'CUSTODY'] as const
const failureClass = (failure: string) => FAILURE_CLASSES.find(name => failure.includes(name)) ?? failure.split('\n')[0]?.split(' at ')[0]?.replace(/\d+/g, 'N')

describe('audit fuzz: reporter ledger against an explicit per-question reference model', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let ethereum: AnvilWindowEthereum
	let baseline = ''
	let baseTime = 0
	const realQuestions: bigint[] = []
	let burnDivisor = 0n
	const zoltar = () => ({ abi: zoltarArtifact.abi, address: getZoltarAddress() })

	beforeAll(async () => {
		ethereum = getAnvilWindowEthereum()
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
	})

	const run = async (source: (model: Model, index: number, threshold: bigint) => Op[] | undefined, record: Op[] | undefined): Promise<string | undefined> => {
		await ethereum.anvilRevert(baseline)
		baseline = await ethereum.anvilSnapshot()
		let lastTime = baseTime
		const owner = client.account.address
		// Raw sends with explicit block timestamps; a failed receipt is replayed for its reason.
		const transact = async (to: Address | undefined, data: Hex, timestamp: number): Promise<Address | undefined> => {
			if (timestamp <= lastTime) throw new Error(`fuzz: timestamp ${timestamp} is not after ${lastTime}`)
			await ethereum.requestRaw({ method: 'evm_setNextBlockTimestamp', params: [`0x${timestamp.toString(16)}`] })
			lastTime = timestamp
			const request = { from: owner, ...(to === undefined ? {} : { to }), data, gas: '0x1000000', gasPrice: '0x0' }
			const hash = await ethereum.requestRaw({ method: 'eth_sendTransaction', params: [request] })
			for (let attempt = 0; attempt < 20_000; attempt++) {
				const mined = await ethereum.requestRaw({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => undefined)
				if (typeof mined === 'object' && mined !== null && 'status' in mined) {
					if (mined.status === '0x1') return 'contractAddress' in mined && typeof mined.contractAddress === 'string' ? getAddress(mined.contractAddress) : undefined
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
		const aux = (to: Address | undefined, data: Hex) => transact(to, data, lastTime + 1)
		const authority = await aux(undefined, encodeDeployData({ abi: authorityArtifact.abi, bytecode: `0x${authorityArtifact.evm.bytecode.object}`, args: [getZoltarAddress()] }))
		if (authority === undefined) throw new Error('authority deployment failed')
		const ledger = await aux(undefined, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [authority, getZoltarAddress()] }))
		if (ledger === undefined) throw new Error('ledger deployment failed')
		const target = { abi: artifact.abi, address: ledger }
		const asAuthority = (data: Hex) => encodeFunctionData({ abi: authorityArtifact.abi, functionName: 'execute', args: [ledger, data] })
		await aux(authority, asAuthority(encodeFunctionData({ abi: artifact.abi, functionName: 'registerUniverse', args: [0n] })))

		let model: Model = { books: new Map([['', { live: 0n, final: 0n, ts: 0, isSealed: false, minimumFinalAfter: 0, questions: new Map(), registered: new Set() }]]), forkTime: new Map(), forkQuestion: new Map(), now: lastTime }
		const history: string[] = []
		const universeIds = new Map<string, bigint>([['', 0n]])
		const universeId = async (path: string): Promise<bigint> => {
			const known = universeIds.get(path)
			if (known !== undefined) return known
			const parent = await universeId(path.slice(0, -1))
			const id = await client.readContract({ ...zoltar(), functionName: 'getChildUniverseId', args: [parent, BigInt(path.slice(-1))] })
			universeIds.set(path, id)
			return id
		}
		const questionId = (slot: number) => {
			const real = realQuestions[slot]
			return real ?? (realQuestions[0] ?? 0n) + 1_000n + BigInt(slot)
		}
		const token = async (path: string) => client.readContract({ ...zoltar(), functionName: 'getRepToken', args: [await universeId(path)] })
		const balanceOf = async (path: string, holder: Address) => {
			const address = await token(path)
			if (BigInt(address) === 0n) return 0n
			return client.readContract({ abi: erc20, address, functionName: 'balanceOf', args: [holder] })
		}
		const games = new Map<string, Address>()
		const pathOfUniverse = (id: bigint) => [...universeIds].find(([, value]) => value === id)?.[0]

		const send = async (op: Op, time: number): Promise<string | undefined> => {
			try {
				const id = await universeId(op.u)
				const game = 'q' in op ? games.get(`${op.u}:${op.q}`) : undefined
				switch (op.k) {
					case 'reg': {
						const deployed = await aux(undefined, encodeDeployData({ abi: harness.abi, bytecode: `0x${harness.evm.bytecode.object}`, args: [getZoltarAddress(), ledger, id, questionId(op.q)] }))
						if (deployed === undefined) throw new Error('game deployment failed')
						const repToken = await token(op.u)
						if (BigInt(repToken) !== 0n) await aux(repToken, encodeFunctionData({ abi: erc20, functionName: 'approve', args: [deployed, (1n << 255n) - 1n] }))
						await transact(authority, asAuthority(encodeFunctionData({ abi: artifact.abi, functionName: 'registerGame', args: [questionId(op.q), deployed] })), time)
						games.set(`${op.u}:${op.q}`, deployed)
						return undefined
					}
					case 'dep':
						if (game === undefined) throw new Error('fuzz: no game')
						await transact(game, encodeFunctionData({ abi: harness.abi, functionName: 'deposit', args: [op.amount] }), time)
						return undefined
					case 'wd':
						if (game === undefined) throw new Error('fuzz: no game')
						await transact(game, encodeFunctionData({ abi: harness.abi, functionName: 'withdraw', args: [owner, op.amount] }), time)
						return undefined
					case 'sch':
						if (game === undefined) throw new Error('fuzz: no game')
						await transact(game, encodeFunctionData({ abi: harness.abi, functionName: 'schedule', args: [op.finalAfter] }), time)
						return undefined
					case 'chk':
						await transact(ledger, encodeFunctionData({ abi: artifact.abi, functionName: 'checkpoint', args: [id] }), time)
						return undefined
					case 'trig':
						await transact(authority, asAuthority(encodeFunctionData({ abi: artifact.abi, functionName: 'triggerFork', args: [id, questionId(op.q)] })), time)
						return undefined
					case 'xfork': {
						const repToken = await token(op.u)
						if (BigInt(repToken) !== 0n) await aux(repToken, encodeFunctionData({ abi: erc20, functionName: 'approve', args: [getZoltarAddress(), (1n << 255n) - 1n] }))
						await transact(getZoltarAddress(), encodeFunctionData({ abi: zoltarArtifact.abi, functionName: 'forkUniverse', args: [id, questionId(op.q)] }), time)
						return undefined
					}
					case 'frz':
						await transact(authority, asAuthority(encodeFunctionData({ abi: artifact.abi, functionName: 'freezeFork', args: [id] })), time)
						return undefined
					case 'child':
						await transact(authority, asAuthority(encodeFunctionData({ abi: artifact.abi, functionName: 'createChild', args: [id, BigInt(op.outcome)] })), time)
						return undefined
					default:
						throw new Error('Unknown operation')
				}
			} catch (error) {
				return String(error instanceof Error ? error.message : error).slice(0, 400)
			}
		}

		const checkBook = async (path: string): Promise<string | undefined> => {
			const expected = model.books.get(path)
			if (expected === undefined) return undefined
			const id = await universeId(path)
			const [chain, custody, ...questions] = await Promise.all([client.readContract({ ...target, functionName: 'books', args: [id] }), balanceOf(path, ledger), ...QUESTION_SLOTS.map(slot => client.readContract({ ...target, functionName: 'question', args: [id, questionId(slot)] }))])
			const where = `universe '${path}'`
			const [live, final, , , , timestamp, exists, isSealed, minimumFinalAfter] = chain
			if (!exists) return `${where}: book missing`
			if (live !== expected.live) return `${where}: live ${live} != model ${expected.live}`
			if (final !== expected.final) return `${where}: final ${final} != model ${expected.final}`
			if (Number(timestamp) !== expected.ts) return `${where}: clock ${timestamp} != model ${expected.ts}`
			if (isSealed !== expected.isSealed) return `${where}: sealed ${isSealed} != model ${expected.isSealed}`
			if (Number(minimumFinalAfter) !== expected.minimumFinalAfter) return `${where}: minimumFinalAfter ${minimumFinalAfter} != model ${expected.minimumFinalAfter}`
			let liveSum = 0n
			let finalSum = 0n
			for (const [index, slot] of QUESTION_SLOTS.entries()) {
				const read = questions[index]
				if (read === undefined) throw new Error('missing read')
				const [state, finalClaim] = read
				const want = expected.questions.get(slot) ?? emptyQuestion()
				const seen = view(path, want)
				const label = `${where} q${slot}`
				if (state.balanceAttoRep !== seen.balance) return `${label}: balance ${state.balanceAttoRep} != model ${seen.balance}`
				if (finalClaim !== seen.finalClaim) return `${label}: finalClaim ${finalClaim} != model ${seen.finalClaim}`
				if (Number(state.finalAfter) !== want.finalAfter) return `${label}: finalAfter ${state.finalAfter} != model ${want.finalAfter}`
				if (state.winnerHaircutPaidByFork !== want.haircut) return `${label}: haircut flag ${state.winnerHaircutPaidByFork} != model ${want.haircut}`
				const wantGame = want.sourceGame === undefined ? undefined : games.get(want.sourceGame)
				if (BigInt(state.sourceGame) !== (wantGame === undefined ? 0n : BigInt(wantGame))) return `${label}: sourceGame ${state.sourceGame} != model ${wantGame}`
				if (want.scheduledIn !== undefined && pathOfUniverse(state.scheduledUniverseId) !== want.scheduledIn) return `${label}: scheduledUniverseId ${state.scheduledUniverseId} != model '${want.scheduledIn}'`
				if (finalClaim) finalSum += state.balanceAttoRep
				else liveSum += state.balanceAttoRep
			}
			if (liveSum !== live) return `${where}: INVARIANT sum of live question balances ${liveSum} != live ${live}`
			if (finalSum !== final) return `${where}: INVARIANT sum of final question balances ${finalSum} != final ${final}`
			// Custody: an open universe holds live + final; a sealed one burned its live REP into migration.
			const owed = isSealed ? final : live + final
			if (custody !== owed) return `${where}: CUSTODY ledger holds ${custody} REP but owes ${owed} (live ${live}, final ${final}, sealed ${isSealed})`
			return undefined
		}

		const execute = async (op: Op, index: number): Promise<string | undefined> => {
			const context = () => `\n  last operations:\n    ${history.slice(-25).join('\n    ')}`
			const time = Math.max(op.at, lastTime + 4)
			const id = await universeId(op.u)
			const [threshold, earliestFork, ownerBalance] = await Promise.all([client.readContract({ ...zoltar(), functionName: 'getForkThresholdAttoRep', args: [id] }), client.readContract({ ...zoltar(), functionName: 'getEarliestForkTime', args: [id] }), balanceOf(op.u, owner)])
			let concrete = op
			if (op.k === 'dep' && op.thresholdPlus !== undefined) {
				const balance = model.books.get(op.u)?.questions.get(op.q)?.balance ?? 0n
				concrete = { ...op, amount: threshold + op.thresholdPlus > balance ? threshold + op.thresholdPlus - balance : 0n }
			}
			if (concrete.k === 'dep' && concrete.amount > ownerBalance) return undefined
			if ('q' in concrete && concrete.k !== 'reg' && concrete.k !== 'trig' && concrete.k !== 'xfork' && !games.has(`${concrete.u}:${concrete.q}`)) return undefined
			history.push(`#${index} @${time} ${show(concrete)}`)
			const next = cloneModel(model)
			let outcome: Outcome
			try {
				outcome = apply(next, concrete, time, { threshold, burnDivisor, earliestFork: Number(earliestFork), ownerBalance }, 'q' in concrete && concrete.q < 2)
			} catch (error) {
				return `${String(error instanceof Error ? error.message : error)} at ${show(concrete)}${context()}`
			}
			const reverted = await send(concrete, time)
			if (outcome.ok && reverted !== undefined) return `UNEXPECTED REVERT (model: must succeed) at ${show(concrete)}: ${reverted}${context()}`
			if (!outcome.ok && reverted === undefined) return `UNEXPECTED SUCCESS (model: must revert, ${outcome.why}) at ${show(concrete)}${context()}`
			model.now = lastTime
			if (!outcome.ok) return undefined
			next.now = lastTime
			model = next
			for (const path of outcome.touched) {
				const problem = await checkBook(path)
				if (problem !== undefined) return `${problem}\n  after ${show(concrete)}${context()}`
			}
			// Give the owner child REP so deposits and admission stay possible in the new branch.
			if (concrete.k === 'child') {
				const parentId = await universeId(concrete.u)
				const fresh = await balanceOf(concrete.u, owner)
				const prepared = await client.readContract({ ...zoltar(), functionName: 'getMigrationRepBalanceAttoRep', args: [owner, parentId] })
				if (fresh + prepared !== 0n) {
					const parentToken = await token(concrete.u)
					await aux(parentToken, encodeFunctionData({ abi: erc20, functionName: 'approve', args: [getZoltarAddress(), (1n << 255n) - 1n] }))
					await aux(getZoltarAddress(), encodeFunctionData({ abi: zoltarArtifact.abi, functionName: 'prepareAndSplitMigrationRep', args: [parentId, fresh + prepared, [BigInt(concrete.outcome)], fresh] }))
					model.now = lastTime
				}
			}
			return undefined
		}

		let index = 0
		for (;;) {
			const threshold = await client.readContract({ ...zoltar(), functionName: 'getForkThresholdAttoRep', args: [0n] })
			const ops = source(model, index, threshold)
			if (ops === undefined) break
			for (const op of ops) {
				record?.push(op)
				const problem = await execute(op, index)
				if (problem !== undefined) return problem
				index++
			}
		}
		for (const path of model.books.keys()) {
			const problem = await checkBook(path)
			if (problem !== undefined) return `${problem} (final full check)`
		}
		return undefined
	}

	const runSeed = async (seed: number, steps: number): Promise<string | undefined> => {
		const random = makeRandom(seed)
		const recorded: Op[] = []
		const failure = await run(
			drainThenCheck((model, index, threshold) => (index < steps ? generate(model, random, index, threshold) : undefined)),
			recorded,
		).catch(error => String(error instanceof Error ? error.message : error))
		if (failure === undefined) return undefined
		const wanted = failureClass(failure)
		// A replay ends with the same drain and locked-REP check as the full run.
		const replay = async (ops: Op[]) => {
			const result = await run(
				drainThenCheck((_model, index) => (index < ops.length ? ops.slice(index, index + 1) : undefined)),
				undefined,
			).catch(error => String(error instanceof Error ? error.message : error))
			return result !== undefined && failureClass(result) === wanted ? result : undefined
		}
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
		await setupTestAccounts(ethereum)
		await ensureZoltarDeployed(client)
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		for (const title of ['audit reporter fuzz one', 'audit reporter fuzz two']) {
			const data = { ...makeQuestion(title), startTime: 0n, endTime: 0n }
			await createQuestion(client, data, outcomes)
			realQuestions.push(getQuestionId(data, outcomes))
		}
		burnDivisor = await client.readContract({ ...zoltar(), functionName: 'forkBurnDivisor' })
		await ethereum.advanceTime(1_000n)
		baseTime = Number((await client.getBlock()).timestamp) + 10
		baseline = await ethereum.anvilSnapshot()
		const failures: string[] = []
		const runs = [...Array.from({ length: SEEDS }, (_, offset) => ({ seed: FIRST_SEED + offset, steps: STEPS })), ...REGRESSION_SEEDS]
		for (const { seed, steps } of runs) {
			const failure = await runSeed(seed, steps)
			if (failure !== undefined) {
				failures.push(failure)
				console.log(failure)
				if (failures.length >= 2) break
			}
		}
		expect(failures).toEqual([])
	})
})
