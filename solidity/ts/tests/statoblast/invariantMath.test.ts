import { beforeAll, test, expect } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { deployContract } from '../../testSupport/deployContract'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { test_statoblast_InvariantMathHarness_InvariantMathHarness as artifact } from '../../types/contractArtifact'

const node = useIsolatedAnvilNode()
let client: WriteClient
let address: Address
beforeAll(async () => {
	const evm = node.getAnvilWindowEthereum()
	await setupTestAccounts(evm)
	client = createWriteClient(evm, TEST_ADDRESSES[0])
	address = await deployContract(client, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }))
	await node.setBaselineSnapshot()
})
const unitScale = 10n ** 9n
test('an immediate mint and redemption of new settlement units returns the cash deposited within one raw unit', async () => {
	let roundedDown = 0
	let exact = 0
	for (const cash of [1n, 3n, 11n, 99n, 10n ** 18n + 1n])
		for (const units of [1n, 10n, 997n, cash * unitScale, (cash * unitScale) / 2n + 1n, cash * unitScale * 11n + 9n])
			for (const remainder of [0n, 1n, unitScale - 1n])
				for (const deposit of [1n, 2n, 7n, 99n, 10n ** 18n]) {
					const net = cash * unitScale - remainder,
						expectedUnits = (deposit * unitScale * units) / net
					const mint = client.readContract({ abi: artifact.abi, address, functionName: 'mintUnits', args: [deposit, units, net] })
					if (expectedUnits === 0n || (expectedUnits * net) / units < (deposit - 1n) * unitScale) {
						await expect(mint).rejects.toThrow('Settlement purchase below unit precision')
						continue
					}
					const actual = await mint,
						newNet = net + deposit * unitScale,
						newUnits = units + actual
					expect(actual).toBe(expectedUnits)
					expect(newNet * units >= net * newUnits).toBe(true)
					expect(newNet * units - net * newUnits < net).toBe(true)
					const returned = await client.readContract({ abi: artifact.abi, address, functionName: 'cashForUnits', args: [cash + deposit, newUnits, remainder, expectedUnits] })
					expect(returned === deposit || returned === deposit - 1n).toBe(true)
					if (returned !== deposit) roundedDown++
					else exact++
				}
	expect(roundedDown).toBeGreaterThan(0)
	expect(exact).toBeGreaterThan(0)
})
test('a partial redemption preserves or increases remaining cash per unit; final burn takes every raw unit', async () => {
	for (const c of [1n, 17n, 1234567n, (1n << 126n) - 1n])
		for (const u of [2n, 5n, c * unitScale + 7n])
			for (const r of [0n, 1n, unitScale - 1n]) {
				const net = c * unitScale - r
				for (const b of new Set([1n, u / 2n, u - 1n])) {
					const paid = await client.readContract({ abi: artifact.abi, address, functionName: 'cashForUnits', args: [c, u, r, b] })
					const difference = (net - paid * unitScale) * u - net * (u - b)
					expect(difference >= 0n && difference < u * unitScale).toBe(true)
				}
				expect(await client.readContract({ abi: artifact.abi, address, functionName: 'cashForUnits', args: [c, u, r, u] })).toBe(c)
			}
})

test('settlement one-less/one-more bounds and oracle price brackets', async () => {
	for (const u of [1n, 3n, 17n, 10n ** 9n - 1n, (1n << 63n) + 7n]) {
		for (const net of [unitScale - 1n, 3n * unitScale - 1n, 3n * unitScale + 1n, 17n * unitScale, (1n << 86n) + 1n])
			for (const q of new Set([0n, u / 2n, u])) {
				for (const floor of [0n, 1n, 2n, 5n, 7n]) {
					// supply=floor, minimum rate=1 full cash unit per share.
					const budget = await client.readContract({ abi: artifact.abi, address, functionName: 'feeBudget', args: [q, floor, 10n ** 18n, net, u] })
					const value = (z: bigint) => (z * net) / (u * unitScale)
					if (value(q) < floor) expect(budget).toBe(0n)
					else {
						expect(budget <= q && value(q - budget) >= floor).toBe(true)
						if (q > budget) expect(value(q - budget - 1n) < floor).toBe(true)
					}
				}
			}
	}
	for (const u of [0n, 13n, 10n ** 9n + 1n, 10n ** 26n])
		for (const num of [1n, 17n, 10n ** 18n + 1n])
			for (const den of [1n, 7n, 10n ** 7n - 1n])
				for (const rem of [0n, 1n, unitScale - 1n]) {
					const c = await client.readContract({ abi: artifact.abi, address, functionName: 'requiredCash', args: [u, num, den, rem] })
					expect((c * unitScale - rem) * den >= u * num).toBe(true)
					if (c > 0n) expect(((c - 1n) * unitScale - rem) * den < u * num).toBe(true)
				}
	const D = 10n ** 7n
	for (const p of [1n, 7n, D - 1n, D, D + 1n, 10n ** 38n + 7n]) {
		let oldL = p,
			oldH = p
		for (const e of [0n, 1n, 13n, 1000n, D / 2n, D - 2n, D - 1n]) {
			const [lo, hi] = await client.readContract({ abi: artifact.abi, address, functionName: 'bounds', args: [p, e] })
			expect(lo <= p && hi >= p && lo <= oldL && hi >= oldH).toBe(true)
			expect(lo * (D + e) <= p * D && (lo + 1n) * (D + e) > p * D).toBe(true)
			expect(hi * (D - e) >= p * D && (hi - 1n) * (D - e) < p * D).toBe(true)
			oldL = lo
			oldH = hi
		}
	}
})

