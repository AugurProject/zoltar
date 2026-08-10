import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { SEPOLIA_REP_ALLOCATIONS, SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY } from '@zoltar/shared/sepoliaRepAllocations'
import { encodeDeployData, type Address } from '@zoltar/shared/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { GenesisReputationToken_GenesisReputationToken, ReputationToken_ReputationToken } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('GenesisReputationToken', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
	})

	test('mints the configured Sepolia balances and fixes theoretical supply to their sum', async () => {
		const data = encodeDeployData({
			abi: GenesisReputationToken_GenesisReputationToken.abi,
			bytecode: `0x${GenesisReputationToken_GenesisReputationToken.evm.bytecode.object}`,
			args: [SEPOLIA_REP_ALLOCATIONS.map(allocation => allocation.address), SEPOLIA_REP_ALLOCATIONS.map(allocation => allocation.amount)],
		})
		const hash = await client.sendTransaction({ data })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const tokenAddress = receipt.contractAddress as Address | null | undefined
		if (tokenAddress === undefined || tokenAddress === null) throw new Error('Genesis REP deployment address missing')

		for (const allocation of SEPOLIA_REP_ALLOCATIONS) {
			const balance = await client.readContract({
				abi: GenesisReputationToken_GenesisReputationToken.abi,
				address: tokenAddress,
				functionName: 'balanceOf',
				args: [allocation.address],
			})
			assert.strictEqual(balance, allocation.amount, `unexpected Sepolia REP allocation for ${allocation.address}`)
		}

		const totalSupply = await client.readContract({
			abi: GenesisReputationToken_GenesisReputationToken.abi,
			address: tokenAddress,
			functionName: 'totalSupply',
			args: [],
		})
		const theoreticalSupply = await client.readContract({
			abi: GenesisReputationToken_GenesisReputationToken.abi,
			address: tokenAddress,
			functionName: 'getTotalTheoreticalSupplyAttoRep',
			args: [],
		})
		assert.strictEqual(totalSupply, SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY)
		assert.strictEqual(theoreticalSupply, SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY)
	})

	test('rejects missing, mismatched, zero-address, zero-balance, and duplicate allocations', async () => {
		const deploy = async (holders: readonly Address[], balances: readonly bigint[]) => {
			const data = encodeDeployData({
				abi: GenesisReputationToken_GenesisReputationToken.abi,
				bytecode: `0x${GenesisReputationToken_GenesisReputationToken.evm.bytecode.object}`,
				args: [holders, balances],
			})
			return await client.sendTransaction({ data })
		}

		await assert.rejects(deploy([], []), /at least one initial holder|reverted/i)
		await assert.rejects(deploy([client.account.address], []), /holder and balance counts|reverted/i)
		await assert.rejects(deploy(['0x0000000000000000000000000000000000000000'], [1n]), /zero address|reverted/i)
		await assert.rejects(deploy([client.account.address], [0n]), /balance must be non-zero|reverted/i)
		await assert.rejects(deploy([client.account.address, client.account.address], [1n, 2n]), /holders must be unique|reverted/i)
		await assert.rejects(deploy([client.account.address], [11_000_000n * 10n ** 18n + 1n]), /exceeds maximum supply|reverted/i)
	})

	test('rejects a child theoretical supply above the protocol REP maximum', async () => {
		const data = encodeDeployData({
			abi: ReputationToken_ReputationToken.abi,
			bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
			args: [client.account.address],
		})
		const hash = await client.sendTransaction({ data })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const tokenAddress = receipt.contractAddress as Address | null | undefined
		if (tokenAddress === undefined || tokenAddress === null) throw new Error('Child REP deployment address missing')

		await assert.rejects(
			client.writeContract({
				abi: ReputationToken_ReputationToken.abi,
				address: tokenAddress,
				functionName: 'setMaxTheoreticalSupplyAttoRep',
				args: [11_000_000n * 10n ** 18n + 1n],
			}),
			/exceeds maximum REP|reverted/i,
		)
	})
})
