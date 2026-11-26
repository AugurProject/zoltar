import { waitForRawReceipt } from '../testSupport/waitForRawReceipt'
import { positiveFuzzInteger } from './auditFuzzBudget'
import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, encodeFunctionData, getAddress, type Abi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import {
	statoblast_Multicall3_Multicall3 as multicallArtifact,
	trading_test_TwoWayConstantProductMathHarness_TwoWayConstantProductMathHarness as mathArtifact,
	trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory as factoryArtifact,
	trading_TwoWayConstantProductPair_TwoWayConstantProductPair as pairArtifact,
	trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter as routerArtifact,
	trading_test_TradingProtocolMocks_TradingMockCoreFactory as coreFactoryArtifact,
	trading_test_TradingProtocolMocks_TradingMockForker as forkerArtifact,
	trading_test_TradingProtocolMocks_TradingMockQuestionData as questionDataArtifact,
	trading_test_TradingProtocolMocks_TradingMockQuestionLedger as poolArtifact,
	trading_test_TradingProtocolMocks_TradingMockShareToken as shareArtifact,
	trading_test_TradingProtocolMocks_TradingMockZoltar as zoltarArtifact,
} from '../types/contractArtifact'

/** Direct pair calls take a deadline; these tests exercise other properties. */
const NO_DEADLINE = 2n ** 64n

// Section E of the audit brief: the constant-product math against exact bigint models
// (including the 257-bit denominator branch) and a real pair driven by random operations.
// Long run: AUDIT_FUZZ_ROUNDS=100 AUDIT_FUZZ_SEED=<n> bun ./tooling/testing/bun-test.mts --timeout 600000 solidity/ts/tests/auditTradingMathFuzz.test.ts

const roundsPerProperty = positiveFuzzInteger('AUDIT_FUZZ_ROUNDS', 24)
const initialSeed = Number(BigInt(process.env['AUDIT_FUZZ_SEED'] ?? '20261113') % 0xffffffffn)
let seed = initialSeed
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
const MAX = (1n << 256n) - 1n
const BPS = 10_000n
const randomBits = (bits: number) => {
	let value = 0n
	for (let index = 0; index < bits; index += 16) value = (value << 16n) | BigInt(below(65536))
	return bits === 0 ? 0n : (value & ((1n << BigInt(bits)) - 1n)) | (1n << BigInt(bits - 1))
}
const EDGES = [0n, 1n, 2n, 3n, 999n, 1000n, 1001n, 9_999n, 10_000n, 10_001n, (1n << 128n) - 1n, 1n << 128n, (1n << 128n) + 1n, 1n << 255n, (1n << 255n) - 1n, MAX - 10_000n, MAX - 2n, MAX - 1n, MAX]
const anyWord = () => {
	if (below(5) === 0) return pick(EDGES)
	return below(8) === 0 ? MAX - randomBits(1 + below(200)) : randomBits(1 + below(256))
}
const anyFee = () => pick([0n, 1n, 30n, 100n, 4_999n, 5_000n, 9_998n, 9_999n, 10_000n, 10_001n, BigInt(below(10_000)), BigInt(below(10_000)), BigInt(below(10_000))])
const ceilDivide = (numerator: bigint, denominator: bigint) => (numerator + denominator - 1n) / denominator

