import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as artifact } from '../types/contractArtifact'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

// Property test: SecurityPoolSettlementBook recovery-REP accounting against an exact
// rational per-question entitlement model, over mint/fee/finality/freeze/redeem and two forks.
// The default run is short. To cover more seeds, for example:
//   RECOVERY_FUZZ_FIRST_SEED=1 RECOVERY_FUZZ_SEEDS=24 bun ./tooling/testing/bun-test.mts --timeout 3000000 solidity/ts/tests/auditSettlementRecoveryFuzz.test.ts

const gcd = (a: bigint, b: bigint): bigint => {
	while (b !== 0n) [a, b] = [b, a % b]
	return a < 0n ? -a : a
}
type Fraction = { n: bigint; d: bigint }
const fraction = (n: bigint, d = 1n): Fraction => {
	const g = gcd(n, d)
	return g === 0n ? { n: 0n, d: 1n } : { n: n / g, d: d / g }
}
const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d)
const mulDiv = (a: Fraction, n: bigint, d: bigint) => fraction(a.n * n, a.d * d)
const floor = (a: Fraction) => a.n / a.d
const ceil = (a: Fraction) => (a.n + a.d - 1n) / a.d

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
		big: (maxInclusive: bigint) => (maxInclusive <= 0n ? 0n : ((next() << 64n) | next()) % (maxInclusive + 1n)),
		pick: <T>(items: readonly T[]): T => {
			const item = items[Number(next() % BigInt(items.length))]
			if (item === undefined) throw new Error('empty pick')
			return item
		},
	}
}

const QUESTIONS = [1n, 2n, 3n, 4n] as const
const SEEDS = Number(process.env['RECOVERY_FUZZ_SEEDS'] ?? '3')
const FIRST_SEED = Number(process.env['RECOVERY_FUZZ_FIRST_SEED'] ?? '1')

