import { securityPoolMintForQuotedBudget } from '@zoltar/trading-shared/trading/securityPoolMint'
import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as artifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const scale = 1_000_000_000n

describe('Statoblast: settlement cash per claim unit', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: artifact.abi, address })
	const mint = (question: bigint, cash: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'mint', args: [1n, question, cash, 0n, 1] }))
	const redeem = (question: bigint, shares: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'redeem', args: [1n, question, shares, 0n, 1] }))
	const totals = () => client.readContract({ ...target(), functionName: 'totals', args: [1n] })
	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address, 1n, 1n] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Settlement unit-index ledger missing')
		address = receipt.contractAddress
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createBook', args: [0] }))
		for (let question = 1n; question <= 20n; question++) {
			await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'mint', args: [1n, question, 10n, 0n, 0] }))
			await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, question, 9n * scale, 1, 0] }))
		}
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freezeMatured', args: [1n, 1] }))
		for (let question = 1n; question <= 20n; question++) {
			for (let share = 0; share < 9; share++) await redeem(question, 1n)
		}
		expect((await totals())[0]).toBe(20n)
		expect(await client.readContract({ ...target(), functionName: 'scaledUnits', args: [1n] })).toBe(2n * scale)
		await node.setBaselineSnapshot()
	})
	test('new cash cannot capture old holders accumulated redemption dust', async () => {
		await mint(100n, 20n)
		const request = { ...target(), functionName: 'redeem' as const, args: [1n, 100n, 20n, 0n, 1] as const }
		const returned = (await client.simulateContract(request)).result[0]
		expect(returned).toBe(20n)
		await writeContractAndWait(client, () => client.writeContract(request))
		expect((await totals())[0]).toBe(20n)
		for (let question = 1n; question <= 20n; question++) await redeem(question, 1n)
		expect((await totals()).slice(0, 3)).toEqual([0n, 0n, 180n])
	})
	test('a fresh low-decimal purchase still pays its cash APR at an inflated unit price', async () => {
		const cash = 1_000_000_000_000n
		await mint(100n, cash)
		const [weighted] = await client.readContract({ ...target(), functionName: 'scaledQuestion', args: [1n, 100n] })
		const duration = 30n * 86_400n
		const denominator = 10_000n * 365n * 86_400n
		const unitRate = (weighted.feePrincipalAttoEth * 1_000n) / denominator
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [1n, 100n, unitRate, Number(duration + 1n), 1] }))
		const [publicQuestion] = await client.readContract({ ...target(), functionName: 'question', args: [1n, 100n] })
		expect(publicQuestion.feePrincipalAttoEth).toBe(cash)
		const expectedCashRate = (cash * 1_000n * scale) / denominator
		expect(expectedCashRate - publicQuestion.feeRateAttoEthPerSecond).toBeGreaterThanOrEqual(0n)
		expect(expectedCashRate - publicQuestion.feeRateAttoEthPerSecond).toBeLessThanOrEqual(10n)
		await node.getAnvilWindowEthereum().advanceTime(duration + 1n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freezeMatured', args: [1n, Number(duration + 1n)] }))
		const [remainingCash, , fees] = await totals()
		const earned = fees - 180n
		const expected = (cash * 1_000n * duration) / denominator
		expect(earned).toBeGreaterThanOrEqual(expected - 1n)
		expect(earned).toBeLessThanOrEqual(expected + 1n)
		expect(remainingCash + fees).toBe(cash + 200n)
		expect((await client.simulateContract({ ...target(), functionName: 'redeem', args: [1n, 1n, 1n, 0n, Number(duration + 1n)] })).result[0]).toBe(1n)
	})
	test('fork cash targets preserve an inflated source value and an earlier impairment', async () => {
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'sealForFork', args: [1n, 1] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChildBook', args: [1n, 20n, 0n] }))
		expect(await client.readContract({ ...target(), functionName: 'quoteMint', args: [2n, 100n, 1n] })).toBe(1n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChildBook', args: [1n, 10n, 0n] }))
		await expect(client.readContract({ ...target(), functionName: 'quoteMint', args: [3n, 100n, 1n] })).rejects.toThrow('Settlement in runoff')
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'sealForFork', args: [3n, 1] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChildBook', args: [3n, 10n, 0n] }))
		await expect(client.readContract({ ...target(), functionName: 'quoteMint', args: [4n, 100n, 1n] })).rejects.toThrow('Settlement in runoff')
	})

	test('positive-fee purchases reject an index that cannot represent their cash APR accurately', async () => {
		const validationAbi = parseAbi(['function validateMintFeePrecision(uint64 bookId,uint256 questionId,uint256 cash,uint256 annualFeeBps) view'])
		const principal = 10n ** 18n
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createBook', args: [0] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'mint', args: [2n, 1n, principal, 0n, 0] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [2n, 1n, (principal - 2n) * scale, 1, 0] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freezeMatured', args: [2n, 1] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'redeem', args: [2n, 1n, principal - 1n, 0n, 1] }))
		expect(await client.readContract({ ...target(), functionName: 'scaledUnits', args: [2n] })).toBe(1n)
		expect((await client.readContract({ ...target(), functionName: 'totals', args: [2n] }))[0]).toBe(1n)
		const validate = (cash: bigint, annualBps = 1_000n) => client.readContract({ abi: validationAbi, address, functionName: 'validateMintFeePrecision', args: [2n, 100n, cash, annualBps] })
		await expect(validate(300_000_000n)).rejects.toThrow('Fee precision')
		await expect(validate(600_000_000n)).rejects.toThrow('Fee precision')
		await expect(validate(315_360_000n)).resolves.toBeUndefined()
		// #1773: an estimate is publishable only after this input-specific precision check.
		const quote = (cash: bigint) =>
			securityPoolMintForQuotedBudget(cash, cash, async amount => {
				await validate(amount)
				return 0n
			})
		await expect(quote(300_000_000n)).rejects.toThrow('Fee precision')
		await expect(quote(600_000_000n)).rejects.toThrow('Fee precision')
		await expect(quote(315_360_000n)).resolves.toEqual({ cash: 315_360_000n, fee: 0n })
		await expect(validate(300_000_000n, 0n)).resolves.toBeUndefined()
	})

	test('redemptions keep pending fee cash out of the claim price', async () => {
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createBook', args: [0] }))
		for (const question of [1n, 2n]) {
			await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'mint', args: [2n, question, 100n, 0n, 0] }))
			await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [2n, question, 300_000_000n, 100, 0] }))
		}
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'freezeMatured', args: [2n, 1] }))
		const request = { ...target(), functionName: 'redeem' as const, args: [2n, 1n, 100n, 0n, 1] as const }
		const first = (await client.simulateContract(request)).result[0]
		expect(first).toBe(99n)
		await writeContractAndWait(client, () => client.writeContract(request))
		const fundedAbi = parseAbi(['function isCashFunded(uint64 bookId) view returns(bool)'])
		expect(await client.readContract({ abi: fundedAbi, address, functionName: 'isCashFunded', args: [2n] })).toBe(true)
		const finalRequest = { ...target(), functionName: 'redeem' as const, args: [2n, 2n, 100n, 0n, 1] as const }
		const last = (await client.simulateContract(finalRequest)).result[0]
		await writeContractAndWait(client, () => client.writeContract(finalRequest))
		expect(first + last).toBe(200n)
		expect((await client.readContract({ ...target(), functionName: 'totals', args: [2n] })).slice(0, 3)).toEqual([0n, 0n, 0n])
	})
	test('the cash backing floor is converted to units at the current index', async () => {
		await mint(100n, 4n)
		const [question] = await client.readContract({ ...target(), functionName: 'scaledQuestion', args: [1n, 100n] })
		expect(question.units).toBe(400_000_000n)
		expect(await client.readContract({ ...target(), functionName: 'scaledAvailableFeeBudget', args: [1n, 100n] })).toBe(300_000_000n)
	})

	test('an emptied indexed child accepts a fresh deposit without becoming underfunded', async () => {
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'sealForFork', args: [1n, 1] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChildBook', args: [1n, 20n, 0n] }))
		for (let question = 1n; question <= 20n; question++) await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'redeem', args: [2n, question, 1n, 0n, 1] }))
		expect((await client.readContract({ ...target(), functionName: 'totals', args: [2n] })).slice(0, 2)).toEqual([0n, 0n])
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'mint', args: [2n, 100n, 4n, 0n, 1] }))
		const fundedAbi = parseAbi(['function isCashFunded(uint64 bookId) view returns(bool)'])
		expect(await client.readContract({ abi: fundedAbi, address, functionName: 'isCashFunded', args: [2n] })).toBe(true)
		expect(await client.readContract({ ...target(), functionName: 'quoteMint', args: [2n, 101n, 1n] })).toBe(1n)
	})
})
