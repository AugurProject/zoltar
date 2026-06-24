import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testsuite/simulator/utils/assert'
import { encodeDeployData, encodeFunctionData, type Address, type Hex } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { setupTestAccounts } from '../testsuite/simulator/utils/utilities'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testsuite/simulator/utils/viem'
import {
	DeploymentStatusOracle_DeploymentStatusOracle,
	ReputationToken_ReputationToken,
	test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness,
	test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness,
} from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const SCALAR_DECIMALS = 18n
const MAX_INT256 = 2n ** 255n - 1n
const MIN_INT256 = -(2n ** 255n)

const bytes32 = (value: bigint): Hex => `0x${value.toString(16).padStart(64, '0')}` as Hex

describe('Solidity bytecode coverage helpers', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let participantClient: WriteClient

	const deployContract = async (deploymentData: Hex): Promise<Address> => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
	}

	const transact = async (to: Address, data: Hex) => {
		await writeContractAndWait(client, () => client.sendTransaction({ to, data }))
	}

	const deployCoverageHelper = async () =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
				bytecode: `0x${test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.evm.bytecode.object}`,
			}),
		)

	const deployErc1155CoverageHelper = async () =>
		await deployContract(
			encodeDeployData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				bytecode: `0x${test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.evm.bytecode.object}`,
			}),
		)

	const deployReputationToken = async () =>
		await deployContract(
			encodeDeployData({
				abi: ReputationToken_ReputationToken.abi,
				bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
				args: [client.account.address],
			}),
		)

	const deployDeploymentStatusOracle = async (deploymentAddresses: readonly Address[]) =>
		await deployContract(
			encodeDeployData({
				abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
				bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
				args: [deploymentAddresses],
			}),
		)

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		participantClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await setupTestAccounts(mockWindow)
	})

	test('traces deployment status, ERC20 metadata, and safe ERC20 success paths through transactions', async () => {
		const helperAddress = await deployCoverageHelper()
		const reputationTokenAddress = await deployReputationToken()
		const deploymentStatusOracleAddress = await deployDeploymentStatusOracle([client.account.address, reputationTokenAddress])

		await transact(
			deploymentStatusOracleAddress,
			encodeFunctionData({
				abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
				functionName: 'getDeploymentMask',
			}),
		)
		assert.strictEqual(
			await client.readContract({
				abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
				address: deploymentStatusOracleAddress,
				functionName: 'getDeploymentMask',
			}),
			2n,
			'only the deployed contract address should be set in the mask',
		)

		await transact(reputationTokenAddress, encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'name' }))
		await transact(reputationTokenAddress, encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'symbol' }))
		await transact(reputationTokenAddress, encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'decimals' }))
		await transact(reputationTokenAddress, encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'totalSupply' }))
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'balanceOf',
				args: [client.account.address],
			}),
		)

		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'setMaxTheoreticalSupply',
				args: [100n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'mint',
				args: [helperAddress, 20n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'mint',
				args: [client.account.address, 30n],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
				functionName: 'safeApproveToken',
				args: [reputationTokenAddress, participantClient.account.address, 7n],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
				functionName: 'safeTransferToken',
				args: [reputationTokenAddress, participantClient.account.address, 5n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'approve',
				args: [helperAddress, 9n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'allowance',
				args: [client.account.address, helperAddress],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi,
				functionName: 'safeTransferFromToken',
				args: [reputationTokenAddress, client.account.address, participantClient.account.address, 9n],
			}),
		)
		await transact(
			reputationTokenAddress,
			encodeFunctionData({
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'burn',
				args: [client.account.address, 1n],
			}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: ReputationToken_ReputationToken.abi,
				address: reputationTokenAddress,
				functionName: 'allowance',
				args: [helperAddress, participantClient.account.address],
			}),
			7n,
			'safeApprove should set an allowance owned by the helper',
		)
		assert.strictEqual(
			await client.readContract({
				abi: ReputationToken_ReputationToken.abi,
				address: reputationTokenAddress,
				functionName: 'balanceOf',
				args: [participantClient.account.address],
			}),
			14n,
			'safe transfers should deliver REP to the recipient',
		)
	})

	test('traces ERC1155 legacy helper overloads and internal mint, transfer, and burn paths', async () => {
		const tokenAddress = await deployErc1155CoverageHelper()

		await transact(tokenAddress, encodeFunctionData({ abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi, functionName: 'supportsInterface', args: ['0xd9b67a26'] }))
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'mintOne',
				args: [client.account.address, 1n, 5n],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'mintMany',
				args: [client.account.address, [2n, 3n], [7n, 11n]],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'balanceOfBatch',
				args: [
					[client.account.address, client.account.address, client.account.address],
					[1n, 2n, 3n],
				],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'setApprovalForAll',
				args: [participantClient.account.address, true],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'isApprovedForAll',
				args: [client.account.address, participantClient.account.address],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'transferWithLegacyHelper',
				args: [client.account.address, participantClient.account.address, 1n, 2n],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'internalTransferWithLegacyHelper',
				args: [participantClient.account.address, client.account.address, 1n, 1n],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'batchTransferWithLegacyHelper',
				args: [client.account.address, participantClient.account.address, [2n, 3n], [2n, 3n]],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'internalBatchTransferWithLegacyHelper',
				args: [participantClient.account.address, client.account.address, [2n, 3n], [1n, 1n]],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'batchTransferWithLegacyHelper',
				args: [client.account.address, participantClient.account.address, [], []],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'burnOne',
				args: [client.account.address, 1n, 1n],
			}),
		)
		await transact(
			tokenAddress,
			encodeFunctionData({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				functionName: 'burnMany',
				args: [client.account.address, [2n, 3n], [1n, 1n]],
			}),
		)

		assert.strictEqual(
			await client.readContract({
				abi: test_peripherals_CoverageHelpersHarness_ERC1155CoverageHarness.abi,
				address: tokenAddress,
				functionName: 'totalSupply',
				args: [1n],
			}),
			4n,
			'single burn should reduce token supply',
		)
	})

	test('traces pure production libraries through transaction-backed harness calls', async () => {
		const helperAddress = await deployCoverageHelper()
		const helperAbi = test_peripherals_CoverageHelpersHarness_CoverageHelpersHarness.abi
		const siblingHashes = Array.from({ length: 64 }, (_, index) => bytes32(BigInt(index + 1)))

		assert.strictEqual(
			await client.readContract({
				abi: helperAbi,
				address: helperAddress,
				functionName: 'getTokenId',
				args: [7n, 1],
			}),
			(7n << 8n) | 1n,
			'token ids should pack universe and outcome',
		)

		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'getTokenId', args: [7n, 1] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'getTokenIds', args: [7n, [0, 1, 2]] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'unpackTokenId', args: [(7n << 8n) | 1n] }))
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'hashLeaf',
				args: [client.account.address, 1, 11n, 22n, 33n, 44n],
			}),
		)
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'hashParent', args: [bytes32(1n), bytes32(2n)] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'bagPeaks', args: [[], 0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'bagPeaks', args: [[bytes32(1n), bytes32(2n), bytes32(3n)], 3n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'computeEmptyNullifierRoot' }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'getCurrentCarryPeakForLeaf', args: [3n, 0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'getCurrentCarryPeakForLeaf', args: [3n, 2n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'bagCarryPeakSamples', args: [ZERO_BYTES32, bytes32(2n), 0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'bagCarryPeakSamples', args: [bytes32(1n), bytes32(2n), 3n] }))
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'computeMerkleMountainRangeRootFromProof',
				args: [bytes32(10n), 3n, 0n, 1n, [bytes32(11n), bytes32(12n)]],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'computeMerkleMountainRangeRootFromProof',
				args: [bytes32(10n), 3n, 1n, 1n, [bytes32(11n), bytes32(12n)]],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'computeNullifierRoot',
				args: [5n, siblingHashes, bytes32(99n)],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'getScalarOutcomeName',
				args: [[0n, 1000n], '', 1000n, -500n * 10n ** SCALAR_DECIMALS, 500n * 10n ** SCALAR_DECIMALS],
			}),
		)
		await transact(
			helperAddress,
			encodeFunctionData({
				abi: helperAbi,
				functionName: 'getScalarOutcomeName',
				args: [[500n, 500n], 'km', 1000n, -500n * 10n ** SCALAR_DECIMALS, 500n * 10n ** SCALAR_DECIMALS],
			}),
		)
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'addInt256Uint256', args: [5n, 7n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'addInt256Uint256', args: [-5n, 7n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'addInt256Uint256', args: [-7n, 5n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'addInt256Uint256', args: [MIN_INT256, 0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'absoluteInt256', args: [5n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'absoluteInt256', args: [-5n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'mulDiv', args: [6n, 7n, 3n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'mulDiv', args: [2n ** 200n, 2n ** 80n, 2n ** 100n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'intToDecimalString', args: [-1234000000000000000n, 18n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'intToDecimalString', args: [42n * 10n ** SCALAR_DECIMALS, 18n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'zeroPadLeft', args: ['7', 3n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'zeroPadLeft', args: ['1234', 3n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'uintToString', args: [0n] }))
		await transact(helperAddress, encodeFunctionData({ abi: helperAbi, functionName: 'uintToString', args: [12345n] }))

		assert.strictEqual(
			await client.readContract({
				abi: helperAbi,
				address: helperAddress,
				functionName: 'addInt256Uint256',
				args: [MAX_INT256, 0n],
			}),
			MAX_INT256,
			'scalar arithmetic wrapper should preserve max int when adding zero',
		)
	})
})
