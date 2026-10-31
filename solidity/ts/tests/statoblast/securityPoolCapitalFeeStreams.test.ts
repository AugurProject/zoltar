import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
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
	const add = async (start: bigint, eth: bigint, rep: bigint) => {
		await getAnvilWindowEthereum().setTime(start - 1n)
		return writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'add', args: [eth, rep] }))
	}
	const release = (time: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'release', args: [time] }))
	const preview = (time: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'preview', args: [time] })
	const released = async () => [await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'releasedEth' }), await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'releasedRep' })]
	const totalEarned = async (time: bigint) => {
		const pending = await preview(time)
		const paid = await released()
		return [pending[0] + (paid[0] ?? 0n), pending[1] + (paid[1] ?? 0n)]
	}
	const deploy = async (duration: bigint) => {
		const hash = await writeContractAndWait(client, () => client.sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [duration] }) }))
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined) throw new Error('Capital fee harness deployment address missing')
		const deployedHarness = receipt.contractAddress
		const deployedStreams = await client.readContract({ abi: harnessArtifact.abi, address: deployedHarness, functionName: 'streams' })
		return { harness: deployedHarness, address: deployedStreams }
	}
	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const deployed = await deploy(100n)
		harness = deployed.harness
		address = deployed.address
		await setBaselineSnapshot()
	})

	test('independent end times preserve every funded attoETH and never accelerate old income', async () => {
		const streams = [
			{ start: 10n, duration: 100n, eth: 1003n, rep: 2005n },
			{ start: 20n, duration: 100n, eth: 307n, rep: 601n },
			{ start: 35n, duration: 100n, eth: 5n, rep: 9n },
		]
		for (const stream of streams) await add(stream.start, stream.eth, stream.rep)
		for (const time of [35n, 109n, 110n, 111n, 119n, 120n, 121n, 134n, 135n, 200n]) expect(await totalEarned(time)).toEqual(totalVested(streams, time))
		await getAnvilWindowEthereum().setTime(200n)
		await release(200n)
		expect(await released()).toEqual([1315n, 2615n])
		expect([...(await client.readContract({ abi: artifact.abi, address, functionName: 'fundedOutstanding' }))]).toEqual([0n, 0n])
		expect([...(await preview(300n))]).toEqual([0n, 0n])
	})

	test('funding in the same second merges storage while preserving each stream remainder', async () => {
		await getAnvilWindowEthereum().setTime(9n)
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'addTwice', args: [101n, 199n, 199n, 101n] }))
		expect(await totalEarned(109n)).toEqual([198n, 198n])
		expect(await totalEarned(110n)).toEqual([300n, 300n])
		await add(20n, 107n, 209n)
		expect(await totalEarned(110n)).toEqual([390n, 480n])
		expect(await totalEarned(120n)).toEqual([407n, 509n])
	})

	test('checkpoint frequency and an exact oracle-expiry split cannot alter entitlement', async () => {
		const streams = [
			{ start: 10n, duration: 100n, eth: 901n, rep: 1703n },
			{ start: 20n, duration: 100n, eth: 2003n, rep: 307n },
		]
		for (const stream of streams) await add(stream.start, stream.eth, stream.rep)
		await getAnvilWindowEthereum().setTime(250n)
		for (const time of [20n, 21n, 22n, 49n, 50n, 99n, 100n, 101n, 199n, 200n, 250n]) {
			await release(time)
			expect(await released()).toEqual(totalVested(streams, time))
		}
		expect(await released()).toEqual([2904n, 2010n])
	})

	test('stale, backwards, future and unauthorized operations cannot alter existing streams', async () => {
		await add(10n, 1001n, 500n)
		await getAnvilWindowEthereum().setTime(20n)
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'addWithoutCheckpoint', args: [10n, 10n] }))).rejects.toThrow('Checkpoint fees before funding')
		await expect(release(10000n)).rejects.toThrow('Future fee checkpoint')
		await expect(release(9n)).rejects.toThrow('Fee time moved backwards')
		await expect(writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'release', args: [20n] }))).rejects.toThrow('Only portfolio')
		await expect(deploy(0n)).rejects.toThrow('Invalid fee duration')
		expect(await totalEarned(110n)).toEqual([1001n, 500n])
	})

	test('long histories and late collection remain a fixed-width integral with exact tails', async () => {
		const streams: Stream[] = []
		for (let i = 1; i <= 60; i++) {
			const start = BigInt(i * 11)
			const stream = { start, duration: 100n, eth: BigInt(i * 13 + 3), rep: BigInt(i * 19 + 5) }
			streams.push(stream)
			await add(stream.start, stream.eth, stream.rep)
			expect(await totalEarned(start + 47n)).toEqual(totalVested(streams, start + 47n))
			expect(await totalEarned(start + 100n)).toEqual(totalVested(streams, start + 100n))
		}
		await getAnvilWindowEthereum().setTime(10000n)
		const hash = await release(10000n)
		const gas = (await client.waitForTransactionReceipt({ hash })).gasUsed
		expect(gas).toBeLessThan(500_000n)
		expect(await released()).toEqual(totalVested(streams, 10000n))
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ longHistoryReleaseGas: gas })
	})

	test('a sparse cold expiry funds both tokens without making the next caller pay for six-slot ancestors', async () => {
		const start = (1n << 24n) + 1n - 100n
		const hash = await add(start, 10n ** 18n + 7n, 10n ** 18n + 13n)
		const gas = (await client.waitForTransactionReceipt({ hash })).gasUsed
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ sparseColdDualTokenFundingGas: gas })
		expect(gas).toBeLessThan(350_000n)
		expect(await totalEarned(start + 100n)).toEqual([10n ** 18n + 7n, 10n ** 18n + 13n])
	})

	test('full clock-width expiry and outstanding-budget limits fail explicitly rather than wrapping', async () => {
		const maximumTime = 2n ** 48n - 1n
		const maximumBudget = 2n ** 128n - 1n
		const wide = await deploy(maximumTime - 100n)
		const fund = async (start: bigint, eth: bigint, rep: bigint) => {
			await getAnvilWindowEthereum().setTime(start - 1n)
			return writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: wide.harness, functionName: 'add', args: [eth, rep] }))
		}
		const quote = async () => [...(await client.readContract({ abi: artifact.abi, address: wide.address, functionName: 'preview', args: [maximumTime] }))]
		await fund(10n, maximumBudget, 101n)
		expect(await quote()).toEqual([maximumBudget, 101n])
		await expect(fund(20n, maximumBudget, 0n)).rejects.toThrow('Fee budget exceeds token domain')
		await expect(fund(101n, 0n, 1n)).rejects.toThrow('Invalid fee duration')
		expect(await quote()).toEqual([maximumBudget, 101n])
	})

	test('one-second full-budget reuse at a distant timestamp preserves large cumulative integrals', async () => {
		// Anvil's host clock cannot mine near uint48.max. The preceding test
		// covers that endpoint through the contract's explicit timestamp API.
		const distantTime = 2n ** 40n
		const maximumBudget = 2n ** 128n - 1n
		const short = await deploy(1n)
		for (const start of [distantTime - 3n, distantTime - 2n]) {
			await getAnvilWindowEthereum().setTime(start - 1n)
			await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: short.harness, functionName: 'add', args: [maximumBudget, maximumBudget - 1n] }))
			expect([...(await client.readContract({ abi: artifact.abi, address: short.address, functionName: 'preview', args: [distantTime] }))]).toEqual([maximumBudget, maximumBudget - 1n])
		}
		expect(await client.readContract({ abi: harnessArtifact.abi, address: short.harness, functionName: 'releasedEth' })).toBe(maximumBudget)
		expect(await client.readContract({ abi: harnessArtifact.abi, address: short.harness, functionName: 'releasedRep' })).toBe(maximumBudget - 1n)
	})
})