describe('audit: settlement book recovery REP property test', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: artifact.abi, address })
	const send = (request: () => Promise<Hex>) => writeContractAndWait(client, request)

	const deployBook = async () => {
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address, 1n] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('deployment address missing')
		address = receipt.contractAddress
		await send(() => client.writeContract({ ...target(), functionName: 'createBook', args: [0] }))
	}

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
	})

	const runSeed = async (seed: number) => {
		const random = makeRandom(seed)
		await deployBook()
		const log: string[] = []
		const note = (text: string) => log.push(text)
		const fail = (text: string): never => {
			throw new Error(`seed ${seed}: ${text}\n${log.slice(-60).join('\n')}`)
		}
		// Model: per book, per question exact entitlement in attoREP, and rounding allowance.
		const entitlement = new Map<bigint, Map<bigint, Fraction>>()
		const roundings = new Map<bigint, bigint>()
		const sealedBooks = new Set<bigint>()
		const bookOf = (map: Map<bigint, Map<bigint, Fraction>>, bookId: bigint) => {
			let value = map.get(bookId)
			if (value === undefined) {
				value = new Map()
				map.set(bookId, value)
			}
			return value
		}
		entitlement.set(1n, new Map())
		roundings.set(1n, 0n)

		const now = async (bookId: bigint) => Number((await client.readContract({ ...target(), functionName: 'totals', args: [bookId] }))[3])
		const bookState = async (bookId: bigint) => {
			const value = await client.readContract({ ...target(), functionName: 'books', args: [bookId] })
			return { cash: value[0], units: value[1], recovery: value[15] }
		}
		const questionState = async (bookId: bigint, questionId: bigint) => {
			const [state, frozenBookId] = await client.readContract({ ...target(), functionName: 'question', args: [bookId, questionId] })
			return { units: state.units, supply: state.outcomeSupplyAttoShares, finalAfter: Number(state.finalAfter), frozenBookId }
		}
		const frozenSource = async (frozenBookId: bigint) => (await client.readContract({ ...target(), functionName: 'frozenBooks', args: [frozenBookId] }))[2]

		const mintAt = (bookId: bigint, questionId: bigint, cash: bigint, timestamp: number) => send(() => client.writeContract({ ...target(), functionName: 'mint', args: [bookId, questionId, cash, 0n, timestamp] }))
		const replaceFeeStream = (bookId: bigint, questionId: bigint, rate: bigint, endsAt: number, timestamp: number) => send(() => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [bookId, questionId, rate, endsAt, timestamp] }))
		const tryMint = async (bookId: bigint) => {
			const book = await bookState(bookId)
			if (book.cash !== book.units || book.recovery !== 0n) return
			const questionId = random.pick(QUESTIONS)
			const state = await questionState(bookId, questionId)
			if (state.finalAfter !== 0 || state.frozenBookId !== 0n) return
			const cash = random.pick([1n, 7n, 1000n, 10n ** 9n, 10n ** 18n, 3n * 10n ** 20n]) + random.big(1000n)
			note(`mint b${bookId} q${questionId} ${cash}`)
			await mintAt(bookId, questionId, cash, await now(bookId)).catch(error => note(`  mint rejected: ${String(error).slice(0, 120)}`))
		}
		const tryFee = async (bookId: bigint) => {
			const questionId = random.pick(QUESTIONS)
			const state = await questionState(bookId, questionId)
			if (state.finalAfter !== 0 || state.frozenBookId !== 0n || state.units === 0n) return
			const timestamp = await now(bookId)
			const nativeTime = Number(await client.readContract({ ...target(), functionName: 'feeTimestamp', args: [bookId] }))
			const seconds = 1 + random.int(5)
			const rate = random.big(state.units / BigInt(seconds)) + 1n
			if (rate >= 1n << 96n) return
			note(`fee b${bookId} q${questionId} rate ${rate} for ${seconds}s`)
			await replaceFeeStream(bookId, questionId, rate, nativeTime + seconds, timestamp).catch(error => note(`  fee rejected: ${String(error).slice(0, 120)}`))
		}
		const advance = async (bookId: bigint, seconds: number) => {
			const timestamp = (await now(bookId)) + seconds
			note(`advance b${bookId} +${seconds} -> ${timestamp}`)
			await send(() => client.writeContract({ ...target(), functionName: 'freezeMatured', args: [bookId, timestamp] })).catch(error => fail(`freezeMatured reverted: ${String(error)}`))
		}
		const trySchedule = async (bookId: bigint) => {
			const questionId = random.pick(QUESTIONS)
			const state = await questionState(bookId, questionId)
			if (state.frozenBookId !== 0n || state.supply === 0n) return
			const timestamp = await now(bookId)
			const finalAfter = random.int(6) === 0 ? 0 : timestamp + random.int(8)
			note(`schedule b${bookId} q${questionId} finalAfter ${finalAfter}`)
			await replaceFeeStream(bookId, questionId, 0n, 0, timestamp).catch(error => fail(`stop fee reverted: ${String(error)}`))
			await send(() => client.writeContract({ ...target(), functionName: 'scheduleFinality', args: [bookId, questionId, finalAfter, timestamp] })).catch(error => fail(`scheduleFinality reverted: ${String(error)}`))
		}
		const redeem = async (bookId: bigint, questionId: bigint, shares: bigint) => {
			const before = await questionState(bookId, questionId)
			const timestamp = await now(bookId)
			const quote = await client.readContract({ ...target(), functionName: 'quoteRecoveryRep', args: [bookId, questionId, shares] }).catch(error => fail(`quoteRecoveryRep reverted b${bookId} q${questionId} ${shares}: ${String(error)}`))
			note(`redeem b${bookId} q${questionId} ${shares}/${before.supply} units ${before.units} frozen ${before.frozenBookId} quote ${quote}`)
			await send(() => client.writeContract({ ...target(), functionName: 'redeem', args: [bookId, questionId, shares, 0n, timestamp] })).catch(error => fail(`REDEEM REVERTED b${bookId} q${questionId} ${shares}/${before.supply}: ${String(error)}`))
			const entitlements = bookOf(entitlement, bookId)
			const owed = entitlements.get(questionId) ?? fraction(0n)
			roundings.set(bookId, (roundings.get(bookId) ?? 0n) + 1n)
			const allowance = (roundings.get(bookId) ?? 0n) + 2n
			const expected = mulDiv(owed, shares, before.supply)
			// Never pay more than this question's own remaining entitlement (plus dust).
			if (quote > ceil(owed) + allowance) fail(`OVERPAID b${bookId} q${questionId}: paid ${quote}, remaining entitlement ${owed.n}/${owed.d}`)
			if (quote > ceil(expected) + allowance && shares !== before.supply) fail(`PARTIAL OVERPAID b${bookId} q${questionId}: paid ${quote}, pro rata ${expected.n}/${expected.d}`)
			if (quote + allowance < floor(expected)) fail(`UNDERPAID b${bookId} q${questionId}: paid ${quote}, pro rata ${expected.n}/${expected.d}`)
			const remaining = add(owed, fraction(-quote))
			entitlements.set(questionId, remaining.n < 0n ? fraction(0n) : remaining)
		}
		const tryRedeem = async (bookId: bigint, everything = false) => {
			const questionId = random.pick(QUESTIONS)
			const state = await questionState(bookId, questionId)
			if (state.supply === 0n) return
			if (state.frozenBookId === 0n && sealedBooks.has(bookId)) return
			if (state.frozenBookId !== 0n && (await frozenSource(state.frozenBookId)) !== bookId) return
			const shares = everything || random.int(4) === 0 ? state.supply : random.big(state.supply - 1n) + 1n
			await redeem(bookId, questionId, shares)
		}
		const fork = async (sourceBookId: bigint, children: number) => {
			const timestamp = (await now(sourceBookId)) + random.int(3)
			note(`seal b${sourceBookId} at ${timestamp}`)
			await send(() => client.writeContract({ ...target(), functionName: 'sealForFork', args: [sourceBookId, timestamp] })).catch(error => fail(`sealForFork reverted: ${String(error)}`))
			sealedBooks.add(sourceBookId)
			const source = await bookState(sourceBookId)
			const sourceEntitlements = bookOf(entitlement, sourceBookId)
			const created: bigint[] = []
			for (let index = 0; index < children; index++) {
				const cash = random.pick([0n, source.units, random.big(source.units), source.units / 2n])
				const extra = source.units === 0n ? 0n : random.pick([0n, 0n, 1n, 3n, 10n ** 6n, 10n ** 18n + random.big(10n ** 18n), 7n * 10n ** 24n + random.big(10n ** 20n), (1n << 127n) - source.recovery - 1n])
				const recovery = source.recovery + extra
				note(`child of b${sourceBookId}: cash ${cash}/${source.units} recovery ${recovery} (source ${source.recovery})`)
				await send(() => client.writeContract({ ...target(), functionName: 'createChildBook', args: [sourceBookId, cash, recovery] })).catch(error => fail(`createChildBook reverted: ${String(error)}`))
				const childId = await client.readContract({ ...target(), functionName: 'lastBookId' })
				created.push(childId)
				const childEntitlements = new Map<bigint, Fraction>()
				for (const questionId of QUESTIONS) {
					const state = await questionState(sourceBookId, questionId)
					if (state.frozenBookId !== 0n || state.supply === 0n) continue
					const inherited = sourceEntitlements.get(questionId) ?? fraction(0n)
					childEntitlements.set(questionId, add(inherited, fraction(extra * state.units, source.units === 0n ? 1n : source.units)))
				}
				entitlement.set(childId, childEntitlements)
				roundings.set(childId, BigInt(QUESTIONS.length))
				const child = await bookState(childId)
				let total = fraction(0n)
				for (const value of childEntitlements.values()) total = add(total, value)
				if (ceil(total) > child.recovery + BigInt(QUESTIONS.length) + (roundings.get(sourceBookId) ?? 0n)) fail(`child b${childId} entitlements ${total.n}/${total.d} exceed custody ${child.recovery}`)
			}
			return created
		}
		const operate = async (bookId: bigint, steps: number) => {
			for (let step = 0; step < steps; step++) {
				const choice = random.int(10)
				if (choice < 2) await tryMint(bookId)
				else if (choice < 4) await tryFee(bookId)
				else if (choice < 6) await trySchedule(bookId)
				else if (choice < 8) await advance(bookId, random.pick([1, 1, 2, 5, 9]))
				else await tryRedeem(bookId)
			}
		}
		const drain = async (bookId: bigint) => {
			if (!sealedBooks.has(bookId)) await advance(bookId, 300_000)
			for (const questionId of QUESTIONS) {
				const state = await questionState(bookId, questionId)
				if (state.supply === 0n) continue
				if (state.frozenBookId === 0n && sealedBooks.has(bookId)) continue
				if (state.frozenBookId !== 0n && (await frozenSource(state.frozenBookId)) !== bookId) continue
				if (random.int(2) === 0 && state.supply > 1n) await redeem(bookId, questionId, random.big(state.supply - 2n) + 1n)
				const rest = await questionState(bookId, questionId)
				await redeem(bookId, questionId, rest.supply)
			}
			if (sealedBooks.has(bookId)) return
			const end = await bookState(bookId)
			const allowance = (roundings.get(bookId) ?? 0n) + 8n
			if (end.units !== 0n || end.cash !== 0n) fail(`b${bookId} not drained: cash ${end.cash} units ${end.units}`)
			// Live custody must be fully paid; only frozen books may retain dust.
			if (end.recovery > allowance) fail(`b${bookId} stranded live recovery REP ${end.recovery}`)
		}

		for (let index = 0; index < 6; index++) await tryMint(1n)
		await operate(1n, 14)
		const children = await fork(1n, 2)
		const grandchildren: bigint[] = []
		for (const childId of children) {
			await operate(childId, 6)
			if (random.int(2) === 0) await advance(childId, 259_200 + random.int(10))
			await operate(childId, 10)
			if (childId === children[0]) grandchildren.push(...(await fork(childId, 2)))
		}
		for (const bookId of grandchildren) {
			await operate(bookId, 6)
			if (random.int(2) === 0) await advance(bookId, 259_200 + random.int(10))
			await operate(bookId, 8)
		}
		for (const bookId of [1n, ...children, ...grandchildren]) await drain(bookId)
		// Frozen claims: total frozen recovery left must be dust only.
		const frozenCount = await client.readContract({ ...target(), functionName: 'lastFrozenBookId' })
		for (let id = 1n; id <= frozenCount; id++) {
			const frozen = await client.readContract({ ...target(), functionName: 'frozenBooks', args: [id] })
			if (frozen[1] !== 0n) fail(`frozen book ${id} retains units ${frozen[1]}`)
			if (frozen[3] > 64n) fail(`frozen book ${id} strands recovery REP ${frozen[3]}`)
			if (frozen[0] !== 0n) fail(`frozen book ${id} strands cash ${frozen[0]}`)
		}
	}

	test('random lifecycles never revert a valid redemption or move REP between questions', async () => {
		await getAnvilWindowEthereum().advanceTime(5_000_000n)
		const failures: string[] = []
		for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
			try {
				await runSeed(seed)
			} catch (error) {
				failures.push(String(error instanceof Error ? error.message : error))
				if (failures.length >= 3) break
			}
		}
		// Each entry carries the seed and the last operations of its failing lifecycle.
		expect(failures).toEqual([])
	})
})