// Exact models: undefined means the Solidity must revert.
const modelExactInput = (reserveIn: bigint, reserveOut: bigint, amountIn: bigint, feeBps: bigint) => {
	if (reserveIn === 0n || reserveOut === 0n || amountIn === 0n || feeBps >= BPS) return undefined
	const net = (amountIn * (BPS - feeBps)) / BPS
	if (net === 0n) return undefined
	const amountOut = (reserveOut * net) / (reserveIn + net)
	if (amountOut === 0n || amountOut >= reserveOut) return undefined
	return { first: amountOut, second: amountIn - net, net }
}
const modelExactOutput = (reserveIn: bigint, reserveOut: bigint, amountOut: bigint, feeBps: bigint) => {
	if (reserveIn === 0n || reserveOut === 0n || amountOut === 0n || amountOut >= reserveOut || feeBps >= BPS) return undefined
	const net = ceilDivide(reserveIn * amountOut, reserveOut - amountOut)
	if (net > MAX) return undefined
	const amountIn = ceilDivide(net * BPS, BPS - feeBps)
	if (amountIn > MAX) return undefined
	return { first: amountIn, second: amountIn - net, net }
}
const modelProportionalDeposit = (yesReserve: bigint, noReserve: bigint, maxYes: bigint, maxNo: bigint) => {
	if (yesReserve === 0n || noReserve === 0n) return undefined
	if (maxYes * noReserve <= maxNo * yesReserve) return { first: maxYes, second: (maxYes * noReserve) / yesReserve }
	return { first: (maxNo * yesReserve) / noReserve, second: maxNo }
}
const modelInitialLiquidity = (completeSets: bigint, yesBps: bigint) => {
	if (yesBps === 0n || yesBps >= BPS) return undefined
	const yesAmount = yesBps >= 5_000n ? (completeSets * (BPS - yesBps)) / yesBps : completeSets
	const noAmount = yesBps >= 5_000n ? completeSets : (completeSets * yesBps) / (BPS - yesBps)
	if (yesAmount === 0n || noAmount === 0n) return undefined
	return { first: yesAmount, second: noAmount }
}

test('#1688 raw receipt wait retries pending receipts and preserves reverted status', async () => {
	const requests: number[] = []
	let now = 0
	const receipt = { status: '0x0' }
	const result = await waitForRawReceipt(
		'0xabc',
		async () => {
			requests.push(now)
			return now >= 75 ? receipt : null
		},
		{ now: () => now, wait: async ms => void (now += ms) },
	)
	expect(result).toBe(receipt)
	expect(requests).toEqual([0, 5, 15, 35, 75])
})

test('#1688 raw receipt wait bounds pending retries and propagates transport failures immediately', async () => {
	let now = 0
	const clock = { now: () => now, wait: async (ms: number) => void (now += ms) }
	const failure = new Error('receipt transport failed')
	await expect(
		waitForRawReceipt(
			'0xabc',
			async () => {
				throw failure
			},
			clock,
		),
	).rejects.toBe(failure)
	expect(now).toBe(0)
	await expect(waitForRawReceipt('0xabc', async () => null, clock)).rejects.toThrow('0xabc after 10000 ms (last RPC result: null)')
	expect(now).toBe(10_000)
})

