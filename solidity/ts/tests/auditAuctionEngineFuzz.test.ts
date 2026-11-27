import { waitForRawReceipt } from '../testSupport/waitForRawReceipt'
import { beforeAll, describe, expect, test } from 'bun:test'
import { getContractOutput, loadContractsJson, normalizeStorageLayout } from './contractArtifactHelpers'
import { keccak256, encodeAbiParameters, encodeDeployData, encodeFunctionData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact, statoblast_Multicall3_Multicall3 as multicallArtifact, test_statoblast_CollateralTestToken_CollateralTestToken as tokenArtifact } from '../types/contractArtifact'

// Randomized and exhaustive-small differential test of the uniform-price auction engine
// against an independent brute-force model (sections A and B of the audit brief).
// Long run: AUDIT_FUZZ_SECONDS=30 (random test budget; the exhaustive test stops after 2.5x that) AUDIT_FUZZ_DEPTH=3 (enumeration depth) AUDIT_FUZZ_SEED=<n> bun ./tooling/testing/bun-test.mts --timeout 600000 solidity/ts/tests/auditAuctionEngineFuzz.test.ts

const SECONDS = Number(process.env['AUDIT_FUZZ_SECONDS'] ?? '3')
const DEPTH = Number(process.env['AUDIT_FUZZ_DEPTH'] ?? '2')
let seed = Number(BigInt(process.env['AUDIT_FUZZ_SEED'] ?? '20261113') % 0xffffffffn)
const random = () => {
	seed = (seed + 0x6d2b79f5) | 0
	let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
	value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
	return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}
const below = (limit: number) => Math.floor(random() * limit)
const pick = <T>(values: readonly T[]): T => {
	const value = values[below(values.length)]
	if (value === undefined) throw new Error('Cannot pick from an empty list')
	return value
}
const maxOf = (a: bigint, b: bigint) => (a > b ? a : b)
const minOf = (a: bigint, b: bigint) => (a < b ? a : b)
const CLOSE = 1_000_000_000n
// Static return data only: every engine view used here returns fixed-size words.
const wordsOf = (data: Hex, count: number) => {
	if (data.length !== 2 + 64 * count) throw new Error(`Expected ${count} return words, got ${(data.length - 2) / 64}`)
	return Array.from({ length: count }, (_, index) => BigInt(`0x${data.slice(2 + 64 * index, 66 + 64 * index)}`))
}
const wordAt = (words: readonly bigint[], index: number) => {
	const word = words[index]
	if (word === undefined) throw new Error('Return word missing')
	return word
}

type Config = { grid: bigint; lot: bigint; target: bigint; inventory: bigint }
type ModelBid = { id: bigint; lots: bigint; min: bigint; bidder: Address }
type ModelClearing = {
	attoRepPerLot: bigint
	filledLots: bigint
	raisedAttoEth: bigint
	soldAttoRep: bigint
	raiseLimitReached: boolean
	fills: Map<bigint, bigint>
}

const ascending = (a: bigint, b: bigint) => {
	if (a < b) return -1
	return a > b ? 1 : 0
}
const priceOrder = (bids: readonly ModelBid[]) => [...bids].sort((a, b) => ascending(a.min, b.min) || ascending(a.id, b.id))

// Brute force: enumerate every prefix length, never a tree, never a binary search.
function modelClearing(config: Config, bids: readonly ModelBid[], maximum: bigint, floor: bigint): ModelClearing {
	const order = priceOrder(bids)
	const lotPrice: bigint[] = []
	for (const bid of order) for (let lot = 0n; lot < bid.lots; lot++) lotPrice.push(bid.min)
	let filled = 0n
	let prefixStillFeasible = true
	for (let length = 1n; length <= maximum && length <= BigInt(lotPrice.length); length++) {
		const price = lotPrice[Number(length) - 1]
		if (price === undefined) throw new Error('Model lot missing')
		const feasible = length * maxOf(price, floor) <= config.inventory
		if (feasible && !prefixStillFeasible) throw new Error('Model: feasibility is not monotone')
		if (feasible) filled = length
		else prefixStillFeasible = false
	}
	const fills = new Map<bigint, bigint>()
	for (const bid of bids) fills.set(bid.id, 0n)
	if (filled === 0n) return { attoRepPerLot: 0n, filledLots: 0n, raisedAttoEth: 0n, soldAttoRep: 0n, raiseLimitReached: false, fills }
	const marginal = lotPrice[Number(filled) - 1]
	if (marginal === undefined) throw new Error('Model marginal missing')
	const reached = filled === maximum
	const unrounded = maxOf(marginal, floor)
	const attoRepPerLot = unrounded - (unrounded % config.grid)
	const sold = filled * attoRepPerLot
	// Price-time priority: equal limits fill in submission (id) order.
	let cumulative = 0n
	for (const bid of order) {
		fills.set(bid.id, minOf(bid.lots, maxOf(filled - cumulative, 0n)))
		cumulative += bid.lots
	}
	return { attoRepPerLot, filledLots: filled, raisedAttoEth: filled * config.lot, soldAttoRep: sold, raiseLimitReached: reached, fills }
}

