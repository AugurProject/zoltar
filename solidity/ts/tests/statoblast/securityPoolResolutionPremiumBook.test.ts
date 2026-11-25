import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as artifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const day = 86_400
const window = 52 * day
const rate = 10n ** 18n
const budget = BigInt(window) * rate

describe('Statoblast: question-linked resolution premium expiry', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: artifact.abi, address })
	const fund = (question: bigint, amount = budget) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'fund', args: [0n, question, amount] }))
	const schedule = (question: bigint, finalAfter: number, universe = 0n) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'schedule', args: [universe, question, finalAfter] }))
	const checkpoint = async (timestamp: number, universe = 0n) => {
		const request = { ...target(), functionName: 'checkpoint' as const, args: [universe, timestamp] as const }
		const quote = await client.simulateContract(request)
		await writeContractAndWait(client, () => client.writeContract(request))
		return [quote.result[0], quote.result[1]] as const
	}
	const totals = (universe = 0n) => client.readContract({ ...target(), functionName: 'totals', args: [universe] })
	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		await node.getAnvilWindowEthereum().advanceTime(10_000_000n)
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Missing premium ledger deployment')
		address = receipt.contractAddress
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'register', args: [0n, 0] }))
		await node.setBaselineSnapshot()
	})

	test.each([false, true])('#1246 two one-unit premiums earn completely across the funded window (chunked: %s)', async chunked => {
		await fund(1n, 1n)
		await fund(2n, 1n)
		await schedule(1n, window)
		await schedule(2n, window)
		let earned = 0n
		let unused = 0n
		for (const timestamp of chunked ? [day, 3 * day, 20 * day, window, window + 1] : [window + 1]) {
			const cash = await checkpoint(timestamp)
			earned += cash[0]
			unused += cash[1]
		}
		expect(earned).toBe(2n)
		expect(unused).toBe(0n)
		expect((await totals()).slice(0, 2)).toEqual([0n, 0n])
	})

	test('#1246 a small six-decimal premium earns over the full reporting window', async () => {
		await fund(1n, 1_000_000n)
		await schedule(1n, window)
		const [earned, unused] = await checkpoint(window + 1)
		expect(earned).toBeGreaterThanOrEqual(999_999n)
		expect(earned + unused).toBe(1_000_000n)
	})

	test('three-day finality stops income and releases the entire unearned 49-day tail', async () => {
		await fund(1n)
		await schedule(1n, 3 * day)
		expect(await checkpoint(3 * day + 1)).toEqual([3n * BigInt(day) * rate, 49n * BigInt(day) * rate])
		expect(await checkpoint(window + 1)).toEqual([0n, 0n])
		expect((await totals()).slice(0, 2)).toEqual([0n, 0n])
	})
	test('a tiny unresolved question cannot collect the large finalized question tail', async () => {
		await fund(1n, 1_000n * budget)
		await fund(2n, budget)
		await schedule(1n, 3 * day)
		await schedule(2n, window)
		expect((await checkpoint(3 * day + 1))[1]).toBe(1_000n * 49n * BigInt(day) * rate)
		expect(await checkpoint(window + 1)).toEqual([BigInt(49 * day - 1) * rate, 0n])
	})
	test('a timely dispute extends only its funded future interval', async () => {
		await fund(1n)
		await schedule(1n, 3 * day)
		expect(await checkpoint(day)).toEqual([BigInt(day) * rate, 0n])
		await schedule(1n, 7 * day)
		expect(await checkpoint(8 * day)).toEqual([6n * BigInt(day) * rate, 45n * BigInt(day) * rate])
		expect(await checkpoint(window)).toEqual([0n, 0n])
	})
	test('complete-set closure cancels all remaining income without scanning another question', async () => {
		await fund(1n)
		await fund(2n)
		await schedule(1n, window)
		await checkpoint(day)
		const request = { ...target(), functionName: 'cancel' as const, args: [0n, 1n] as const }
		expect((await client.simulateContract(request)).result).toBe(51n * BigInt(day) * rate)
		await writeContractAndWait(client, () => client.writeContract(request))
		expect(await checkpoint(window + 1)).toEqual([0n, 0n])
		expect((await client.readContract({ ...target(), functionName: 'question', args: [0n, 2n] }))[1]).toBe(budget)
	})
	test('forks preserve premium cash across chosen earnings, expiry and neutral recovery', async () => {
		await fund(1n)
		await schedule(1n, 6 * day)
		expect(await checkpoint(day)).toEqual([BigInt(day) * rate, 0n])
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [0n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [0n, 1n, 1n, 2n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [0n, 1n] }))
		const recovery = { ...target(), functionName: 'recover' as const, args: [0n, 1n, 100n, 100n] as const }
		const neutral = (await client.simulateContract(recovery)).result
		expect(neutral).toBe((51n * BigInt(day) * rate) / 2n)
		await writeContractAndWait(client, () => client.writeContract(recovery))
		const [earned, unused] = await checkpoint(7 * day, 1n)
		expect(earned).toBe((5n * BigInt(day) * rate) / 2n)
		expect(BigInt(day) * rate + neutral + earned + unused).toBe(budget)
		expect(await client.readContract({ ...target(), functionName: 'totalCash' })).toBe(0n)
	})
	test.each([false, true])('forks never resurrect refunded source premiums (unrelated funding: %s)', async unrelated => {
		await fund(1n)
		await schedule(1n, 3 * day)
		if (unrelated) {
			await fund(2n)
			await schedule(2n, window)
		}
		await checkpoint(4 * day)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [0n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [0n, 1n, 1n, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [0n, 1n] }))
		await schedule(1n, 7 * day, 1n)
		expect(await checkpoint(4 * day + 1, 1n)).toEqual([unrelated ? rate : 0n, 0n])
		expect([...(await client.readContract({ ...target(), functionName: 'question', args: [1n, 1n] }))]).toEqual([0n, 0n])
		expect(await checkpoint(7 * day + 1, 1n)).toEqual([unrelated ? BigInt(3 * day) * rate : 0n, 0n])
		expect((await totals(1n))[0]).toBe(unrelated ? BigInt(45 * day - 1) * rate : 0n)
	})
	test('a fork at the exact finality boundary retains the still-unrefunded premium', async () => {
		await fund(1n)
		await schedule(1n, 3 * day)
		await checkpoint(3 * day)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [0n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [0n, 1n, 1n, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [0n, 1n] }))
		await schedule(1n, 6 * day, 1n)
		expect(await checkpoint(6 * day + 1, 1n)).toEqual([BigInt(3 * day) * rate, BigInt(46 * day) * rate])
	})
	test('nested forks preserve both inherited refund cutoffs and newly refunded child questions', async () => {
		await fund(1n)
		await fund(2n)
		await fund(3n)
		await schedule(1n, 3 * day)
		await schedule(2n, 6 * day)
		await schedule(3n, window)
		await checkpoint(4 * day)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [0n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [0n, 1n, 1n, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [0n, 1n] }))
		await checkpoint(8 * day, 1n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [1n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [1n, 2n, 1n, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [1n, 2n] }))
		await schedule(1n, 11 * day, 2n)
		await schedule(2n, 11 * day, 2n)
		expect(await checkpoint(11 * day + 1, 2n)).toEqual([BigInt(3 * day + 1) * rate, 0n])
		expect([...(await client.readContract({ ...target(), functionName: 'question', args: [2n, 1n] }))]).toEqual([0n, 0n])
		expect([...(await client.readContract({ ...target(), functionName: 'question', args: [2n, 2n] }))]).toEqual([0n, 0n])
		expect((await totals(2n))[0]).toBe(BigInt(41 * day - 1) * rate)
	})
	test('an inherited final premium cannot be revived by a late response', async () => {
		await fund(1n)
		await schedule(1n, 2 * day)
		await checkpoint(day)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [0n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [0n, 1n, 1n, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [0n, 1n] }))
		expect(await checkpoint(3 * day, 1n)).toEqual([BigInt(day) * rate, 50n * BigInt(day) * rate])
		await schedule(1n, 4 * day, 1n)
		expect(await checkpoint(4 * day + 1, 1n)).toEqual([0n, 0n])
		expect(await checkpoint(window, 1n)).toEqual([0n, 0n])
	})
	test.each([0, day / 2])('a child response after the prepaid window ended keeps reporting live and refunds the unearned tail (seconds past the prepaid end: %d)', async elapsed => {
		await fund(1n)
		await schedule(1n, window - day)
		expect(await checkpoint(window - 2 * day)).toEqual([BigInt(window - 2 * day) * rate, 0n])
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [0n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [0n, 1n, 1n, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChild', args: [0n, 1n] }))
		// The inherited deadline refunds its unearned tail without a fresh grace period.
		// A later schedule cannot revive that already-final premium.
		expect(await checkpoint(window + elapsed, 1n)).toEqual([BigInt(day) * rate, BigInt(day) * rate])
		await schedule(1n, window + elapsed + 3 * day, 1n)
		expect(await checkpoint(window + day + 1, 1n)).toEqual([0n, 0n])
		expect((await totals(1n)).slice(0, 2)).toEqual([0n, 0n])
		expect(await client.readContract({ ...target(), functionName: 'totalCash' })).toBe(0n)
	})
	test('aggregate recovery across questions depends only on cumulative recovered shares', async () => {
		await fund(1n, 17n)
		await fund(2n, 12n)
		const write = (run: () => ReturnType<typeof client.writeContract>) => writeContractAndWait(client, run)
		await write(() => client.writeContract({ ...target(), functionName: 'freeze', args: [0n] }))
		await write(() => client.writeContract({ ...target(), functionName: 'choose', args: [0n, 1n, 3n, 8n] }))
		const neutral = 29n - (29n * 3n) / 8n
		const scale = 10n ** 9n
		for (const [first, second] of [
			[1n, 1n],
			[8n, 5n],
			[13n, 7n],
		] as const) {
			const expected = (neutral * ((17n * scale * first) / 13n + (12n * scale * second) / 7n)) / (29n * scale)
			for (const history of [
				[
					[1n, first],
					[2n, second],
				],
				[
					[2n, second],
					[1n, first],
				],
				[
					[1n, first / 2n],
					[2n, second],
					[1n, first - first / 2n],
				],
			] as const) {
				const snapshot = await node.getAnvilWindowEthereum().anvilSnapshot()
				for (const [question, shares] of history) if (shares > 0n) await write(() => client.writeContract({ ...target(), functionName: 'recover', args: [0n, question, shares, question === 1n ? 13n : 7n] }))
				expect(29n - (await client.readContract({ ...target(), functionName: 'totalCash' }))).toBe(expected)
				await node.getAnvilWindowEthereum().anvilRevert(snapshot)
			}
		}
	})

	test.each([1n, 11n, 30n])('cumulative choices assign branch floors and leave bounded neutral dust for %s cash', async cash => {
		await fund(1n, cash)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freeze', args: [0n] }))
		for (const allocations of [
			[
				[1n, 1n],
				[2n, 3n],
				[1n, 2n],
				[3n, 1n],
			],
			[
				[3n, 1n],
				[1n, 2n],
				[2n, 3n],
			],
		] as const) {
			const snapshot = await node.getAnvilWindowEthereum().anvilSnapshot()
			for (const [child, cumulative] of allocations) await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'choose', args: [0n, child, cumulative, 6n] }))
			const amounts = await Promise.all([1n, 2n, 3n].map(child => client.readContract({ ...target(), functionName: 'branchCash', args: [child] })))
			expect(amounts).toEqual([(cash * 2n) / 6n, (cash * 3n) / 6n, cash / 6n])
			const dust = cash - amounts.reduce((sum, piece) => sum + piece, 0n)
			expect(dust).toBeLessThan(3n)
			await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'recover', args: [0n, 1n, 1n, 1n] }))
			expect(await client.readContract({ ...target(), functionName: 'totalCash' })).toBe(cash - dust)
			await node.getAnvilWindowEthereum().anvilRevert(snapshot)
		}
	})
})