describe('audit fuzz: constant-product trading math and pair', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let account: Address
	let harness: Address
	let multicall: Address
	let share: Address
	let pool: Address
	let coreFactory: Address
	const raw = (method: string, params: unknown[]) => getAnvilWindowEthereum().requestRaw({ method, params })
	const sendRaw = async (to: Address | undefined, data: Hex) => {
		const hash = await raw('eth_sendTransaction', [to === undefined ? { from: account, data, gas: '0x1000000' } : { from: account, to, data, gas: '0x1000000' }])
		const receipt = await waitForRawReceipt(hash, () => raw('eth_getTransactionReceipt', [hash]))
		return { succeeded: receipt.status === '0x1', created: 'contractAddress' in receipt && typeof receipt.contractAddress === 'string' ? receipt.contractAddress : undefined }
	}
	const send = async (to: Address, data: Hex) => {
		if ((await sendRaw(to, data)).succeeded) return
		await client.call({ account, to, data })
		throw new Error('Transaction reverted without a replayable reason')
	}
	const deploy = async (artifact: Readonly<{ abi: Abi; evm: Readonly<{ bytecode: Readonly<{ object: string }> }> }>, args: readonly unknown[] = []) => {
		const result = await sendRaw(undefined, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args }))
		if (!result.succeeded || result.created === undefined) throw new Error('Deployment failed')
		return getAddress(result.created)
	}
	const selectors = {
		exactInput: encodeFunctionData({ abi: mathArtifact.abi, functionName: 'quoteExactInput', args: [1n, 1n, 1n, 0n] }).slice(0, 10),
		exactOutput: encodeFunctionData({ abi: mathArtifact.abi, functionName: 'quoteExactOutput', args: [1n, 1n, 1n, 0n] }).slice(0, 10),
		deposit: encodeFunctionData({ abi: mathArtifact.abi, functionName: 'proportionalDeposit', args: [1n, 1n, 1n, 1n] }).slice(0, 10),
		initial: encodeFunctionData({ abi: mathArtifact.abi, functionName: 'initialLiquidityAmounts', args: [1n, 1n] }).slice(0, 10),
	}
	type Kind = keyof typeof selectors
	const callData = (kind: Kind, values: readonly bigint[]): Hex => `0x${selectors[kind].slice(2)}${values.map(value => value.toString(16).padStart(64, '0')).join('')}`
	const evaluate = async (cases: readonly { kind: Kind; values: readonly bigint[] }[]) => {
		const { result } = await client.simulateContract({ abi: multicallArtifact.abi, address: multicall, functionName: 'aggregate3', args: [cases.map(item => ({ target: harness, allowFailure: true, callData: callData(item.kind, item.values) }))] })
		return result.map(outcome => (outcome.success && outcome.returnData.length === 130 ? { first: BigInt(`0x${outcome.returnData.slice(2, 66)}`), second: BigInt(`0x${outcome.returnData.slice(66, 130)}`) } : undefined))
	}

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		account = addressString(TEST_ADDRESSES[0])
		await ethereum.impersonateAccount(account)
		await ethereum.setBalance(account, 10n ** 24n)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		harness = await deploy(mathArtifact)
		multicall = await deploy(multicallArtifact)
		const zoltar = await deploy(zoltarArtifact)
		const questionData = await deploy(questionDataArtifact)
		const forker = await deploy(forkerArtifact)
		share = await deploy(shareArtifact)
		coreFactory = await deploy(coreFactoryArtifact)
		pool = await deploy(poolArtifact, [share, coreFactory, zoltar, questionData, forker, 17n, 91n, 10n ** 18n])
		await send(forker, encodeFunctionData({ abi: forkerArtifact.abi, functionName: 'setQuestionOutcome', args: [pool, 3] }))
		await send(share, encodeFunctionData({ abi: shareArtifact.abi, functionName: 'setCanonicalPool', args: [17n, pool] }))
		await send(coreFactory, encodeFunctionData({ abi: coreFactoryArtifact.abi, functionName: 'setPool', args: [pool, 17n] }))
		await send(questionData, encodeFunctionData({ abi: questionDataArtifact.abi, functionName: 'setEndTime', args: [91n, 10n ** 12n] }))
		await setBaselineSnapshot()
	})

	test('math: random and edge-case parity with exact models, k monotonicity and exact-output safety', async () => {
		seed = initialSeed
		let wideDenominator = 0
		const fail = (kind: Kind, values: readonly bigint[], actual: unknown, expected: unknown): never => {
			throw new Error(`${kind}(${values.join(', ')}) = ${JSON.stringify(actual, (_, value) => (typeof value === 'bigint' ? value.toString() : value))}, model ${JSON.stringify(expected, (_, value) => (typeof value === 'bigint' ? value.toString() : value))}`)
		}
		let rounds = 0
		while (rounds < roundsPerProperty) {
			rounds++
			const cases: { kind: Kind; values: bigint[] }[] = []
			for (let index = 0; index < 60; index++) {
				// Realistic reserves, wide reserves, and sums that overflow 256 bits.
				const reserveIn = anyWord()
				const reserveOut = anyWord()
				const amountIn = below(4) === 0 ? MAX - randomBits(1 + below(250)) : anyWord()
				const fee = anyFee()
				cases.push({ kind: 'exactInput', values: [reserveIn, reserveOut, amountIn, fee] })
				const request = () => {
					if (reserveOut === 0n) return 0n
					if (below(3) === 0) return reserveOut - BigInt(1 + below(3))
					return below(2) === 0 ? reserveOut / BigInt(2 + below(1000)) : randomBits(1 + below(256)) % (reserveOut + 2n)
				}
				const requested = request()
				cases.push({ kind: 'exactOutput', values: [reserveIn, reserveOut, requested < 0n ? 0n : requested, fee] })
				cases.push({ kind: 'deposit', values: [anyWord(), anyWord(), anyWord(), anyWord()] })
				cases.push({ kind: 'initial', values: [anyWord(), below(4) === 0 ? pick([0n, 1n, 4_999n, 5_000n, 5_001n, 9_999n, 10_000n, MAX]) : BigInt(below(10_001))] })
			}
			const results = await evaluate(cases)
			const followUps: { kind: Kind; values: bigint[]; requested: bigint; charged: bigint }[] = []
			cases.forEach((item, index) => {
				const actual = results[index]
				const [a, b, c, d] = item.values
				if (a === undefined || b === undefined) throw new Error('Case arguments missing')
				if (item.kind === 'initial') {
					const expected = modelInitialLiquidity(a, b)
					if (expected?.first !== actual?.first || expected?.second !== actual?.second) fail(item.kind, item.values, actual, expected)
					return
				}
				if (c === undefined || d === undefined) throw new Error('Case arguments missing')
				if (item.kind === 'exactInput') {
					const expected = modelExactInput(a, b, c, d)
					if (expected?.first !== actual?.first || expected?.second !== actual?.second) fail(item.kind, item.values, actual, expected)
					if (expected !== undefined) {
						if (a + expected.net > MAX) wideDenominator++
						// k never decreases, with or without the fee kept in the reserve.
						if ((a + expected.net) * (b - expected.first) < a * b) throw new Error(`k decreases after exactInput(${item.values.join(', ')})`)
						// One more unit of output would break the invariant: the output is the largest safe one.
						if ((a + expected.net) * (b - expected.first - 1n) >= a * b) throw new Error(`exactInput(${item.values.join(', ')}) pays less than the invariant allows`)
					}
				} else if (item.kind === 'exactOutput') {
					const expected = modelExactOutput(a, b, c, d)
					if (expected?.first !== actual?.first || expected?.second !== actual?.second) fail(item.kind, item.values, actual, expected)
					if (expected !== undefined) {
						if ((a + expected.net) * (b - c) < a * b) throw new Error(`k decreases after exactOutput(${item.values.join(', ')})`)
						followUps.push({ kind: 'exactInput', values: [a, b, expected.first, d], requested: c, charged: expected.first })
					}
				} else {
					const expected = modelProportionalDeposit(a, b, c, d)
					if (expected?.first !== actual?.first || expected?.second !== actual?.second) fail(item.kind, item.values, actual, expected)
					if (expected !== undefined) {
						if (expected.first > c || expected.second > d) throw new Error(`proportionalDeposit(${item.values.join(', ')}) exceeds a maximum`)
					}
				}
			})
			// Paying the quoted exact-output input always delivers at least the requested output.
			const delivered = await evaluate(followUps)
			followUps.forEach((item, index) => {
				const outcome = delivered[index]
				if (outcome === undefined || outcome.first < item.requested) throw new Error(`exact output undercharges: paying ${item.charged} into (${item.values.slice(0, 2).join(', ')}) fee ${item.values[3]} delivers ${outcome?.first} < ${item.requested}`)
			})
		}
		// The 257-bit denominator branch must be exercised.
		expect(wideDenominator).toBeGreaterThan(0)
	})

	test('pair: random liquidity, swaps, donations and round trips never leak value', async () => {
		seed = initialSeed
		const yesId = (17n << 8n) | 1n
		const noId = (17n << 8n) | 2n
		const snapshot = async () => {
			const id = await raw('evm_snapshot', [])
			if (typeof id !== 'string') throw new Error('Snapshot identifier missing')
			return id
		}
		const revert = async (id: string) => {
			if ((await raw('evm_revert', [id])) !== true) throw new Error('Snapshot revert failed')
		}
		const balance = (owner: Address, id: bigint) => client.readContract({ abi: shareArtifact.abi, address: share, functionName: 'balanceOf', args: [owner, id] })
		const mint = (owner: Address, id: bigint, amount: bigint) => send(share, encodeFunctionData({ abi: shareArtifact.abi, functionName: 'mint', args: [owner, id, amount] }))
		for (let round = 0; round < roundsPerProperty; round++) {
			const baseline = await snapshot()
			const feeBps = pick([0n, 1n, 30n, 300n, 5_000n, 9_999n])
			const factory = await deploy(factoryArtifact, [coreFactory, feeBps])
			await deploy(routerArtifact, [factory])
			await send(factory, encodeFunctionData({ abi: factoryArtifact.abi, functionName: 'createPair', args: [pool] }))
			const pair = getAddress(await client.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getPair', args: [pool] }))
			await send(share, encodeFunctionData({ abi: shareArtifact.abi, functionName: 'setApprovalForAll', args: [pair, true] }))
			const magnitude = pick([12, 20, 40, 70, 100, 120])
			const amount = () => randomBits(1 + below(magnitude))
			await mint(account, yesId, 1n << 200n)
			await mint(account, noId, 1n << 200n)
			let yes = 1001n + amount()
			let no = 1001n + amount()
			let supply = yes < no ? yes : no
			await send(pair, encodeFunctionData({ abi: pairArtifact.abi, functionName: 'initialize', args: [yes, no, 0n, account, NO_DEADLINE] }))
			let ownLiquidity = supply - 1000n
			const context = () => `fee=${feeBps} yes=${yes} no=${no} supply=${supply}`
			const assertState = async (label: string) => {
				const [reserves, total, yesBalance, noBalance] = await Promise.all([client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'getReserves' }), client.readContract({ abi: pairArtifact.abi, address: pair, functionName: 'totalSupply' }), balance(pair, yesId), balance(pair, noId)])
				if (reserves[0] !== yes || reserves[1] !== no || total !== supply || yesBalance !== yes || noBalance !== no) throw new Error(`${label}: pair holds ${reserves[0]}/${reserves[1]} supply ${total}, model ${context()}`)
			}
			// Value per liquidity token never decreases: k1 * s0^2 >= k0 * s1^2.
			const assertNoDilution = (label: string, before: { yes: bigint; no: bigint; supply: bigint }) => {
				if (supply !== before.supply) {
					expect(yes * before.supply).toBeGreaterThanOrEqual(before.yes * supply)
					expect(no * before.supply).toBeGreaterThanOrEqual(before.no * supply)
				}
				if (yes * no * before.supply * before.supply < before.yes * before.no * supply * supply) throw new Error(`${label}: liquidity value fell from ${before.yes}/${before.no}/${before.supply} to ${context()}`)
			}
			await assertState('initialize')
			const operations = 10 + below(10)
			for (let step = 0; step < operations; step++) {
				const before = { yes, no, supply }
				const choice = below(7)
				if (choice === 0) {
					const maxYes = amount()
					const maxNo = amount()
					const used = modelProportionalDeposit(yes, no, maxYes, maxNo)
					if (used === undefined) throw new Error('Model reserves empty')
					const yesLiquidity = (used.first * supply) / yes
					const noLiquidity = (used.second * supply) / no
					const liquidity = yesLiquidity < noLiquidity ? yesLiquidity : noLiquidity
					const data = encodeFunctionData({ abi: pairArtifact.abi, functionName: 'addLiquidity', args: [maxYes, maxNo, 0n, account, NO_DEADLINE] })
					const accepted = (await sendRaw(pair, data)).succeeded
					if (accepted !== (used.first > 0n && used.second > 0n && liquidity > 0n)) throw new Error(`addLiquidity(${maxYes}, ${maxNo}) ${accepted ? 'accepted' : 'rejected'} against the model: ${context()}`)
					if (accepted) {
						yes += used.first
						no += used.second
						supply += liquidity
						ownLiquidity += liquidity
						// Removing exactly what was minted returns no more than was deposited.
						const saved = await snapshot()
						const { result } = await client.simulateContract({ account, abi: pairArtifact.abi, address: pair, functionName: 'removeLiquidity', args: [liquidity, 0n, 0n, account, 10n ** 12n] })
						if (result[0] > used.first || result[1] > used.second) throw new Error(`add then remove profits: deposited ${used.first}/${used.second}, withdrew ${result[0]}/${result[1]}: ${context()}`)
						await revert(saved)
					}
				} else if (choice === 1 && ownLiquidity > 0n) {
					const liquidity = below(4) === 0 ? ownLiquidity : 1n + (randomBits(1 + below(magnitude)) % ownLiquidity)
					const yesOut = (yes * liquidity) / supply
					const noOut = (no * liquidity) / supply
					const accepted = (await sendRaw(pair, encodeFunctionData({ abi: pairArtifact.abi, functionName: 'removeLiquidity', args: [liquidity, 0n, 0n, account, 10n ** 12n] }))).succeeded
					if (accepted !== (yesOut > 0n || noOut > 0n)) throw new Error(`removeLiquidity(${liquidity}) ${accepted ? 'accepted' : 'rejected'} against the model: ${context()}`)
					if (accepted) {
						yes -= yesOut
						no -= noOut
						supply -= liquidity
						ownLiquidity -= liquidity
					}
				} else if (choice === 2 || choice === 3) {
					const yesForNo = below(2) === 0
					const amountIn = amount()
					const quote = modelExactInput(yesForNo ? yes : no, yesForNo ? no : yes, amountIn, feeBps)
					const accepted = (await sendRaw(pair, encodeFunctionData({ abi: pairArtifact.abi, functionName: 'swapExactInput', args: [yesForNo, amountIn, 0n, account, NO_DEADLINE] }))).succeeded
					if (accepted !== (quote !== undefined)) throw new Error(`swapExactInput(${yesForNo}, ${amountIn}) ${accepted ? 'accepted' : 'rejected'} against the model: ${context()}`)
					if (quote !== undefined) {
						if (yesForNo) {
							yes += amountIn
							no -= quote.first
						} else {
							no += amountIn
							yes -= quote.first
						}
						if (yes * no < before.yes * before.no) throw new Error(`k decreased in swapExactInput: ${context()}`)
						// Swapping the proceeds straight back never returns more than was paid.
						const saved = await snapshot()
						const back = modelExactInput(yesForNo ? no : yes, yesForNo ? yes : no, quote.first, feeBps)
						if (back !== undefined) {
							const { result } = await client.simulateContract({ account, abi: pairArtifact.abi, address: pair, functionName: 'swapExactInput', args: [!yesForNo, quote.first, 0n, account, NO_DEADLINE] })
							if (result[0] !== back.first || result[0] > amountIn) throw new Error(`swap round trip returns ${result[0]} for ${amountIn}: ${context()}`)
						}
						await revert(saved)
					}
				} else if (choice === 4) {
					const yesForNo = below(2) === 0
					const reserveOut = yesForNo ? no : yes
					const amountOut = 1n + (randomBits(1 + below(magnitude)) % reserveOut)
					const quote = modelExactOutput(yesForNo ? yes : no, reserveOut, amountOut, feeBps)
					const affordable = quote !== undefined && quote.first <= (await balance(account, yesForNo ? yesId : noId))
					const accepted = (await sendRaw(pair, encodeFunctionData({ abi: pairArtifact.abi, functionName: 'swapExactOutput', args: [yesForNo, amountOut, MAX, account, NO_DEADLINE] }))).succeeded
					if (accepted !== affordable) throw new Error(`swapExactOutput(${yesForNo}, ${amountOut}) ${accepted ? 'accepted' : 'rejected'} against the model: ${context()}`)
					if (quote !== undefined && affordable) {
						if (yesForNo) {
							yes += quote.first
							no -= amountOut
						} else {
							no += quote.first
							yes -= amountOut
						}
						if (yes * no < before.yes * before.no) throw new Error(`k decreased in swapExactOutput: ${context()}`)
					}
				} else if (choice === 5) {
					// A donation only becomes reserve at the next synchronization, and only helps holders.
					const donatedYes = below(2) === 0 ? amount() : 0n
					const donatedNo = below(2) === 0 ? amount() : 0n
					if (donatedYes !== 0n) await mint(pair, yesId, donatedYes)
					if (donatedNo !== 0n) await mint(pair, noId, donatedNo)
					await send(pair, encodeFunctionData({ abi: pairArtifact.abi, functionName: 'sync' }))
					yes += donatedYes
					no += donatedNo
				}
				await assertState(`step ${step} choice ${choice}`)
				assertNoDilution(`step ${step} choice ${choice}`, before)
			}
			await revert(baseline)
		}
	})
})
