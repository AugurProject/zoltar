/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { findNextDeployableStep, getPrerequisiteLabel } from '../lib/deployment.js'
import { getDeploymentSteps, loadZoltarDeploymentStatus, loadZoltarUniverseSummary } from '../contracts.js'
import type { DeploymentStatus, ReadClient } from '../types/contracts.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

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

void describe('deployment helpers', () => {
	void test('getPrerequisiteLabel reports missing dependency ids', () => {
		const steps = [createStep('proxyDeployer', true), createStep('zoltar', false, ['securityPoolFactory'])]

		expect(getPrerequisiteLabel(steps, 1)).toBe('securityPoolFactory')
	})

	void test('findNextDeployableStep blocks steps with missing dependency ids', () => {
		const steps = [createStep('zoltar', false, ['securityPoolFactory'])]

		expect(findNextDeployableStep(steps)).toBe(undefined)
	})

	void test('loadZoltarDeploymentStatus checks only the Zoltar contract', async () => {
		const zoltarAddress = getDeploymentSteps().find(step => step.id === 'zoltar')?.address
		if (zoltarAddress === undefined) throw new Error('Missing Zoltar deployment address')

		let callCount = 0
		const deployed = await loadZoltarDeploymentStatus({
			getCode: async ({ address }) => {
				callCount += 1
				expect(address).toBe(zoltarAddress)
				return '0x1234'
			},
		})

		expect(deployed).toBe(true)
		expect(callCount).toBe(1)
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

	void test('loadZoltarUniverseSummary returns undefined when the Zoltar contract is not deployed', async () => {
		let getCodeCallCount = 0
		let readContractCallCount = 0
		const mockReadClient = {
			getCode: async () => {
				getCodeCallCount += 1
				return undefined
			},
			readContract: async () => {
				readContractCallCount += 1
				throw new Error('readContract should not be called when Zoltar is missing')
			},
		} as unknown as ReadClient

		const universe = await loadZoltarUniverseSummary(mockReadClient, 0n)

		expect(universe).toBe(undefined)
		expect(getCodeCallCount).toBe(1)
		expect(readContractCallCount).toBe(0)
	})
})