test('INV-04 carry boundary and out-of-domain scaled overflow retain their specified outcomes', async () => {
	const quote = (units: bigint, remainder: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'requiredCash', args: [units, 1n, 1n, remainder] })
	expect(await quote(unitScale, 0n)).toBe(1n)
	expect(await quote(unitScale, 1n)).toBe(2n)
	const maxWord = (1n << 256n) - 1n
	expect(await quote(maxWord, 0n)).toBe((maxWord + unitScale - 1n) / unitScale)
	await expect(quote(maxWord, 1n)).rejects.toThrow(/overflow|0x11/i)
})

test('INV-04 production allocation envelope fits with maximum fee carry and remains least-integer', async () => {
	const limit = 1n << 128n
	const maximumAllocation = (limit - 1n) * unitScale
	// Funded-parent snapshots can have a large numerator and a small denominator.
	for (const denominator of [1n, 7n, limit - 1n])
		for (const units of [0n, 1n, denominator / 2n, denominator])
			for (const remainder of [0n, 1n, unitScale - 1n]) {
				const scaled = (units * maximumAllocation + denominator - 1n) / denominator + remainder
				expect(scaled < 1n << 159n).toBe(true)
				const cash = await client.readContract({ abi: artifact.abi, address, functionName: 'requiredCash', args: [units, maximumAllocation, denominator, remainder] })
				expect(cash).toBe((scaled + unitScale - 1n) / unitScale)
				expect((cash * unitScale - remainder) * denominator >= units * maximumAllocation).toBe(true)
				if (cash > 0n) expect(((cash - 1n) * unitScale - remainder) * denominator < units * maximumAllocation).toBe(true)
			}
})

test('oracle conservative bounds reject exactly unrepresentable prices', async () => {
	const D = 10n ** 7n
	const maximum = (1n << 256n) - 1n
	for (const uncertainty of [1n, 13n, D / 2n, D - 1n]) {
		const last = (maximum * (D - uncertainty)) / D
		const [lo, hi] = await client.readContract({ abi: artifact.abi, address, functionName: 'bounds', args: [last, uncertainty] })
		expect(lo).toBe((last * D) / (D + uncertainty))
		expect(hi).toBe((last * D + D - uncertainty - 1n) / (D - uncertainty))
		await expect(client.readContract({ abi: artifact.abi, address, functionName: 'bounds', args: [last + 1n, uncertainty] })).rejects.toThrow('Conservative oracle price exceeds uint256')
	}
	for (const price of [0n, (1n << 255n) - 1n, 1n << 255n, maximum]) {
		expect(await client.readContract({ abi: artifact.abi, address, functionName: 'bounds', args: [price, 0n] })).toEqual([price, price])
	}
	for (const uncertainty of [1n, D / 2n, D - 1n]) {
		expect(await client.readContract({ abi: artifact.abi, address, functionName: 'liquidationPrice', args: [maximum, uncertainty] })).toBe((maximum * D) / (D + uncertainty))
	}
	const fundedMaximum = ((1n << 128n) - 1n) * 10n ** 18n
	const [, conservative] = await client.readContract({ abi: artifact.abi, address, functionName: 'bounds', args: [fundedMaximum, D - 1n] })
	expect(conservative).toBe(fundedMaximum * D)
	for (const uncertainty of [D, D + 1n, maximum]) {
		for (const functionName of ['conservativePrice', 'liquidationPrice'] as const) await expect(client.readContract({ abi: artifact.abi, address, functionName, args: [1n, uncertainty] })).rejects.toThrow('Invalid oracle uncertainty')
	}
})

test('INV-04 carry can change the minimum raw cash or overflow the scaled intermediate', async () => {
	const quote = (units: bigint, remainder: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'requiredCash', args: [units, 1n, 1n, remainder] })
	expect(await quote(unitScale, 0n)).toBe(1n)
	expect(await quote(unitScale, 1n)).toBe(2n)

	const maxWord = (1n << 256n) - 1n
	expect(await quote(maxWord, 0n)).toBe((maxWord + unitScale - 1n) / unitScale)
	await expect(quote(maxWord, 1n)).rejects.toThrow(/overflow|0x11/i)
})
