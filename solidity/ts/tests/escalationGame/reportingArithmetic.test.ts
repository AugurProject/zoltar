import { beforeAll, test, expect } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { deployContract } from '../../testSupport/deployContract'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier as artifact } from '../../types/contractArtifact'

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
test('ordinary resolution follows the median boundary on every small labeled balance vector', async () => {
	for (const a of [0n, 1n, 2n, 7n, 37n])
		for (const b of [0n, 1n, 2n, 7n, 37n])
			for (const c of [0n, 1n, 2n, 7n, 37n]) {
				const v = [a, b, c] as const,
					sorted = [...v].sort((x, y) => Number(x - y)),
					median = sorted[1]
				if (median === undefined || sorted[2] === undefined) throw new Error('Missing outcome balance')
				expect(await client.readContract({ abi: artifact.abi, address, functionName: 'medianBalanceAttoRep', args: [v] })).toBe(median)
				for (const cost of new Set([0n, median > 0n ? median - 1n : 0n, median, median + 1n, sorted[2], sorted[2] + 1n])) {
					let expected = 3
					if (cost > median) {
						if (sorted[2] === 0n) expected = 0
						else if (sorted[2] > median) expected = v.indexOf(sorted[2])
					}
					expect(await client.readContract({ abi: artifact.abi, address, functionName: 'resolveQuestion', args: [v, cost] })).toBe(BigInt(expected))
					expect(await client.readContract({ abi: artifact.abi, address, functionName: 'hasReachedNonDecision', args: [v, cost] })).toBe(median >= cost)
				}
			}
})
test('ordinary payout and burn split exactly at any boundary, including reward-cap and haircut dust', async () => {
	for (const w of [1n, 5n, 19n, 237n, 10n ** 19n + 11n])
		for (const b of [0n, 1n, w / 3n, (w * 2n) / 3n, w])
			for (const actual of [1n, 3n, 4n, 7n, 9n]) {
				const target = 7n,
					cap = b + b / 2n
				const cuts = [...new Set([0n, 1n, w / 3n, w / 2n, cap - 1n, cap, cap + 1n, w - 1n, w].filter(v => v >= 0n && v <= w))].sort((x, y) => Number(x - y))
				const [wholeP, wholeB] = await client.readContract({ abi: artifact.abi, address, functionName: 'computeOrdinaryWinningWithdrawal', args: [w, w, b, w, actual, target] })
				let prev = 0n,
					paid = 0n,
					burn = 0n
				for (const end of cuts) {
					const [p, c] = await client.readContract({ abi: artifact.abi, address, functionName: 'computeOrdinaryWinningWithdrawal', args: [end - prev, end, b, w, actual, target] })
					paid += p
					burn += c
					prev = end
				}
				expect(paid).toBe(wholeP)
				expect(burn).toBe(wholeB)
			}
})
test('MMR peak geometry partitions every leaf without overlap across small and extreme counts', async () => {
	const zero = `0x${'0'.repeat(64)}` as const
	const ns = [...Array.from({ length: 35 }, (_, i) => BigInt(i + 1)), 2n ** 40n - 1n, 2n ** 40n, 2n ** 40n + 1n, 2n ** 63n - 1n, 2n ** 63n, 2n ** 63n + 1n, 2n ** 64n - 1n]
	for (const n of ns) {
		const peakCount = n
			.toString(2)
			.split('')
			.filter(bit => bit === '1').length
		// The verifier derives the peak from the global leaf position and accepts only that peak's height.
		const rootFromPeak = (leafIndex: bigint, height: number) => client.readContract({ abi: artifact.abi, address, functionName: 'computeMerkleMountainRangeRootFromProof', args: [zero, n, leafIndex, BigInt(height), Array.from({ length: height + peakCount - 1 }, () => zero)] })
		let offset = 0n
		for (let height = 63; height >= 0; --height) {
			const size = 1n << BigInt(height)
			if (!(n & size)) continue
			const points = n <= 35n ? Array.from({ length: Number(size) }, (_, i) => offset + BigInt(i)) : [offset, offset + size / 2n, offset + size - 1n]
			for (const i of new Set(points)) {
				await rootFromPeak(i, height)
				await expect(rootFromPeak(i, height === 0 ? 1 : height - 1)).rejects.toThrow('Bad carry peak')
			}
			offset += size
		}
		expect(offset).toBe(n)
	}
})
