/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { findNextDeployableStep, getDeploymentSections, getDeploymentStepAvailability, getDeployNextMissingAvailability, getPrerequisiteLabel } from '../../../features/deployment/lib/deployment.js'
import { createConnectedReadClient } from '../../../lib/clients.js'
import type { InjectedEthereum } from '../../../injectedEthereum.js'
import { getDeploymentSteps, getMulticall3Address, getOpenOracleAddress, loadDeploymentStatusOracleSnapshot, loadZoltarUniverseSummary } from '../../../protocol/index.js'
import { OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE } from '../../../protocol/deploymentHelpers.js'
import type { DeploymentStatus, ReadClient } from '../../../types/contracts.js'
import { AnvilWindowEthereum } from '../../../../../solidity/ts/testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../../../solidity/ts/testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient as SolidityWriteClient } from '../../../../../solidity/ts/testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../../../../solidity/ts/testSupport/simulator/utils/constants'
import {
	ORACLE_GAS_UNITS_FOR_ONE_DISPUTE as SIMULATOR_ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
	OPEN_ORACLE_SECURITY_MULTIPLIER_BPS as SIMULATOR_OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
	ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE as SIMULATOR_ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
} from '../../../../../solidity/ts/testSupport/simulator/utils/contracts/deployPeripherals'
import { ensureProxyDeployerDeployed, setupTestAccounts } from '../../../../../solidity/ts/testSupport/simulator/utils/utilities'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function installInjectedEthereum(mockWindow: AnvilWindowEthereum) {
	const globalWindow = globalThis as typeof globalThis & { window?: Window }
	if (globalWindow.window === undefined) globalWindow.window = globalThis as Window & typeof globalThis
	globalWindow.window.ethereum = mockWindow as InjectedEthereum
}

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
		installInjectedEthereum(mockWindow)
		readClient = createConnectedReadClient()
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

	void test('getDeployNextMissingAvailability disables when no wallet or wrong network is available', () => {
		const nextMissingStep = createStep('scalarOutcomes', false)

		expect(
			getDeployNextMissingAvailability({
				accountAddress: undefined,
				busyStepId: undefined,
				deployNextMissingPending: false,
				isMainnet: true,
				nextMissingStep,
			}),
		).toEqual({ disabled: true, reason: 'Connect wallet to continue.' })

		expect(
			getDeployNextMissingAvailability({
				accountAddress: zeroAddress,
				busyStepId: undefined,
				deployNextMissingPending: false,
				isMainnet: false,
				nextMissingStep,
			}),
		).toEqual({ disabled: true, reason: 'Switch to Ethereum mainnet.' })
	})

	void test('getDeploymentStepAvailability blocks undeployed steps behind prerequisites and allows ready steps', () => {
		const blockedStep = createStep('zoltar', false, ['scalarOutcomes'])
		expect(
			getDeploymentStepAvailability({
				accountAddress: zeroAddress,
				busyStepId: undefined,
				isMainnet: true,
				prerequisiteLabel: 'Scalar Outcomes',
				step: blockedStep,
			}),
		).toEqual({ disabled: true, reason: 'Requires Scalar Outcomes' })

		const readyStep = createStep('scalarOutcomes', false)
		expect(
			getDeploymentStepAvailability({
				accountAddress: zeroAddress,
				busyStepId: undefined,
				isMainnet: true,
				prerequisiteLabel: undefined,
				step: readyStep,
			}),
		).toEqual({ disabled: false, reason: undefined })
	})

	void test('getDeploymentSteps includes the deployment status oracle as a proxy deployer step', () => {
		const deploymentSteps = getDeploymentSteps()
		const deploymentStatusOracleStep = deploymentSteps.find(step => step.id === 'deploymentStatusOracle')

		expect(deploymentSteps.map(step => step.id)).toEqual([
			'proxyDeployer',
			'deploymentStatusOracle',
			'multicall3',
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

		expect(proxyDeployerSection?.steps.map(step => step.id)).toEqual(['proxyDeployer', 'deploymentStatusOracle', 'multicall3'])
	})

	void test('getOpenOracleAddress matches the deterministic OpenOracle deployment step', () => {
		const openOracleStep = getDeploymentSteps().find(step => step.id === 'openOracle')

		expect(openOracleStep?.address).toBe(getOpenOracleAddress())
	})

	void test('getMulticall3Address matches the deterministic Multicall3 deployment step', () => {
		const multicall3Step = getDeploymentSteps().find(step => step.id === 'multicall3')

		expect(multicall3Step?.address).toBe(getMulticall3Address())
	})

	void test('oracle dispute gas and profitability parameters match simulator deployment helpers', () => {
		expect(SIMULATOR_ORACLE_GAS_UNITS_FOR_ONE_DISPUTE).toBe(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE)
		expect(SIMULATOR_ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE).toBe(ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE)
		expect(SIMULATOR_OPEN_ORACLE_SECURITY_MULTIPLIER_BPS).toBe(OPEN_ORACLE_SECURITY_MULTIPLIER_BPS)
	})

	void test('loadDeploymentStatusOracleSnapshot returns the proxy deployer when the oracle is missing', async () => {
		const snapshot = await loadDeploymentStatusOracleSnapshot(readClient)

		expect(snapshot.augurPlaceHolderDeployed).toBe(false)
		expect(snapshot.deploymentStatuses.find(step => step.id === 'proxyDeployer')?.deployed).toBe(true)
		expect(snapshot.deploymentStatuses.find(step => step.id === 'deploymentStatusOracle')?.deployed).toBe(false)
	})

	void test('loadZoltarUniverseSummary returns undefined for an unknown universe id', async () => {
		let callCount = 0
		const mockReadClient = createConnectedReadClient()
		const multicall: ReadClient['multicall'] = async () => {
			callCount += 1
			return [zeroAddress, [0n, 0n, 0n, zeroAddress, 0n], 0n, 0n] as never
		}
		mockReadClient.multicall = multicall

		const universe = await loadZoltarUniverseSummary(mockReadClient, 123456789n)

		expect(universe).toBe(undefined)
		expect(callCount).toBe(1)
	})
})
