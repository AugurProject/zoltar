import { encodeDeployData, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { expect, test, beforeEach, describe } from 'bun:test'
import type { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { setupTestAccounts, ensureProxyDeployerDeployed } from '../testSupport/simulator/utils/utilities'
import { ensureDeploymentStatusOracleDeployed, ensureInfraDeployed, getDeploymentStepAddresses, getInfraContractAddresses, loadDeploymentStatusOracleMask } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { deployContract } from '../testSupport/deployContract'
import { DeploymentStatusOracle_DeploymentStatusOracle as oracle, statoblast_Multicall3_Multicall3, statoblast_SecurityPoolUtils_SecurityPoolUtils, statoblast_openOracle_OpenOracle_OpenOracle } from '../types/contractArtifact'
import { strictEqualTypeSafe } from '../testSupport/simulator/utils/testUtils'
import { PROXY_DEPLOYER_ADDRESS } from '../testSupport/simulator/utils/constants'

const MULTICALL3_BYTECODE = `0x${statoblast_Multicall3_Multicall3.evm.bytecode.object}` satisfies Hex

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
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
	})

	test('deploys through the proxy deployer and reports the initial mask', async () => {
		await ensureDeploymentStatusOracleDeployed(client)

		const deploymentMask = await loadDeploymentStatusOracleMask(client)

		strictEqualTypeSafe(deploymentMask, 1n, 'only the proxy deployer should be deployed at bootstrap')
	})

	test('deployment mask matches code presence at every index including duplicate addresses and bit 255', async () => {
		const deployed = addressString(PROXY_DEPLOYER_ADDRESS)
		for (const size of [0, 7, 256]) {
			const addresses = Array.from({ length: size }, (_, index) => (index % 7 === 0 || index === size - 1 ? deployed : client.account.address))
			const address = await deployContract(client, encodeDeployData({ abi: oracle.abi, bytecode: `0x${oracle.evm.bytecode.object}`, args: [addresses] }))
			const expected = addresses.reduce((bits, candidate, index) => (candidate === deployed ? bits | (1n << BigInt(index)) : bits), 0n)
			expect(await client.readContract({ abi: oracle.abi, address, functionName: 'getDeploymentMask' })).toBe(expected)
		}
	})
	test('reports a mixed deployment mask after a subset of infra contracts is deployed', async () => {
		await ensureDeploymentStatusOracleDeployed(client)

		await deployViaProxy(MULTICALL3_BYTECODE)
		await deployViaProxy(`0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`)

		const deploymentMask = await loadDeploymentStatusOracleMask(client)
		const infraContracts = getInfraContractAddresses()
		const stepAddresses = getDeploymentStepAddresses()
		const expectedMask = [addressString(PROXY_DEPLOYER_ADDRESS), infraContracts.multicall3, infraContracts.openOracle].reduce((mask, address) => {
			const bitIndex = stepAddresses.findIndex(stepAddress => stepAddress.toLowerCase() === address.toLowerCase())
			if (bitIndex < 0) throw new Error(`Deployed contract ${address} is missing from the deployment status registry`)
			return mask | (1n << BigInt(bitIndex))
		}, 0n)

		strictEqualTypeSafe(deploymentMask, expectedMask, 'oracle should report the deployed subset of infra contracts')
	})

	test('ensureInfraDeployed repairs an out-of-order partial deployment', async () => {
		await deployViaProxy(`0x${statoblast_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`)
		await deployViaProxy(`0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`)

		await ensureInfraDeployed(client)

		const deploymentMask = await loadDeploymentStatusOracleMask(client)

		strictEqualTypeSafe(deploymentMask, (1n << BigInt(getDeploymentStepAddresses().length)) - 1n, 'ensureInfraDeployed should complete the full deterministic deployment set')
	})
})
