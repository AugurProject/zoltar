import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { findNextDeployableStep, getPrerequisiteLabel } from '../lib/deployment.js'
import type { DeploymentStatus } from '../types/contracts.js'

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

		assert.equal(getPrerequisiteLabel(steps, 1), 'securityPoolFactory')
	})

	void test('findNextDeployableStep blocks steps with missing dependency ids', () => {
		const steps = [createStep('zoltar', false, ['securityPoolFactory'])]

		assert.equal(findNextDeployableStep(steps), undefined)
	})
})
