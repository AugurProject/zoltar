import { encodeDeployData, type Address, type Hex } from 'viem'
import { test, beforeEach, describe, setDefaultTimeout } from 'bun:test'
import assert from 'node:assert'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { addressString } from '../testsuite/simulator/utils/bigint'
import { setupTestAccounts, ensureProxyDeployerDeployed } from '../testsuite/simulator/utils/utilities'
import { ensureDeploymentStatusOracleDeployed, ensureInfraDeployed, getDeploymentStepAddresses, loadDeploymentStatusOracleMask } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import {
	DeploymentStatusOracle_DeploymentStatusOracle,
	ScalarOutcomes_ScalarOutcomes,
	peripherals_Multicall3_Multicall3,
	peripherals_SecurityPoolUtils_SecurityPoolUtils,
	peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	peripherals_openOracle_OpenOracle_OpenOracle,
} from '../types/contractArtifact'
import { strictEqualTypeSafe } from '../testsuite/simulator/utils/testUtils'
import { PROXY_DEPLOYER_ADDRESS } from '../testsuite/simulator/utils/constants'

setDefaultTimeout(TEST_TIMEOUT_MS)

const MULTICALL3_BYTECODE = `0x${peripherals_Multicall3_Multicall3.evm.bytecode.object}` satisfies Hex

function getDeploymentStatusOracleByteCode(deploymentAddresses: readonly Address[]): Hex {
	return encodeDeployData({
		abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
		bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
		args: [deploymentAddresses],
	})
}

describe('Deployment Status Oracle Test Suite', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient

	const deployViaProxy = async (bytecode: Hex) => {
		const hash = await client.sendTransaction({
			to: addressString(PROXY_DEPLOYER_ADDRESS),
			data: bytecode,
		})
		await client.waitForTransactionReceipt({ hash })
	}

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
	})

	test('deploys through the proxy deployer and reports the initial mask', async () => {
		await ensureDeploymentStatusOracleDeployed(client)

		const deploymentMask = await loadDeploymentStatusOracleMask(client)

		strictEqualTypeSafe(deploymentMask, 1n, 'only the proxy deployer should be deployed at bootstrap')
	})

	test('reports a mixed deployment mask after a subset of infra contracts is deployed', async () => {
		await ensureDeploymentStatusOracleDeployed(client)

		await deployViaProxy(MULTICALL3_BYTECODE)
		await deployViaProxy(`0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`)
		await deployViaProxy(`0x${peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`)

		const deploymentMask = await loadDeploymentStatusOracleMask(client)

		strictEqualTypeSafe(deploymentMask, 1n | (1n << 1n) | (1n << 3n) | (1n << 5n), 'oracle should report the deployed subset of infra contracts')
	})

	test('ensureInfraDeployed repairs an out-of-order partial deployment', async () => {
		await deployViaProxy(`0x${peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`)
		await deployViaProxy(`0x${peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`)
		await deployViaProxy(`0x${peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object}`)
		await deployViaProxy(`0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`)

		await ensureInfraDeployed(client)

		const deploymentMask = await loadDeploymentStatusOracleMask(client)

		strictEqualTypeSafe(deploymentMask, (1n << BigInt(getDeploymentStepAddresses().length)) - 1n, 'ensureInfraDeployed should complete the full deterministic deployment set')
	})

	test('rejects deployment status oracle constructor inputs that exceed the mask capacity', async () => {
		const tooManyAddresses = Array.from({ length: 257 }, (_, index) => addressString(BigInt(index + 1)))

		await assert.rejects(client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: getDeploymentStatusOracleByteCode(tooManyAddresses) }))
	})
})
