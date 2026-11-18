import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as artifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

// Daily bucket numbers fit in 17 bits before the absolute fee-end ceiling.
const GRANULARITY = 86_400n
const FEE_END_LIMIT = 1n << 33n
const LAST_BUCKET = (FEE_END_LIMIT - 1n) / GRANULARITY
const LEVELS = Array.from({ length: LAST_BUCKET.toString(2).length }, (_unused, index) => BigInt(index))
const UNIT_SCALE = 1_000_000_000n
const CAP = 16_777_216n
const VICTIM = 1n
// Every sibling of this bucket is valid, including near the partial final range.
const VICTIM_BUCKET = (1n << 16n) + 1n
const VICTIM_KEY = VICTIM_BUCKET * GRANULARITY

describe('Statoblast: fee-stream end keys have a bounded depth', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address

	const gasOf = async (execute: () => Promise<Hex>) => (await client.waitForTransactionReceipt({ hash: await writeContractAndWait(client, execute) })).gasUsed
	const target = () => ({ abi: artifact.abi, address, gas: CAP })
	const mint = (questionId: bigint, cash: bigint) => gasOf(() => client.writeContract({ ...target(), functionName: 'mint', args: [1n, questionId, cash, 0n, 0] }))
	const redeem = (questionId: bigint, shares: bigint) => gasOf(() => client.writeContract({ ...target(), functionName: 'redeem', args: [1n, questionId, shares, 0n, 0] }))
	const stream = (questionId: bigint, rateAttoEthPerSecond: bigint, end: bigint) => gasOf(() => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, questionId, rateAttoEthPerSecond * UNIT_SCALE, Number(end), 0] }))
	const deployBook = async (granularity: bigint) => {
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address, 1n, granularity] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Settlement book deployment address missing')
		address = receipt.contractAddress
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createBook', args: [0] }))
	}
	const question = async (questionId: bigint) => (await client.readContract({ abi: artifact.abi, address, functionName: 'question', args: [1n, questionId] }))[0]
	const feeEnd = async (questionId: bigint) => BigInt((await question(questionId)).feeEnd)

	// Gas of the fee-map work in a complete-set redemption: the redemption's own rate change and a
	// refresh that moves the stream to another key (the worst case: both keys walk a deep path).
	const measureRedemption = async (withNeighbours: boolean) => {
		await deployBook(GRANULARITY)
		await mint(VICTIM, 10n ** 18n)
		if (withNeighbours) {
			for (const level of LEVELS) {
				const questionId = 100n + level
				await mint(questionId, 10n ** 12n)
				// Flipping a bucket bit reaches one sibling without passing the fee-end ceiling.
				await stream(questionId, 1n, (VICTIM_BUCKET ^ (1n << level)) * GRANULARITY)
			}
		}
		await stream(VICTIM, 2n, VICTIM_KEY)
		expect(await feeEnd(VICTIM)).toBe(VICTIM_KEY)
		const redeemGas = await redeem(VICTIM, (await question(VICTIM)).outcomeSupplyAttoShares / 2n)
		const sameKeyRefresh = await stream(VICTIM, 3n, VICTIM_KEY)
		const movedKeyRefresh = await stream(VICTIM, 2n, VICTIM_KEY - GRANULARITY)
		expect(await feeEnd(VICTIM)).toBe(VICTIM_KEY - GRANULARITY)
		return { redeem: redeemGas, sameKeyRefresh, movedKeyRefresh }
	}

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
	})

	test('stream ends round down to the granularity and stay below the end limit', async () => {
		await deployBook(GRANULARITY)
		await mint(VICTIM, 10n ** 18n)
		await stream(VICTIM, 1n, 5n * GRANULARITY + 12_345n)
		expect(await feeEnd(VICTIM)).toBe(5n * GRANULARITY)
		await stream(VICTIM, 1n, (1n << 48n) - 1n)
		expect(await feeEnd(VICTIM)).toBe(LAST_BUCKET * GRANULARITY)
		// A stream that cannot reach the first granularity boundary charges nothing.
		await stream(VICTIM, 1n, GRANULARITY - 1n)
		expect(await feeEnd(VICTIM)).toBe(0n)
		expect(await client.readContract({ abi: artifact.abi, address, functionName: 'feeEndGranularity' })).toBe(GRANULARITY)
	})

	test('rates sharing a daily bucket accrue by the second and stop at its exact boundary', async () => {
		await deployBook(GRANULARITY)
		await mint(1n, 10n ** 18n)
		await mint(2n, 10n ** 18n)
		await stream(1n, 2n, GRANULARITY + 1n)
		await stream(2n, 3n, 2n * GRANULARITY - 1n)
		await getAnvilWindowEthereum().advanceTime(2n * GRANULARITY)
		const checkpoint = (timestamp: bigint) => gasOf(() => client.writeContract({ ...target(), functionName: 'checkpointFees', args: [1n, Number(timestamp)] }))
		const accrued = async () => (await client.readContract({ ...target(), functionName: 'totals', args: [1n] }))[2]
		await checkpoint(GRANULARITY - 1n)
		expect(await accrued()).toBe(5n * (GRANULARITY - 1n))
		await checkpoint(GRANULARITY)
		expect(await accrued()).toBe(5n * GRANULARITY)
		await checkpoint(GRANULARITY + 1n)
		expect(await accrued()).toBe(5n * GRANULARITY)
	})

	test('the constructor rejects zero granularity or granularity above 2^32', async () => {
		for (const granularity of [0n, (1n << 32n) + 1n]) {
			const deployment = client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address, 1n, granularity] }), gas: CAP })
			await expect(deployment).rejects.toThrow('Invalid fee end granularity')
		}
	})

	test('a key with a neighbour in every possible sibling subtree keeps redemption far below the transaction cap', async () => {
		const shallow = await measureRedemption(false)
		const deep = await measureRedemption(true)
		const worstShallow = shallow.redeem + shallow.movedKeyRefresh
		const worstDeep = deep.redeem + deep.movedKeyRefresh
		console.log({ levels: LEVELS.length, shallow, deep, worstCaseIncrement: worstDeep - worstShallow })
		// Redemption rewrites its key once and a refresh at an unchanged end once more.
		expect(deep.sameKeyRefresh).toBeLessThan(deep.movedKeyRefresh)
		// The whole deep path adds well under the headroom a full complete-set redemption (about
		// 2M gas on a shallow tree) leaves below the 16,777,216 gas transaction cap.
		expect(worstDeep).toBeLessThan(11_000_000n)
	})
})