// The specification's properties, checked on whatever result is supplied (model or chain).
function specViolations(config: Config, bids: readonly ModelBid[], maximum: bigint, floor: bigint, result: Omit<ModelClearing, 'fills'>, fills: ReadonlyMap<bigint, bigint>): string[] {
	const problems: string[] = []
	const order = priceOrder(bids)
	const total = order.reduce((sum, bid) => sum + bid.lots, 0n)
	// The limit of the last winning lot; bids below it fill fully and bids above it not at all.
	let marginal = 0n
	let covered = 0n
	for (const bid of order) {
		covered += bid.lots
		if (covered >= result.filledLots) {
			marginal = bid.min
			break
		}
	}
	if (result.filledLots > maximum) problems.push('fills more than the raise limit')
	if (result.filledLots > total) problems.push('fills more than demand')
	if (result.attoRepPerLot % config.grid !== 0n) problems.push('clearing REP per lot is off the grid')
	if (result.filledLots * result.attoRepPerLot > config.inventory) problems.push('principal exceeds inventory')
	if (result.soldAttoRep > config.inventory) problems.push('sold exceeds inventory')
	if (result.soldAttoRep !== result.filledLots * result.attoRepPerLot) problems.push('sold != grid-priced principal')
	if (result.raisedAttoEth !== result.filledLots * config.lot) problems.push('raised != filled * lot')
	if (result.filledLots !== 0n) {
		if (result.attoRepPerLot < floor) problems.push('clearing REP per lot is below the floor')
		if (result.raiseLimitReached !== (result.filledLots === maximum)) problems.push('raise limit flag wrong')
	} else if (result.soldAttoRep !== 0n || result.attoRepPerLot !== 0n) problems.push('empty clearing sells REP')
	// Maximality: one more lot is over the limit, beyond demand, or unaffordable.
	const nextLength = result.filledLots + 1n
	if (nextLength <= maximum && nextLength <= total) {
		let seen = 0n
		for (const bid of order) {
			seen += bid.lots
			if (seen >= nextLength) {
				if (nextLength * maxOf(bid.min, floor) <= config.inventory) problems.push('a longer prefix is feasible')
				break
			}
		}
	}
	let sum = 0n
	let positionBefore = 0n
	for (const bid of order) {
		const fill = fills.get(bid.id)
		if (fill === undefined) {
			problems.push(`fill missing for bid ${bid.id}`)
			continue
		}
		sum += fill
		if (fill > bid.lots) problems.push(`bid ${bid.id} fills more than it bid`)
		if (fill > 0n && bid.min > result.attoRepPerLot) problems.push(`winner ${bid.id} receives less than its minimum`)
		if (bid.min < marginal && fill !== bid.lots && result.filledLots !== 0n) problems.push(`better bid ${bid.id} is not fully filled`)
		if (bid.min > marginal && fill !== 0n) problems.push(`worse bid ${bid.id} fills`)
		// Time priority: a tied bid fills exactly the part of its lots inside the winning prefix.
		if (fill !== minOf(bid.lots, maxOf(result.filledLots - positionBefore, 0n))) problems.push(`tied bid ${bid.id} breaks price-time priority`)
		positionBefore += bid.lots
	}
	if (sum !== result.filledLots) problems.push('sum of fills != filled lots')
	if (positionBefore !== total) problems.push('model order broken')
	return problems
}

// "Cannot win": behind only the demand that ranks before it (a lower limit, or an equal
// limit submitted earlier), with the whole target and no floor, the bid still fills nothing.
function cannotWin(config: Config, bids: readonly ModelBid[], bid: ModelBid) {
	const others = bids.filter(other => other.min < bid.min || (other.min === bid.min && other.id < bid.id))
	return modelClearing(config, [...others, bid], config.target, 0n).fills.get(bid.id) === 0n
}

type Fraction = { numerator: bigint; denominator: bigint }
const gcd = (a: bigint, b: bigint): bigint => {
	if (b !== 0n) return gcd(b, a % b)
	return a < 0n ? -a : a
}
const fraction = (numerator: bigint, denominator: bigint): Fraction => {
	const divisor = gcd(numerator, denominator)
	return divisor === 0n ? { numerator: 0n, denominator: 1n } : { numerator: numerator / divisor, denominator: denominator / divisor }
}
const addFractions = (a: Fraction, b: Fraction) => fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator)
const absoluteFraction = (a: Fraction): Fraction => (a.numerator < 0n ? { numerator: -a.numerator, denominator: a.denominator } : a)
const greater = (a: Fraction, b: Fraction) => a.numerator * b.denominator > b.numerator * a.denominator
const fractionText = (a: Fraction) => `${(Number((a.numerator * 1000n) / a.denominator) / 1000).toFixed(3)}`

