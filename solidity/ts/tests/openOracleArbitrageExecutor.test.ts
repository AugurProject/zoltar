import { encodeDeployData, getAddress, type Address } from '@zoltar/shared/ethereum'
import { beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { ensureDefined } from '../testSupport/simulator/utils/testUtils'
import {
	peripherals_OpenOracleArbitrageExecutor_OpenOracleArbitrageExecutor as executorArtifact,
	test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleArbitrageExecutorTarget as targetArtifact,
	test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleFeeToken as feeTokenArtifact,
	test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken as tokenArtifact,
} from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

describe('OpenOracle arbitrage executor', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let executor: Address
	let target: Address

	const deploy = async (artifact: typeof executorArtifact | typeof targetArtifact | typeof tokenArtifact | typeof feeTokenArtifact, args: readonly unknown[] = []) => {
		const hash = await client.sendTransaction({
			data: encodeDeployData({
				abi: artifact.abi,
				args,
				bytecode: `0x${artifact.evm.bytecode.object}`,
			}),
		})
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === null || receipt.contractAddress === undefined) throw new Error('deployment address missing')
		return receipt.contractAddress
	}

	const game = (token1: Address, token2: Address) => ({
		callbackContract: getAddress('0x0000000000000000000000000000000000000000'),
		callbackGasLimit: 0,
		currentAmount1: 1_000n,
		currentAmount2: 1_000n,
		currentReporter: getAddress('0x0000000000000000000000000000000000000001'),
		disputeDelay: 0,
		escalationHalt: 10_000n,
		feePercentage: 0,
		flags: 0,
		lastReportOppoTime: 0,
		multiplier: 120,
		numReports: 0,
		protocolFee: 0,
		protocolFeeRecipient: getAddress('0x0000000000000000000000000000000000000000'),
		reportTimestamp: 1,
		settlementTime: 100,
		settlementTimestamp: 0,
		settlerReward: 0n,
		token1,
		token2,
	})

	const helper = () => ({
		blockNumber: 1n,
		blockTimestamp: 1n,
		creator: client.account.address,
		reportId: 1n,
	})

	const timing = {
		blockNumber: 0n,
		blockNumberBound: 0n,
		blockTimestamp: 0n,
		blockTimestampBound: 0n,
	}

	beforeAll(async () => {
		const window = getAnvilWindowEthereum()
		await setupTestAccounts(window)
		client = createWriteClient(window, ensureDefined(TEST_ADDRESSES[0], 'test account missing'), 0)
		executor = await deploy(executorArtifact)
		target = await deploy(targetArtifact)
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		const window = getAnvilWindowEthereum()
		client = createWriteClient(window, ensureDefined(TEST_ADDRESSES[0], 'test account missing'), 0)
	})

	test('funds a vanilla-token dispute atomically and retains no operation-pulled token or allowance', async () => {
		const token1 = await deploy(tokenArtifact, ['Token 1', 'TK1'])
		const token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token2, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'approve', args: [executor, 2_200n] }))
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'dispute',
				args: [target, 1_200n, 900n, game(token1, token2), helper(), timing],
			}),
		)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [executor] })).toBe(0n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'allowance', args: [executor, target] })).toBe(0n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [target] })).toBe(2_200n)
	})

	test('preserves an unsolicited balance that has no withdrawal path', async () => {
		const token1 = await deploy(tokenArtifact, ['Token 1', 'TK1'])
		const token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'mint', args: [client.account.address, 10_100n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'transfer', args: [executor, 100n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token1, functionName: 'approve', args: [executor, 2_200n] }))
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: executorArtifact.abi,
				address: executor,
				functionName: 'dispute',
				args: [target, 1_200n, 900n, game(token1, token2), helper(), timing],
			}),
		)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [executor] })).toBe(100n)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [target] })).toBe(2_200n)
	})

	test('reverts the complete execution when a token charges a transfer fee', async () => {
		const token1 = await deploy(feeTokenArtifact, [100n])
		const token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		await writeContractAndWait(client, () => client.writeContract({ abi: feeTokenArtifact.abi, address: token1, functionName: 'mint', args: [client.account.address, 10_000n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: feeTokenArtifact.abi, address: token1, functionName: 'approve', args: [executor, 2_200n] }))
		await expect(
			client.simulateContract({
				abi: executorArtifact.abi,
				address: executor,
				account: client.account,
				functionName: 'dispute',
				args: [target, 1_200n, 900n, game(token1, token2), helper(), timing],
			}),
		).rejects.toThrow('Token transfer to executor was not exact')
		expect(await client.readContract({ abi: feeTokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [executor] })).toBe(0n)
		expect(await client.readContract({ abi: feeTokenArtifact.abi, address: token1, functionName: 'balanceOf', args: [target] })).toBe(0n)
	})
})
