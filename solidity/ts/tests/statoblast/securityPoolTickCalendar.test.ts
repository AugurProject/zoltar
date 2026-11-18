import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { test_statoblast_SecurityPoolTickCalendar_SecurityPoolTickCalendar as artifact } from '../../types/contractArtifact'

const day = 86_400

describe('Statoblast shared exposure tick calendar', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
	})

	const deploy = async (cadence = day) => {
		const receipt = await client.waitForTransactionReceipt({
			hash: await client.sendTransaction({
				data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address, cadence] }),
			}),
		})
		const { contractAddress: address } = receipt
		if (address === undefined) throw new Error('Tick calendar deployment address missing')
		const target = { address, abi: artifact.abi }
		const init = (universe: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'initialize', args: [universe, 0] }))
		const replace = (universe: bigint, at: number, oldTick: bigint, newTick: bigint, oldUnits: bigint, newUnits: bigint) =>
			writeContractAndWait(client, () =>
				client.writeContract({
					...target,
					functionName: 'replaceExposure',
					args: [universe, at, oldTick, newTick, oldUnits, oldUnits * 2n, newUnits, newUnits * 2n],
				}),
			)
		const fees = (universe: bigint, at: number, start: bigint, stop: bigint, rate: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'changeFeePeriod', args: [universe, at, start, stop, rate] }))
		const freeze = (universe: bigint, at: number) => writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'freeze', args: [universe, at] }))
		const checkpoint = (universe: bigint, at: number) => writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'checkpoint', args: [universe, at] }))
		const child = (parent: bigint, child: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'createChild', args: [parent, child] }))
		const book = (universe: bigint) => client.readContract({ ...target, functionName: 'books', args: [universe] })
		const settled = async (universe: bigint, tick: bigint) => [...(await client.readContract({ ...target, functionName: 'settledExposure', args: [universe, tick] }))]
		return { target, init, replace, fees, freeze, checkpoint, child, book, settled }
	}

	test('coalesces and reschedules commitments, preserves unscheduled exposure, and retains old tick records', async () => {
		const calendar = await deploy()
		await calendar.init(1n)
		await calendar.replace(1n, 0, 0n, 0n, 0n, 25n)
		await calendar.replace(1n, 0, 0n, 1n, 0n, 100n)
		await calendar.replace(1n, 0, 0n, 1n, 0n, 50n)
		await calendar.replace(1n, 0, 1n, 64n, 50n, 50n)
		await calendar.checkpoint(1n, day - 1)
		expect((await calendar.book(1n)).slice(0, 3)).toEqual([0n, 175n, 350n])
		await calendar.checkpoint(1n, 3650 * day)
		expect((await calendar.book(1n)).slice(0, 3)).toEqual([3650n, 25n, 50n])
		expect(await calendar.settled(1n, 1n)).toEqual([100n, 200n])
		expect(await calendar.settled(1n, 64n)).toEqual([50n, 100n])
	})

	test('settles the boundary before a fork, carries the remaining schedule, and isolates the siblings', async () => {
		const calendar = await deploy(day / 2)
		const tickLength = day / 2
		expect(await client.readContract({ ...calendar.target, functionName: 'maturityTick', args: [tickLength] })).toBe(2n)
		expect(await client.readContract({ ...calendar.target, functionName: 'windowTicks' })).toBe(128n)
		await calendar.init(0n)
		await calendar.replace(0n, 0, 0n, 1n, 0n, 20n)
		await calendar.replace(0n, 0, 0n, 3n, 0n, 80n)
		await calendar.fees(0n, 0, 1n, 6n, 5n)
		await calendar.freeze(0n, tickLength)
		await calendar.child(0n, 2n)
		await calendar.child(0n, 3n)
		expect(await calendar.settled(0n, 1n)).toEqual([20n, 40n])
		expect(await calendar.settled(2n, 1n)).toEqual([0n, 0n])
		await calendar.replace(2n, tickLength, 3n, 4n, 80n, 80n)
		await calendar.fees(2n, tickLength, 2n, 6n, -5n)
		await calendar.freeze(2n, 2 * tickLength)
		await calendar.child(2n, 4n)
		await calendar.checkpoint(3n, 20 * tickLength)
		await calendar.checkpoint(4n, 20 * tickLength)
		expect(await calendar.settled(3n, 3n)).toEqual([80n, 160n])
		expect(await calendar.settled(4n, 3n)).toEqual([0n, 0n])
		expect(await calendar.settled(4n, 4n)).toEqual([80n, 160n])
		expect((await calendar.book(3n)).slice(3, 5)).toEqual([0n, 25n])
		expect((await calendar.book(2n)).slice(3, 5)).toEqual([0n, 5n])
		expect((await calendar.book(4n)).slice(3, 5)).toEqual([0n, 0n])
	})

	test('charges only complete fee ticks across renewals and an idle gap', async () => {
		const calendar = await deploy()
		await calendar.init(1n)
		await calendar.fees(1n, day / 2, 1n, 3n, 7n)
		await calendar.fees(1n, day / 2, 3n, 6n, 3n)
		await calendar.checkpoint(1n, 2 * day - 1)
		expect((await calendar.book(1n)).slice(3, 5)).toEqual([7n, 0n])
		await calendar.checkpoint(1n, 3 * day)
		expect((await calendar.book(1n)).slice(3, 5)).toEqual([3n, 14n])
		await calendar.checkpoint(1n, 3650 * day)
		expect((await calendar.book(1n)).slice(3, 5)).toEqual([0n, 23n])
	})

	test('measures the same checkpoint and fork with sparse and fully occupied calendars', async () => {
		const calendar = await deploy()
		for (const universe of [1n, 2n]) {
			await calendar.init(universe)
			await calendar.replace(universe, 0, 0n, 64n, 0n, 25n)
			await calendar.replace(universe, 0, 0n, 32n, 0n, 5n)
			await calendar.replace(universe, 0, 0n, 0n, 0n, 50n)
			await calendar.fees(universe, 0, 1n, 64n, 3n)
		}
		for (let tick = 1n; tick < 64n; tick++) {
			await calendar.replace(2n, 0, 0n, tick, 0n, 10n)
		}
		const sparseReschedule = (await client.getTransactionReceipt({ hash: await calendar.replace(1n, 0, 64n, 63n, 25n, 25n) })).gasUsed
		const denseReschedule = (await client.getTransactionReceipt({ hash: await calendar.replace(2n, 0, 64n, 63n, 25n, 25n) })).gasUsed
		const sparseCheckpoint = (await client.getTransactionReceipt({ hash: await calendar.checkpoint(1n, 32 * day) })).gasUsed
		const denseCheckpoint = (await client.getTransactionReceipt({ hash: await calendar.checkpoint(2n, 32 * day) })).gasUsed
		const sparseFork = (await client.getTransactionReceipt({ hash: await calendar.freeze(1n, 32 * day) })).gasUsed
		const denseFork = (await client.getTransactionReceipt({ hash: await calendar.freeze(2n, 32 * day) })).gasUsed
		const sparseChild = (await client.getTransactionReceipt({ hash: await calendar.child(1n, 3n) })).gasUsed
		const denseChild = (await client.getTransactionReceipt({ hash: await calendar.child(2n, 4n) })).gasUsed
		const sparseChildCheckpoint = (await client.getTransactionReceipt({ hash: await calendar.checkpoint(3n, 3650 * day) })).gasUsed
		const denseChildCheckpoint = (await client.getTransactionReceipt({ hash: await calendar.checkpoint(4n, 3650 * day) })).gasUsed
		console.log({ sparseReschedule, denseReschedule, sparseCheckpoint, denseCheckpoint, sparseFork, denseFork, sparseChild, denseChild, sparseChildCheckpoint, denseChildCheckpoint })
		expect(denseReschedule).toBeLessThan(sparseReschedule)
		expect(denseCheckpoint).toBe(sparseCheckpoint)
		expect(denseFork).toBe(sparseFork)
		expect(denseChild).toBe(sparseChild)
		expect(denseChildCheckpoint).toBe(sparseChildCheckpoint)
	})

	test('preserves the last tick of a partially filled snapshot chunk', async () => {
		const calendar = await deploy(day / 4)
		await calendar.init(1n)
		await calendar.replace(1n, 0, 0n, 256n, 0n, 19n)
		await calendar.freeze(1n, 0)
		await calendar.child(1n, 2n)
		await calendar.checkpoint(2n, 64 * day)
		expect(await calendar.settled(2n, 256n)).toEqual([19n, 38n])
		expect((await calendar.book(2n)).slice(1, 3)).toEqual([0n, 0n])
	})

	test('keeps four-hour checkpoints and forks independent of density across snapshot contracts', async () => {
		const tickLength = day / 6
		const calendar = await deploy(tickLength)
		const windowTicks = await client.readContract({ ...calendar.target, functionName: 'windowTicks' })
		expect(windowTicks).toBe(384n)

		for (const universe of [1n, 2n]) {
			await calendar.init(universe)
			await calendar.fees(universe, 0, 192n, 193n, 7n)
			await calendar.replace(universe, 0, 0n, 192n, 0n, 2n)
			await calendar.replace(universe, 0, 0n, 193n, 0n, 3n)
			await calendar.replace(universe, 0, 0n, 384n, 0n, 4n)
		}
		for (let tick = 1n; tick <= windowTicks; tick++) {
			await calendar.replace(2n, 0, 0n, tick, 0n, 1n)
		}

		const gasUsed = async (operation: Promise<Hash>) => (await client.getTransactionReceipt({ hash: await operation })).gasUsed
		const sparseFreeze = await gasUsed(calendar.freeze(1n, 0))
		const denseFreeze = await gasUsed(calendar.freeze(2n, 0))
		const sparseChild = await gasUsed(calendar.child(1n, 3n))
		const denseChild = await gasUsed(calendar.child(2n, 4n))
		await calendar.child(1n, 5n)
		await calendar.replace(5n, 0, 192n, 193n, 2n, 2n)
		await calendar.freeze(5n, 0)
		await calendar.child(5n, 6n)

		const afterWindow = tickLength * Number(windowTicks)
		const sparseCheckpoint = await gasUsed(calendar.checkpoint(3n, afterWindow))
		const denseCheckpoint = await gasUsed(calendar.checkpoint(4n, afterWindow))
		const fullWindowFork = await gasUsed(calendar.freeze(6n, afterWindow))

		expect(await calendar.settled(3n, 192n)).toEqual([2n, 4n])
		expect(await calendar.settled(3n, 193n)).toEqual([3n, 6n])
		expect(await calendar.settled(6n, 192n)).toEqual([0n, 0n])
		expect(await calendar.settled(6n, 193n)).toEqual([5n, 10n])
		expect(await calendar.settled(6n, 384n)).toEqual([4n, 8n])
		expect((await calendar.book(4n)).slice(1, 5)).toEqual([0n, 0n, 0n, 7n])
		expect((await calendar.book(6n)).slice(1, 5)).toEqual([0n, 0n, 0n, 7n])

		console.log({ sparseFreeze, denseFreeze, sparseChild, denseChild, sparseCheckpoint, denseCheckpoint, fullWindowFork })
		expect(denseFreeze).toBe(sparseFreeze)
		expect(denseChild).toBe(sparseChild)
		expect(denseCheckpoint).toBe(sparseCheckpoint)
		expect(fullWindowFork).toBeLessThan(16_777_216n)
	})
})
