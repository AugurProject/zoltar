/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { createPublicClient, custom, publicActions } from 'viem'
import { mainnet } from 'viem/chains'
import { zeroAddress } from 'viem'
import { findNextDeployableStep, getDeploymentSections, getPrerequisiteLabel } from '../lib/deployment.js'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadZoltarUniverseSummary } from '../contracts.js'
import type { DeploymentStatus, ReadClient } from '../types/contracts.js'
import { AnvilWindowEthereum } from '../../../solidity/ts/testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../solidity/ts/testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient as SolidityWriteClient } from '../../../solidity/ts/testsuite/simulator/utils/viem'
import { TEST_ADDRESSES } from '../../../solidity/ts/testsuite/simulator/utils/constants'
import { ensureProxyDeployerDeployed, setupTestAccounts } from '../../../solidity/ts/testsuite/simulator/utils/utilities'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

setDefaultTimeout(TEST_TIMEOUT_MS)

function createStep(id: DeploymentStatus['id'], deployed: boolean, dependencies: DeploymentStatus['id'][] = []) {
	return {
		address: ZERO_ADDRESS,
		dependencies,
		deploy: async () => '0x0',
		deployed,
		id,
		label: id,
	} satisfies DeploymentStatus
}

const { getAnvilWindowEthereum } = useIsolatedAnvilNode()

void describe('deployment helpers', () => {
	let mockWindow: AnvilWindowEthereum
	let writeClient: SolidityWriteClient
	let readClient: ReadClient

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		writeClient = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		readClient = createPublicClient({
			chain: mainnet,
			transport: custom(mockWindow),
		}).extend(publicActions)
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(writeClient)
	})

	void test('getPrerequisiteLabel reports missing dependency ids', () => {
		const steps = [createStep('proxyDeployer', true), createStep('zoltar', false, ['securityPoolFactory'])]

		expect(getPrerequisiteLabel(steps, 1)).toBe('securityPoolFactory')
	})

	void test('findNextDeployableStep blocks steps with missing dependency ids', () => {
		const steps = [createStep('zoltar', false, ['securityPoolFactory'])]

		expect(findNextDeployableStep(steps)).toBe(undefined)
	})

	void test('getDeploymentSteps includes the deployment status oracle as a proxy deployer step', () => {
		const deploymentSteps = getDeploymentSteps()
		const deploymentStatusOracleStep = deploymentSteps.find(step => step.id === 'deploymentStatusOracle')

		expect(deploymentSteps.map(step => step.id)).toEqual([
			'proxyDeployer',
			'deploymentStatusOracle',
			'uniformPriceDualCapBatchAuctionFactory',
			'scalarOutcomes',
			'securityPoolUtils',
			'openOracle',
			'zoltarQuestionData',
			'zoltar',
			'shareTokenFactory',
			'priceOracleManagerAndOperatorQueuerFactory',
			'securityPoolForker',
			'escalationGameFactory',
			'securityPoolFactory',
		])
		expect(deploymentStatusOracleStep?.dependencies).toEqual(['proxyDeployer'])
		expect(deploymentStatusOracleStep?.label).toBe('Deployment Status Oracle')
	})

	void test('getDeploymentSections groups the deployment status oracle with proxy deployer', () => {
		const deploymentStatuses = getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		}))
		const sections = getDeploymentSections(deploymentStatuses)
		const proxyDeployerSection = sections.find(section => section.title === 'Utilities')

		expect(proxyDeployerSection?.steps.map(step => step.id)).toEqual(['proxyDeployer', 'deploymentStatusOracle'])
	})

	void test('loadZoltarUniverseSummary skips the Zoltar code probe when deployment status is already known', async () => {
		const mockReadClient = {
			getCode: async () => {
				throw new Error('getCode should not be called when the deployment status is already known')
			},
			readContract: async ({ functionName }: { functionName: string }) => {
				expect(functionName).toBe('getRepToken')
				return zeroAddress
			},
		} as unknown as ReadClient

		const universe = await loadZoltarUniverseSummary(mockReadClient, 0n, true)

		expect(universe).toBe(undefined)
	})

	void test('loadDeploymentStatusOracleSnapshot returns the proxy deployer when the oracle is missing', async () => {
		const snapshot = await loadDeploymentStatusOracleSnapshot(readClient)

		expect(snapshot.augurPlaceHolderDeployed).toBe(false)
		expect(snapshot.deploymentStatuses.find(step => step.id === 'proxyDeployer')?.deployed).toBe(true)
		expect(snapshot.deploymentStatuses.find(step => step.id === 'deploymentStatusOracle')?.deployed).toBe(false)
	})

	void test('loadZoltarUniverseSummary returns undefined for an unknown universe id', async () => {
		let callCount = 0
		const mockReadClient = {
			getCode: async () => '0x1234',
			readContract: async ({ functionName }: { functionName: string }) => {
				callCount += 1
				expect(functionName).toBe('getRepToken')
				return zeroAddress
			},
		} as unknown as ReadClient

		const universe = await loadZoltarUniverseSummary(mockReadClient, 123456789n)

		expect(universe).toBe(undefined)
		expect(callCount).toBe(1)
	})

	void test('loadZoltarUniverseSummary falls back to getCode when reading Zoltar state fails', async () => {
		let getCodeCallCount = 0
		let readContractCallCount = 0
		const mockReadClient = {
			getCode: async () => {
				getCodeCallCount += 1
				return undefined
			},
			readContract: async () => {
				readContractCallCount += 1
				throw new Error('readContract failed because Zoltar is missing')
			},
		} as unknown as ReadClient

		const universe = await loadZoltarUniverseSummary(mockReadClient, 0n)

		expect(universe).toBe(undefined)
		expect(getCodeCallCount).toBe(1)
		expect(readContractCallCount).toBe(1)
	})
})