describe('audit fuzz: uniform price auction engine versus a brute-force model', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let controller: Address
	let stranger: Address
	let token: Address
	let multicall: Address
	let clock = 0n
	const bidderPool = [addressString(0xb001n), addressString(0xb002n), addressString(0xb003n)]

	const raw = (method: string, params: unknown[]) => getAnvilWindowEthereum().requestRaw({ method, params })
	const sendRaw = async (from: Address, to: Address | undefined, data: Hex) => {
		clock += 1n
		await raw('evm_setNextBlockTimestamp', [`0x${clock.toString(16)}`])
		const hash = await raw('eth_sendTransaction', [to === undefined ? { from, data, gas: '0x1000000' } : { from, to, data, gas: '0x1000000' }])
		const receipt = await waitForRawReceipt(hash, () => raw('eth_getTransactionReceipt', [hash]))
		const created = 'contractAddress' in receipt && typeof receipt.contractAddress === 'string' ? receipt.contractAddress : undefined
		return { succeeded: receipt.status === '0x1', created }
	}
	const send = async (to: Address, data: Hex, from = controller) => {
		const result = await sendRaw(from, to, data)
		if (!result.succeeded) {
			await client.call({ account: from, to, data })
			throw new Error('Transaction reverted without a replayable reason')
		}
	}
	const deploy = async (data: Hex) => {
		const result = await sendRaw(controller, undefined, data)
		if (!result.succeeded || result.created === undefined) throw new Error('Deployment failed')
		return addressString(BigInt(result.created))
	}
	const snapshot = async () => {
		const id = await raw('evm_snapshot', [])
		if (typeof id !== 'string') throw new Error('Snapshot identifier missing')
		return { id, clock }
	}
	const revert = async (saved: { id: string; clock: bigint }) => {
		if ((await raw('evm_revert', [saved.id])) !== true) throw new Error('Snapshot revert failed')
		clock = saved.clock
	}
	const batch = async (target: Address, calls: readonly Hex[]) => {
		const { result } = await client.simulateContract({ abi: multicallArtifact.abi, address: multicall, functionName: 'aggregate3', args: [calls.map(callData => ({ target, allowFailure: true, callData }))] })
		return result
	}
	// The shared codec is slow for tens of thousands of calls: reuse its selectors, append words.
	const selector = {
		preview: encodeFunctionData({ abi: engineArtifact.abi, functionName: 'previewFinalization', args: [0n, 0n] }).slice(0, 10),
		earlyRefund: encodeFunctionData({ abi: engineArtifact.abi, functionName: 'earlyRefundAttoEth', args: [0n] }).slice(0, 10),
		previewBid: encodeFunctionData({ abi: engineArtifact.abi, functionName: 'previewBid', args: [0n] }).slice(0, 10),
		next: encodeFunctionData({ abi: engineArtifact.abi, functionName: 'nextUnmaterializedBid', args: [0n] }).slice(0, 10),
		fees: encodeFunctionData({ abi: engineArtifact.abi, functionName: 'previewBidFees', args: [0n, 0n, 0n] }).slice(0, 10),
	}
	const withWords = (prefix: string, ...values: bigint[]): Hex => `0x${prefix.slice(2)}${values.map(value => value.toString(16).padStart(64, '0')).join('')}`
	const engineCall = {
		preview: (maximum: bigint, floor: bigint) => withWords(selector.preview, maximum, floor),
		earlyRefund: (id: bigint) => withWords(selector.earlyRefund, id),
		previewBid: (id: bigint) => withWords(selector.previewBid, id),
		next: (id: bigint) => withWords(selector.next, id),
		fees: (id: bigint, eth: bigint, rep: bigint) => withWords(selector.fees, id, eth, rep),
	}

	type Engine = { address: Address; config: Config; bids: ModelBid[]; everRefundable: Set<bigint>; settledEarly: Set<bigint>; refunded: Map<Address, bigint>; floors: bigint[] }
	const describeEngine = (engine: Engine) => `grid=${engine.config.grid} lot=${engine.config.lot} target=${engine.config.target} inventory=${engine.config.inventory} bids=[${engine.bids.map(bid => `#${bid.id}:${bid.lots}@${bid.min}`).join(' ')}] earlySettled=[${[...engine.settledEarly].join(',')}]`

	const createEngine = async (config: Config): Promise<Engine> => {
		const address = await deploy(encodeDeployData({ abi: engineArtifact.abi, bytecode: `0x${engineArtifact.evm.bytecode.object}`, args: [controller, token] }))
		await send(address, encodeFunctionData({ abi: engineArtifact.abi, functionName: 'startRepairAuction', args: [CLOSE, config.lot, config.target, config.inventory, config.grid] }))
		const floors: bigint[] = []
		const steps = config.inventory / config.grid + 2n
		if (steps <= 44n) for (let step = 0n; step <= steps; step++) floors.push(step * config.grid)
		return { address, config, bids: [], everRefundable: new Set(), settledEarly: new Set(), refunded: new Map(), floors }
	}
	const floorsFor = (engine: Engine) => {
		if (engine.floors.length !== 0) return engine.floors
		const interesting = new Set<bigint>([0n, engine.config.grid])
		for (const bid of engine.bids) for (const delta of [-1n, 0n, 1n]) if (bid.min + delta * engine.config.grid >= 0n) interesting.add(bid.min + delta * engine.config.grid)
		const unit = engine.config.inventory / engine.config.grid
		for (let sample = 0; sample < 6; sample++) interesting.add(BigInt(below(Number(minOf(unit + 2n, 1_000_000n)))) * engine.config.grid)
		interesting.add((unit + 1n) * engine.config.grid)
		// Floors at which exactly k lots stop being affordable.
		for (let lots = 1n; lots <= engine.config.target + 2n; lots++) {
			const boundary = engine.config.inventory / lots - ((engine.config.inventory / lots) % engine.config.grid)
			interesting.add(boundary)
			interesting.add(boundary + engine.config.grid)
		}
		return [...interesting]
	}

	// Every (raise limit, floor) pair of the open auction against the model, plus early refunds.
	const checkOpenState = async (engine: Engine, maximums?: readonly bigint[]) => {
		const { config, bids } = engine
		const combos: { maximum: bigint; floor: bigint }[] = []
		const limits = maximums ?? Array.from({ length: Number(config.target) + 1 }, (_, index) => BigInt(index))
		for (const maximum of limits) for (const floor of floorsFor(engine)) combos.push({ maximum, floor })
		const results = await batch(engine.address, [...combos.map(combo => engineCall.preview(combo.maximum, combo.floor)), ...bids.map(bid => engineCall.earlyRefund(bid.id))])
		for (const bid of bids) if (!engine.settledEarly.has(bid.id) && cannotWin(config, bids, bid)) engine.everRefundable.add(bid.id)
		combos.forEach((combo, index) => {
			const outcome = results[index]
			if (outcome === undefined || !outcome.success) throw new Error(`previewFinalization(${combo.maximum}, ${combo.floor}) reverted: ${describeEngine(engine)}`)
			const words = wordsOf(outcome.returnData, 5)
			const actual = {
				attoRepPerLot: wordAt(words, 0),
				filledLots: wordAt(words, 1),
				raisedAttoEth: wordAt(words, 2),
				soldAttoRep: wordAt(words, 3),
				raiseLimitReached: wordAt(words, 4) === 1n,
			}
			const expected = modelClearing(config, bids, combo.maximum, combo.floor)
			const context = () => `previewFinalization(max=${combo.maximum}, floor=${combo.floor}) ${describeEngine(engine)}`
			const modelProblems = specViolations(config, bids, combo.maximum, combo.floor, expected, expected.fills)
			if (modelProblems.length !== 0) throw new Error(`MODEL violates the specification (${modelProblems.join('; ')}): ${context()}`)
			const { fills, ...expectedFields } = expected
			if (actual.attoRepPerLot !== expectedFields.attoRepPerLot || actual.filledLots !== expectedFields.filledLots || actual.raisedAttoEth !== expectedFields.raisedAttoEth || actual.soldAttoRep !== expectedFields.soldAttoRep || actual.raiseLimitReached !== expectedFields.raiseLimitReached)
				expect({ context: context(), ...actual }).toEqual({ context: context(), ...expectedFields })
			// A bid that was ever provably excluded never fills, whatever came later.
			for (const id of engine.everRefundable) if (fills.get(id) !== 0n) throw new Error(`EARLY-REFUNDABLE BID FILLS LATER: bid ${id} fills ${fills.get(id)} in ${context()}`)
		})
		bids.forEach((bid, index) => {
			const outcome = results[combos.length + index]
			if (outcome === undefined || !outcome.success) throw new Error('earlyRefundAttoEth reverted')
			const refund = wordAt(wordsOf(outcome.returnData, 1), 0)
			const expected = !engine.settledEarly.has(bid.id) && cannotWin(config, bids, bid) ? bid.lots * config.lot : 0n
			if (refund !== expected) throw new Error(`earlyRefundAttoEth(${bid.id}) = ${refund}, model ${expected}: ${describeEngine(engine)}`)
			if (!engine.settledEarly.has(bid.id) && engine.everRefundable.has(bid.id) && refund === 0n) throw new Error(`early refund of bid ${bid.id} disappeared: ${describeEngine(engine)}`)
		})
	}

	// Returns whether the engine accepted the bid, having asserted that it matches the model.
	const submit = async (engine: Engine, lots: bigint, min: bigint, bidder: Address) => {
		const candidate: ModelBid = { id: BigInt(engine.bids.length) + 1n, lots, min, bidder }
		const excluded = cannotWin(engine.config, [...engine.bids, candidate], candidate)
		const data = encodeFunctionData({ abi: engineArtifact.abi, functionName: 'submitBid', args: [bidder, lots, min] })
		if (excluded) {
			let reason = ''
			try {
				await client.call({ account: controller, to: engine.address, data })
			} catch (error) {
				reason = error instanceof Error ? error.message : String(error)
			}
			if (!reason.includes('Better bids already exclude this bid')) throw new Error(`submitBid accepted (or failed differently: "${reason.slice(0, 120)}") a bid the model excludes: ${lots}@${min} after ${describeEngine(engine)}`)
			return false
		}
		// Exactly the bid's collateral: the final drain check must reach zero.
		await send(token, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'mint', args: [engine.address, lots * engine.config.lot] }))
		const result = await sendRaw(controller, engine.address, data)
		if (!result.succeeded) throw new Error(`submitBid rejected a bid that can still win: ${lots}@${min} after ${describeEngine(engine)}`)
		engine.bids.push(candidate)
		// The newest bid is last among its ties, so it fills at least one lot right now.
		if (modelClearing(engine.config, engine.bids, engine.config.target, 0n).fills.get(candidate.id) === 0n) throw new Error(`accepted bid fills nothing at the full target: ${describeEngine(engine)}`)
		return true
	}

	const balanceOf = (owner: Address) => client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [owner] })

	// Pays exactly `amount` to a random recipient and settles the bid for good.
	const refund = async (engine: Engine, bid: ModelBid, amount: bigint, context: string) => {
		const recipient = addressString(0xc000n + BigInt(below(4)))
		const before = await balanceOf(recipient)
		await send(engine.address, encodeFunctionData({ abi: engineArtifact.abi, functionName: 'refundBid', args: [bid.id, bid.bidder, recipient] }))
		if ((await balanceOf(recipient)) - before !== amount) throw new Error(`refundBid(${bid.id}) paid a different amount than ${amount}: ${context}`)
		engine.refunded.set(bid.bidder, (engine.refunded.get(bid.bidder) ?? 0n) + amount)
		const again = await engineReason(engine, encodeFunctionData({ abi: engineArtifact.abi, functionName: 'refundBid', args: [bid.id, bid.bidder, recipient] }))
		if (!again.includes('Auction bid has already been settled')) throw new Error(`refundBid(${bid.id}) paid twice or failed differently: "${again.slice(0, 120)}": ${context}`)
	}
	const engineReason = async (engine: Engine, data: Hex) => {
		try {
			await client.call({ account: controller, to: engine.address, data })
		} catch (error) {
			return error instanceof Error ? error.message : String(error)
		}
		return 'no revert'
	}
	const settleEarly = async (engine: Engine, bid: ModelBid) => {
		await refund(engine, bid, bid.lots * engine.config.lot, describeEngine(engine))
		engine.settledEarly.add(bid.id)
	}

	// Finalize with one (raise limit, floor) pair and compare everything observable.
	const finalizeAndCheck = async (engine: Engine, maximum: bigint, floor: bigint, deep: boolean) => {
		const { config, bids } = engine
		const context = `finalize(max=${maximum}, floor=${floor}) ${describeEngine(engine)}`
		const expected = modelClearing(config, bids, maximum, floor)
		const { fills, ...expectedFields } = expected
		clock = maxOf(clock, CLOSE)
		const controllerBefore = await balanceOf(controller)
		await send(engine.address, encodeFunctionData({ abi: engineArtifact.abi, functionName: 'finalize', args: [maximum, floor] }))
		// Finalization pays the raised collateral straight to the controller.
		if ((await balanceOf(controller)) - controllerBefore !== expected.raisedAttoEth) throw new Error(`finalize paid the controller a different amount than ${expected.raisedAttoEth}: ${context}`)
		const stored = await client.readContract({ abi: engineArtifact.abi, address: engine.address, functionName: 'clearing' })
		const [attoRepPerLot, filledLots, raisedAttoEth, soldAttoRep, raiseLimitReached] = stored
		expect({ context, attoRepPerLot, filledLots, raisedAttoEth, soldAttoRep, raiseLimitReached }).toEqual({ context, ...expectedFields })
		expect(await client.readContract({ abi: engineArtifact.abi, address: engine.address, functionName: 'remainingFeeLots' })).toBe(expected.filledLots)

		const order = priceOrder(bids)
		const removed = new Set<bigint>()
		const expectedNext = (after: bigint) => {
			const start = after === 0n ? 0 : order.findIndex(bid => bid.id === after) + 1
			for (let index = start; index < order.length; index++) {
				const bid = order[index]
				if (bid !== undefined && !removed.has(bid.id) && (fills.get(bid.id) ?? 0n) > 0n) return bid.id
			}
			return 0n
		}
		const checkCursors = async () => {
			const cursors = [0n, ...bids.map(bid => bid.id)]
			const results = await batch(engine.address, cursors.map(engineCall.next))
			cursors.forEach((cursor, index) => {
				const outcome = results[index]
				if (outcome === undefined || !outcome.success) throw new Error(`nextUnmaterializedBid(${cursor}) reverted: ${context}`)
				const next = wordAt(wordsOf(outcome.returnData, 1), 0)
				if (next !== expectedNext(cursor)) throw new Error(`nextUnmaterializedBid(${cursor}) = ${next}, model ${expectedNext(cursor)}, removed [${[...removed].join(',')}]: ${context}`)
			})
		}
		const fillResults = await batch(
			engine.address,
			bids.map(bid => engineCall.previewBid(bid.id)),
		)
		const chainFills = new Map<bigint, bigint>()
		bids.forEach((bid, index) => {
			const outcome = fillResults[index]
			if (outcome === undefined || !outcome.success) throw new Error(`previewBid(${bid.id}) reverted: ${context}`)
			const fillWords = wordsOf(outcome.returnData, 5)
			const fill = { filledLots: wordAt(fillWords, 1), usedAttoEth: wordAt(fillWords, 2), principalAttoRep: wordAt(fillWords, 3), refundAttoEth: wordAt(fillWords, 4) }
			if (wordAt(fillWords, 0) !== BigInt(bid.bidder)) throw new Error(`previewBid(${bid.id}) returns another bid's identity: ${context}`)
			const modelFill = fills.get(bid.id) ?? 0n
			chainFills.set(bid.id, fill.filledLots)
			if (fill.filledLots !== modelFill || fill.usedAttoEth !== modelFill * config.lot || fill.principalAttoRep !== modelFill * expected.attoRepPerLot || fill.refundAttoEth !== (bid.lots - modelFill) * config.lot)
				throw new Error(`previewBid(${bid.id}) = fill ${fill.filledLots} used ${fill.usedAttoEth} principal ${fill.principalAttoRep} refund ${fill.refundAttoEth}; model fill ${modelFill}: ${context}`)
			if (engine.everRefundable.has(bid.id) && fill.filledLots !== 0n) throw new Error(`EARLY-REFUNDABLE BID FILLS AT FINALIZATION: bid ${bid.id}: ${context}`)
		})
		const chainProblems = specViolations(config, bids, maximum, floor, expectedFields, chainFills)
		if (chainProblems.length !== 0) throw new Error(`engine violates the specification (${chainProblems.join('; ')}): ${context}`)
		await checkCursors()
		if (!deep) return

		// Random interleaving of refunds and fee detachment.
		const winners = order.filter(bid => (fills.get(bid.id) ?? 0n) > 0n)
		const entitlementEth = new Map<bigint, Fraction>()
		const entitlementRep = new Map<bigint, Fraction>()
		for (const bid of winners) {
			entitlementEth.set(bid.id, fraction(0n, 1n))
			entitlementRep.set(bid.id, fraction(0n, 1n))
		}
		let addedEthTotal = 0n
		let addedRepTotal = 0n
		let paidEth = 0n
		let paidRep = 0n
		const depth = Math.ceil(Math.log2(bids.length + 1)) + 2
		const amount = () => pick([0n, 0n, 1n, BigInt(below(50)), BigInt(below(1_000_000)), BigInt(Math.floor(random() * 2 ** 50)) * 10n ** BigInt(below(18))])
		type Step = { kind: 'settle'; bid: ModelBid } | { kind: 'fees'; bid: ModelBid }
		const steps: Step[] = [...bids.filter(bid => !engine.settledEarly.has(bid.id)).map((bid): Step => ({ kind: 'settle', bid })), ...winners.map((bid): Step => ({ kind: 'fees', bid }))]
		for (let index = steps.length - 1; index > 0; index--) {
			const other = below(index + 1)
			const first = steps[index]
			const second = steps[other]
			if (first === undefined || second === undefined) throw new Error('Shuffle index out of range')
			steps[index] = second
			steps[other] = first
		}
		const pendingSum = async () => {
			const remaining = winners.filter(bid => !removed.has(bid.id))
			const results = await batch(
				engine.address,
				bids.map(bid => engineCall.fees(bid.id, 0n, 0n)),
			)
			let eth = 0n
			let rep = 0n
			bids.forEach((bid, index) => {
				const outcome = results[index]
				if (outcome === undefined || !outcome.success) throw new Error(`previewBidFees(${bid.id}) reverted: ${context}`)
				const feeWords = wordsOf(outcome.returnData, 2)
				const ownedEth = wordAt(feeWords, 0)
				const ownedRep = wordAt(feeWords, 1)
				if (!remaining.includes(bid) && (ownedEth !== 0n || ownedRep !== 0n)) throw new Error(`previewBidFees(${bid.id}) is nonzero for a loser or detached winner: ${context}`)
				eth += ownedEth
				rep += ownedRep
			})
			return { eth, rep }
		}
		const initial = await pendingSum()
		if (initial.eth !== 0n || initial.rep !== 0n) throw new Error(`initial fee ownership ${initial.rep} != zero: ${context}`)
		for (const step of steps) {
			if (step.kind === 'settle') {
				const owed = (step.bid.lots - (fills.get(step.bid.id) ?? 0n)) * config.lot
				if (owed !== 0n) await refund(engine, step.bid, owed, context)
				else {
					// A fully winning bid has nothing to refund and stays unsettled.
					const reason = await engineReason(engine, encodeFunctionData({ abi: engineArtifact.abi, functionName: 'refundBid', args: [step.bid.id, step.bid.bidder, addressString(0xc004n)] }))
					if (!reason.includes('Auction bid has no refund')) throw new Error(`refundBid with nothing owed: "${reason.slice(0, 120)}": ${context}`)
				}
			} else {
				const eth = amount()
				const rep = amount()
				const remaining = winners.filter(bid => !removed.has(bid.id))
				const weight = remaining.reduce((sum, bid) => sum + (fills.get(bid.id) ?? 0n), 0n)
				for (const bid of remaining) {
					const share = fills.get(bid.id) ?? 0n
					entitlementEth.set(bid.id, addFractions(entitlementEth.get(bid.id) ?? fraction(0n, 1n), fraction(eth * share, weight)))
					entitlementRep.set(bid.id, addFractions(entitlementRep.get(bid.id) ?? fraction(0n, 1n), fraction(rep * share, weight)))
				}
				addedEthTotal += eth
				addedRepTotal += rep
				const preview = await client.readContract({ abi: engineArtifact.abi, address: engine.address, functionName: 'previewBidFees', args: [step.bid.id, eth, rep] })
				const { result } = await client.simulateContract({ account: controller, abi: engineArtifact.abi, address: engine.address, functionName: 'allocateAndRemoveFees', args: [step.bid.id, eth, rep] })
				if (preview[0] !== result[0] || preview[1] !== result[1]) throw new Error(`previewBidFees ${preview} != allocateAndRemoveFees ${result} for bid ${step.bid.id}: ${context}`)
				await send(engine.address, encodeFunctionData({ abi: engineArtifact.abi, functionName: 'allocateAndRemoveFees', args: [step.bid.id, eth, rep] }))
				removed.add(step.bid.id)
				paidEth += result[0]
				paidRep += result[1]
				for (const [paid, entitlement] of [
					[result[0], entitlementEth.get(step.bid.id)],
					[result[1], entitlementRep.get(step.bid.id)],
				] as const) {
					if (entitlement === undefined) throw new Error('Entitlement missing')
					const deviation = absoluteFraction(addFractions(fraction(paid, 1n), { numerator: -entitlement.numerator, denominator: entitlement.denominator }))
					if (greater(deviation, fraction(BigInt(depth * winners.length), 1n))) throw new Error(`fee share of bid ${step.bid.id} is ${paid}, model ${fractionText(entitlement)}: ${context}`)
				}
				const pending = await pendingSum()
				if (paidEth + pending.eth !== addedEthTotal || paidRep + pending.rep !== addedRepTotal) throw new Error(`fee conservation broken after removing ${step.bid.id}: paid ${paidEth}/${paidRep} + pending ${pending.eth}/${pending.rep} != added ${addedEthTotal}/${addedRepTotal}: ${context}`)
				await checkCursors()
			}
		}
		if (paidEth !== addedEthTotal || paidRep !== addedRepTotal) throw new Error(`fees left behind after the last removal: ${context}`)
		expect(await client.readContract({ abi: engineArtifact.abi, address: engine.address, functionName: 'remainingFeeLots' })).toBe(0n)
		// Refunds equal each bidder's unfilled lots; everything leaves the engine.
		const bidders = [...new Set(bids.map(bid => bid.bidder))]
		for (const bidder of bidders) {
			const owed = bids.filter(bid => bid.bidder === bidder).reduce((sum, bid) => sum + (bid.lots - (fills.get(bid.id) ?? 0n)) * config.lot, 0n)
			if ((engine.refunded.get(bidder) ?? 0n) !== owed) throw new Error(`refunds of ${bidder} are ${engine.refunded.get(bidder) ?? 0n}, owed ${owed}: ${context}`)
		}
		const deposited = await client.readContract({ abi: engineArtifact.abi, address: engine.address, functionName: 'depositedAttoEth' })
		if (deposited !== bids.reduce((sum, bid) => sum + bid.lots * config.lot, 0n)) throw new Error(`depositedAttoEth differs from accepted bids: ${context}`)
		const left = await balanceOf(engine.address)
		if (left !== 0n) throw new Error(`engine keeps ${left} collateral after every withdrawal: ${context}`)
	}

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		controller = addressString(TEST_ADDRESSES[0])
		stranger = addressString(TEST_ADDRESSES[1])
		for (const account of [controller, stranger, ...bidderPool]) {
			await ethereum.impersonateAccount(account)
			await ethereum.setBalance(account, 10n ** 24n)
		}
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		clock = (await client.getBlock()).timestamp
		token = await deploy(encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}`, args: [18, false] }))
		multicall = await deploy(`0x${multicallArtifact.evm.bytecode.object}`)
		await setBaselineSnapshot()
	})
	const resetClock = async () => {
		clock = (await client.getBlock()).timestamp
	}
	const variants = (engine: Engine, count: number) => {
		const chosen: { maximum: bigint; floor: bigint }[] = [{ maximum: engine.config.target, floor: 0n }]
		const floors = floorsFor(engine)
		while (chosen.length < count) chosen.push({ maximum: BigInt(1 + below(Number(engine.config.target))), floor: pick(floors) })
		return chosen
	}

	test('access control and argument validation', async () => {
		await resetClock()
		const engine = await createEngine({ grid: 7n, lot: 1000n, target: 3n, inventory: 7n * 20n + 3n })
		// Bidding opens at start and must close later, so every engine starts before the shared deadline.
		const empty = await createEngine({ grid: 21n, lot: 10n ** 18n, target: 8n, inventory: 21n * 1000n })
		const reasonOf = async (data: Hex, from = controller) => {
			try {
				await client.call({ account: from, to: engine.address, data })
			} catch (error) {
				return error instanceof Error ? error.message : String(error)
			}
			return 'no revert'
		}
		const bid = (lots: bigint, min: bigint, bidder = bidderPool[0]) => encodeFunctionData({ abi: engineArtifact.abi, functionName: 'submitBid', args: [bidder ?? controller, lots, min] })
		expect(await client.readContract({ abi: engineArtifact.abi, address: engine.address, functionName: 'maximumBidAttoRepPerLot' })).toBe(140n)
		expect(await reasonOf(bid(1n, 14n), stranger)).toContain('Only the auction controller')
		expect(await reasonOf(bid(1n, 14n))).toContain('Auction bid collateral missing')
		await send(token, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'mint', args: [engine.address, 999n] }))
		expect(await reasonOf(bid(1n, 14n))).toContain('Auction bid collateral missing')
		await send(token, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'mint', args: [engine.address, 1n] }))
		expect(await reasonOf(bid(1n, 14n))).toBe('no revert')
		expect(await reasonOf(bid(0n, 14n))).toContain('exact whole ETH lots')
		expect(await reasonOf(bid(1n, 0n))).toContain('REP price grid')
		expect(await reasonOf(bid(1n, 15n))).toContain('REP price grid')
		expect(await reasonOf(bid(1n, 147n))).toContain('exceeds the REP inventory per lot')
		expect(await reasonOf(bid(1n, 14n, addressString(0n)))).toContain('Auction bidder is required')
		expect(await reasonOf(engineCall.preview(4n, 0n))).toContain('raise limit exceeds its target')
		expect(await reasonOf(engineCall.preview(3n, 8n))).toContain('floor must use the REP price grid')
		expect(await reasonOf(encodeFunctionData({ abi: engineArtifact.abi, functionName: 'finalize', args: [3n, 0n] }))).toContain('bidding window has not closed')
		expect(await reasonOf(encodeFunctionData({ abi: engineArtifact.abi, functionName: 'finalize', args: [3n, 0n] }), stranger)).toContain('Only the auction controller')
		expect(await reasonOf(engineCall.previewBid(1n))).toContain('has not been finalized')
		expect(await reasonOf(engineCall.next(0n))).toContain('has not been finalized')
		const bidder = bidderPool[0] ?? controller
		const refundOf = (id: bigint, owner: Address, recipient: Address = bidder) => encodeFunctionData({ abi: engineArtifact.abi, functionName: 'refundBid', args: [id, owner, recipient] })
		expect(await reasonOf(refundOf(1n, bidder))).toContain('Auction bid belongs to another bidder')
		expect(await reasonOf(refundOf(1n, bidder), stranger)).toContain('Only the auction controller')
		expect(await reasonOf(encodeFunctionData({ abi: engineArtifact.abi, functionName: 'allocateAndRemoveFees', args: [1n, 0n, 0n] }), stranger)).toContain('Only the auction controller')
		expect(await reasonOf(encodeFunctionData({ abi: engineArtifact.abi, functionName: 'startRepairAuction', args: [CLOSE, 1n, 1n, 1n, 1n] }))).toContain('already started')
		await send(engine.address, bid(1n, 14n))
		engine.bids.push({ id: 1n, lots: 1n, min: 14n, bidder })
		expect(await reasonOf(refundOf(1n, bidder))).toContain('Bid may still win')
		expect(await reasonOf(refundOf(1n, stranger))).toContain('Auction bid belongs to another bidder')
		expect(await reasonOf(refundOf(1n, bidder, addressString(0n)))).toContain('Auction refund recipient is required')
		await finalizeAndCheck(engine, 3n, 0n, false)
		expect(await reasonOf(bid(1n, 14n))).toContain('not accepting bids')
		expect(await reasonOf(encodeFunctionData({ abi: engineArtifact.abi, functionName: 'finalize', args: [3n, 0n] }))).toContain('cannot be finalized')
		expect(await reasonOf(engineCall.next(2n))).toContain('cursor does not exist')
		expect(await reasonOf(engineCall.previewBid(2n))).toContain('bid does not exist')
		expect(await reasonOf(encodeFunctionData({ abi: engineArtifact.abi, functionName: 'allocateAndRemoveFees', args: [1n, 0n, 0n] }))).toBe('no revert')
		// An auction nobody bid in closes empty for every raise limit and floor, and pays nothing.
		await checkOpenState(empty)
		await finalizeAndCheck(empty, 8n, 42n, true)
	})

	test('exhaustive small configurations', async () => {
		await resetClock()
		const started = Date.now()
		const configurations: { config: Config; levels: bigint[]; lots: bigint[]; depth: number }[] = [
			{ config: { grid: 1n, lot: 1n, target: 4n, inventory: 12n }, levels: [3n, 4n, 6n], lots: [1n, 2n, 3n], depth: DEPTH },
			{ config: { grid: 7n, lot: 1000n, target: 5n, inventory: 7n * 13n + 3n }, levels: [14n, 21n, 35n], lots: [1n, 2n, 4n], depth: DEPTH },
			{ config: { grid: 21n, lot: 10n ** 15n, target: 3n, inventory: 21n * 5n }, levels: [21n, 42n], lots: [1n, 2n], depth: DEPTH + 2 },
			{ config: { grid: 1n, lot: 3n, target: 8n, inventory: 30n }, levels: [2n, 5n, 9n], lots: [1n, 5n], depth: DEPTH },
		]
		for (const { config, levels, lots, depth } of configurations) {
			const engine = await createEngine(config)
			const options = [...new Set(levels)].flatMap(level => lots.map(count => ({ level, count })))
			const visit = async (remaining: number): Promise<void> => {
				for (const option of options) {
					if (Date.now() - started > SECONDS * 2500) return
					const saved = await snapshot()
					const length = engine.bids.length
					const refundable = new Set(engine.everRefundable)
					if (await submit(engine, option.count, option.level, pick(bidderPool))) {
						await checkOpenState(engine)
						for (const variant of variants(engine, 2)) {
							const beforeFinalize = await snapshot()
							await finalizeAndCheck(engine, variant.maximum, variant.floor, false)
							await revert(beforeFinalize)
						}
						if (remaining > 1) await visit(remaining - 1)
					}
					await revert(saved)
					engine.bids.length = length
					engine.everRefundable = refundable
				}
			}
			await visit(depth)
		}
	})

	test('random configurations with settlement, drain and fee tree', async () => {
		await resetClock()
		const started = Date.now()
		let runs = 0
		while (Date.now() - started < SECONDS * 1000) {
			runs++
			const huge = runs % 9 === 0
			const large = !huge && runs % 8 === 0
			const grid = pick([1n, 7n, 21n])
			// Huge: realistic 18-decimal magnitudes up to the protocol's REP cap, with prices near inventory / target.
			const smallUnits = () => (large ? BigInt(50 + below(2000)) : BigInt(1 + below(40)))
			const units = huge ? minOf(10n ** BigInt(18 + below(8)) + BigInt(Math.floor(random() * 2 ** 50)), (11_000_000n * 10n ** 18n - (grid - 1n)) / grid - BigInt(below(3))) : smallUnits()
			const target = large ? BigInt(1 + below(60)) : BigInt(1 + below(8))
			const config: Config = { grid, lot: huge ? pick([10n ** 18n, 10n ** 15n, 123_456_789n]) : pick([1n, 1000n, 10n ** 15n]), target, inventory: grid * units + (below(3) === 0 ? BigInt(below(Number(grid))) : 0n) }
			const engine = await createEngine(config)
			if (large) engine.floors = []
			const levelCount = large ? 2 + below(12) : 3 + below(3)
			const levels = Array.from({ length: levelCount }, () => (huge ? maxOf(1n, units / BigInt(1 + below(Number(target) + 3)) - BigInt(below(3))) : BigInt(1 + below(Number(minOf(units, large ? 60n : 12n))))) * grid)
			const bidCount = large ? 8 + below(40) : 1 + below(7)
			for (let index = 0; index < bidCount; index++) {
				const accepted = await submit(engine, BigInt(1 + below(5)), pick(levels), pick(bidderPool))
				if (!accepted) continue
				if (!large || index % 6 === 0 || index === bidCount - 1) await checkOpenState(engine, large ? [0n, config.target, BigInt(below(Number(config.target) + 1)), BigInt(below(Number(config.target) + 1))] : undefined)
				for (const bid of engine.bids) {
					if (engine.settledEarly.has(bid.id) || !cannotWin(config, engine.bids, bid)) continue
					engine.everRefundable.add(bid.id)
					if (below(2) === 0) await settleEarly(engine, bid)
				}
			}
			if (engine.bids.length === 0) continue
			for (const variant of variants(engine, large ? 2 : 3)) {
				const saved = await snapshot()
				const refunded = new Map(engine.refunded)
				await finalizeAndCheck(engine, variant.maximum, variant.floor, true)
				await revert(saved)
				engine.refunded = refunded
			}
		}
	})
	test('early refunds identify all excluded bids and fee entitlements survive winner removal order', async () => {
		await resetClock()
		const engine = await createEngine({ lot: 3n, target: 13n, inventory: 1000n, grid: 1n })
		for (const [minimum, lots] of [
			[11n, 4n],
			[9n, 2n],
			[7n, 5n],
			[6n, 2n],
			[5n, 6n],
			[2n, 4n],
		] as const)
			expect(await submit(engine, lots, minimum, controller)).toBe(true)
		const target = { abi: engineArtifact.abi, address: engine.address }
		const refunds = await Promise.all(engine.bids.map(bid => client.readContract({ ...target, functionName: 'earlyRefundAttoEth', args: [bid.id] })))
		clock = CLOSE
		await send(engine.address, encodeFunctionData({ ...target, functionName: 'finalize', args: [13n, 0n] }))
		const winners: bigint[] = []
		for (const [index, bid] of engine.bids.entries()) {
			const { filledLots } = await client.readContract({ ...target, functionName: 'previewBid', args: [bid.id] })
			expect(refunds[index]).toBe(filledLots === 0n ? bid.lots * 3n : 0n)
			if (filledLots > 0n) winners.push(bid.id)
		}
		expect(winners.length).toBe(4)
		const cash = 17n,
			rep = 23n
		const preview = (id: bigint, c: bigint, r: bigint) => client.readContract({ ...target, functionName: 'previewBidFees', args: [id, c, r] })
		const planned = new Map(await Promise.all(winners.map(async id => [id, await preview(id, cash, rep)] as const)))
		for (const first of winners) {
			const saved = await snapshot()
			const order = [first, ...winners.filter(id => id !== first).reverse()]
			let totalCash = 0n,
				totalRep = 0n
			for (const [index, id] of order.entries()) {
				const args = [id, index === 0 ? cash : 0n, index === 0 ? rep : 0n] as const
				const { result } = await client.simulateContract({ ...target, functionName: 'allocateAndRemoveFees', args, account: controller })
				const expected = planned.get(id)
				if (!expected) throw new Error('Missing fee entitlement for winning bid')
				expect(result).toEqual(expected)
				await send(engine.address, encodeFunctionData({ ...target, functionName: 'allocateAndRemoveFees', args }))
				totalCash += result[0]
				totalRep += result[1]
			}
			expect([totalCash, totalRep]).toEqual([cash, rep])
			expect(await client.readContract({ ...target, functionName: 'remainingFeeLots' })).toBe(0n)
			await revert(saved)
		}
	})

	test('rotated bid trees preserve node heights, sorted priority and subtree lot ownership', async () => {
		await resetClock()
		const name = 'SecurityPoolUniformPriceRepairAuction'
		const layout = normalizeStorageLayout(getContractOutput(loadContractsJson(import.meta.dir), `contracts/statoblast/${name}.sol`, name))
		const root = layout.find(entry => entry.label === 'root')
		const nodes = layout.find(entry => entry.label === 'nodes')
		if (!root || !nodes) throw new Error('Missing auction tree storage layout')
		for (const prices of [
			[1, 2, 3, 4, 5, 6, 7, 8],
			[8, 7, 6, 5, 4, 3, 2, 1],
			[5, 3, 4, 7, 6, 5, 5, 8],
		]) {
			const engine = await createEngine({ lot: 1n, target: 100n, inventory: 10000n, grid: 1n })
			const word = async (slot: bigint) => {
				const result = await raw('eth_getStorageAt', [engine.address, '0x' + slot.toString(16), 'latest'])
				if (typeof result !== 'string') throw new Error('Missing auction storage word')
				return BigInt(result)
			}
			for (const [i, price] of prices.entries()) {
				expect(await submit(engine, BigInt(1 + (i % 3)), BigInt(price), controller)).toBe(true)
				const order: bigint[] = [],
					seen = new Set<bigint>()
				const visit = async (id: bigint): Promise<readonly [number, bigint]> => {
					if (id === 0n) return [0, 0n]
					expect(seen.has(id)).toBe(false)
					seen.add(id)
					const bid = engine.bids[Number(id) - 1]
					if (!bid) throw new Error('Unregistered bid in tree')
					const slot = BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [id, BigInt(nodes.slot)])))
					const packed = await word(slot)
					const [lh, ll] = await visit(BigInt.asUintN(96, packed))
					order.push(id)
					const [rh, rl] = await visit(BigInt.asUintN(96, packed >> 96n))
					const height = 1 + Math.max(lh, rh),
						lots = bid.lots + ll + rl
					expect(Math.abs(lh - rh)).toBeLessThanOrEqual(1)
					expect(Number(BigInt.asUintN(8, packed >> 192n))).toBe(height)
					expect(BigInt.asUintN(128, await word(slot + 1n))).toBe(lots)
					return [height, lots]
				}
				await visit(BigInt.asUintN(96, (await word(BigInt(root.slot))) >> BigInt(8 * root.offset)))
				expect(order).toEqual(priceOrder(engine.bids).map(bid => bid.id))
			}
		}
	})
})
