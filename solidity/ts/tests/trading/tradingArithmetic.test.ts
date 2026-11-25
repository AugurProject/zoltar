import { beforeAll, test, expect } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { deployContract } from '../../testSupport/deployContract'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { trading_test_TwoWayConstantProductMathHarness_TwoWayConstantProductMathHarness as artifact } from '../../types/contractArtifact'

import { test_statoblast_InvariantMathHarness_InvariantMathHarness as prices } from '../../types/contractArtifact'
let feed: Address
const node = useIsolatedAnvilNode()
let client: WriteClient
let address: Address
beforeAll(async () => {
	const evm = node.getAnvilWindowEthereum()
	await setupTestAccounts(evm)
	client = createWriteClient(evm, TEST_ADDRESSES[0])
	address = await deployContract(client, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }))
	feed = await deployContract(client, encodeDeployData({ abi: prices.abi, bytecode: `0x${prices.evm.bytecode.object}` }))
	await node.setBaselineSnapshot()
})
const ceil = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor
const B = 10000n
const quote = (x: bigint, y: bigint, a: bigint, f: bigint) => {
	const net = (a * (B - f)) / B
	return (y * net) / (x + net)
}
const price = (args: readonly [bigint, bigint]) => client.readContract({ abi: prices.abi, address: feed, functionName: 'conditionalYesBps', args })
test('same-direction splitting and immediate reversals cannot improve a trader balance in a fixed pool', async () => {
	let count = 0,
		roundTrips = 0
	for (const x of [2n, 11n, 53n, 257n, 10n ** 18n])
		for (const y of [5n, 17n, 401n, 10n ** 17n])
			for (const f of [0n, 1n, 333n, 4999n])
				for (const [a, b] of [
					[2n, 3n],
					[53n, 7n],
					[23n, 307n],
					[x / 3n + 1n, x / 2n + 1n],
				] as const) {
					const first = quote(x, y, a, f)
					if (first === 0n) continue
					const [p] = await client.readContract({ abi: artifact.abi, address, functionName: 'quoteExactInput', args: [x, y, a, f] })
					expect(p).toBe(first)
					const second = quote(x + a, y - first, b, f)
					if (second > 0n) {
						const [s] = await client.readContract({ abi: artifact.abi, address, functionName: 'quoteExactInput', args: [x + a, y - first, b, f] })
						const [single] = await client.readContract({ abi: artifact.abi, address, functionName: 'quoteExactInput', args: [x, y, a + b, f] })
						expect(p + s <= single).toBe(true)
						count++
					}
					if (quote(y - p, x + a, p, f) > 0n) {
						const [round] = await client.readContract({ abi: artifact.abi, address, functionName: 'quoteExactInput', args: [y - p, x + a, p, f] })
						expect(round <= a).toBe(true)
						roundTrips++
					}
				}
	expect(count).toBeGreaterThan(0)
	expect(roundTrips).toBeGreaterThan(0)
})
test('price mirrors and scales exactly with 257-bit sums and initial prices round away from half', async () => {
	for (const x of [0n, 1n, 63n, 10n ** 14n, (1n << 255n) - 1n, 1n << 255n, (1n << 256n) - 1n])
		for (const y of [0n, 3n, 177n, 2n ** 255n, 2n ** 256n - 1n]) {
			if (x + y === 0n) continue
			const a = await price([x, y]),
				b = await price([y, x])
			expect(a).toBe((B * y) / (x + y))
			expect(a + b).toBe(B - ((B * y) % (x + y) === 0n ? 0n : 1n))
			if (7n * (x > y ? x : y) < 1n << 256n) expect(await price([x * 7n, y * 7n])).toBe(a)
		}
	for (const c of [11n, 4999n, 10001n, (1n << 180n) + 5n])
		for (const p of [1n, 15n, 3000n, 4999n, 5000n, 5001n, 9999n]) {
			if ((c * (p < B / 2n ? p : B - p)) / (p < B / 2n ? B - p : p) === 0n) continue
			const [y, n] = await client.readContract({ abi: artifact.abi, address, functionName: 'initialLiquidityAmounts', args: [c, p] })
			const [ry, rn] = await client.readContract({ abi: artifact.abi, address, functionName: 'initialLiquidityAmounts', args: [c, B - p] })
			const actual = await price([y, n])
			expect([y, n]).toEqual([rn, ry])
			expect(p < B / 2n ? actual <= p : actual >= p).toBe(true)
		}
})
test('exact-output minimum gross input makes fixed-reserve forward quote cross the requested threshold', async () => {
	for (const x of [1n, 2n, 97n, (1n << 100n) - 1n, 1n << 170n])
		for (const y of [4n, 7n, 101n, 1n << 96n, 1n << 180n])
			for (const fee of [0n, 1n, 30n, 9999n]) {
				for (const q of [1n, y / 2n, y - 1n]) {
					const needed = ceil(ceil(x * q, y - q) * 10000n, 10000n - fee)
					if (needed > (1n << 256n) - 1n) continue
					const [cost] = await client.readContract({ abi: artifact.abi, address, functionName: 'quoteExactOutput', args: [x, y, q, fee] })
					const [out] = await client.readContract({ abi: artifact.abi, address, functionName: 'quoteExactInput', args: [x, y, cost, fee] })
					expect(out >= q).toBe(true)
					expect(cost).toBe(needed)
					const previousNet = ((cost - 1n) * (10000n - fee)) / 10000n
					const previous = (y * previousNet) / (x + previousNet)
					if (previous > 0n) {
						const [actual] = await client.readContract({ abi: artifact.abi, address, functionName: 'quoteExactInput', args: [x, y, cost - 1n, fee] })
						expect(actual < q).toBe(true)
					} else {
						let reason = 'Insufficient output'
						if (cost === 1n) reason = 'Input is zero'
						else if (previousNet === 0n) reason = 'Net input is zero'
						await expect(client.readContract({ abi: artifact.abi, address, functionName: 'quoteExactInput', args: [x, y, cost - 1n, fee] })).rejects.toThrow(reason)
					}
				}
			}
})
