import { beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolCapitalFeeStreams_SecurityPoolCapitalFeeStreams as artifact, test_statoblast_CapitalFeeStreamsHarness_CapitalFeeStreamsHarness as harnessArtifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

type Stream = { start: bigint; duration: bigint; eth: bigint; rep: bigint }
const vested = (budget: bigint, stream: Stream, timestamp: bigint) => {
	const elapsed = timestamp > stream.start ? timestamp - stream.start : 0n
	if (elapsed >= stream.duration) return budget
	return (budget / stream.duration) * elapsed
}
const totalVested = (streams: readonly Stream[], timestamp: bigint) => [streams.reduce((sum, stream) => sum + vested(stream.eth, stream, timestamp), 0n), streams.reduce((sum, stream) => sum + vested(stream.rep, stream, timestamp), 0n)]

describe('Statoblast: fixed-horizon dual-token capital fee streams', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	let harness: Address
	const add = async (start: bigint, eth: bigint, rep: bigint, duration: bigint) => {
		await getAnvilWindowEthereum().setTime(start - 1n)
		return writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'add', args: [eth, rep, duration] }))
	}
	const release = (time: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'release', args: [time] }))
	const preview = (time: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'preview', args: [time] })
	const released = async () => [await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'releasedEth' }), await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'releasedRep' })]
	const totalEarned = async (time: bigint) => {
		const pending = await preview(time)
		const paid = await released()
		return [pending[0] + (paid[0] ?? 0n), pending[1] + (paid[1] ?? 0n)]
	}
	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${harnessArtifact.evm.bytecode.object}` }) })
		if (receipt.contractAddress === undefined) throw new Error('Capital fee harness deployment address missing')
		harness = receipt.contractAddress
		address = await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'streams' })
		await setBaselineSnapshot()
	})

	test('independent end times preserve every funded wei and never accelerate old income', async () => {
		const streams = [
			{ start: 10n, duration: 100n, eth: 1003n, rep: 2005n },
			{ start: 20n, duration: 30n, eth: 307n, rep: 601n },
			{ start: 35n, duration: 75n, eth: 5n, rep: 9n },
		]
		for (const stream of streams) await add(stream.start, stream.eth, stream.rep, stream.duration)
		for (const time of [35n, 49n, 50n, 51n, 109n, 110n, 200n]) expect(await totalEarned(time)).toEqual(totalVested(streams, time))
		await getAnvilWindowEthereum().setTime(200n)
		await release(200n)
		expect(await released()).toEqual([1315n, 2615n])
		expect([...(await client.readContract({ abi: artifact.abi, address, functionName: 'fundedOutstanding' }))]).toEqual([0n, 0n])
		expect([...(await preview(300n))]).toEqual([0n, 0n])
	})

	test('checkpoint frequency and an exact oracle-expiry split cannot alter entitlement', async () => {
		const streams = [
			{ start: 10n, duration: 90n, eth: 901n, rep: 1703n },
			{ start: 20n, duration: 180n, eth: 2003n, rep: 307n },
		]
		for (const stream of streams) await add(stream.start, stream.eth, stream.rep, stream.duration)
		await getAnvilWindowEthereum().setTime(250n)
		for (const time of [20n, 21n, 22n, 49n, 50n, 99n, 100n, 101n, 199n, 200n, 250n]) {
			await release(time)
			expect(await released()).toEqual(totalVested(streams, time))
		}
		expect(await released()).toEqual([2904n, 2010n])
	})

	test('stale, backwards, future and unauthorized operations cannot alter existing streams', async () => {
		await add(10n, 1001n, 500n, 100n)
		await getAnvilWindowEthereum().setTime(20n)
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'addWithoutCheckpoint', args: [10n, 10n, 10n] }))).rejects.toThrow('Checkpoint fees before funding')
		await expect(release(10000n)).rejects.toThrow('Future fee checkpoint')
		await expect(release(9n)).rejects.toThrow('Fee time moved backwards')
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'release', args: [20n] }))).rejects.toThrow('Only portfolio')
		await expect(add(30n, 100n, 100n, 0n)).rejects.toThrow('Invalid fee duration')
		expect(await totalEarned(110n)).toEqual([1001n, 500n])
	})

	test('long histories and late collection remain a fixed-width integral with exact tails', async () => {
		const streams: Stream[] = []
		for (let i = 1; i <= 60; i++) {
			const start = BigInt(i * 11)
			const stream = { start, duration: BigInt((i % 17) + 1), eth: BigInt(i * 13 + 3), rep: BigInt(i * 19 + 5) }
			streams.push(stream)
			await add(stream.start, stream.eth, stream.rep, stream.duration)
			expect(await totalEarned(start + 100n)).toEqual(totalVested(streams, start + 100n))
		}
		await getAnvilWindowEthereum().setTime(10000n)
		const hash = await release(10000n)
		const gas = (await client.waitForTransactionReceipt({ hash })).gasUsed
		expect(gas).toBeLessThan(500_000n)
		expect(await released()).toEqual(totalVested(streams, 10000n))
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ longHistoryReleaseGas: gas })
	})

	test('full clock-width expiry and outstanding-budget limits fail explicitly rather than wrapping', async () => {
		const maximumTime = 2n ** 48n - 1n
		const maximumBudget = 2n ** 128n - 1n
		await add(10n, maximumBudget, 101n, maximumTime - 10n)
		expect(await totalEarned(maximumTime)).toEqual([maximumBudget, 101n])
		await expect(add(20n, maximumBudget, 0n, 10n)).rejects.toThrow('Fee budget exceeds token domain')
		await expect(add(30n, 0n, 1n, maximumTime)).rejects.toThrow('Invalid fee duration')
		expect(await totalEarned(maximumTime)).toEqual([maximumBudget, 101n])
	})
})
