/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { zeroAddress, zeroHash } from '@zoltar/shared/ethereum'
import { getStatoblastDeploymentSections } from '../../../features/deployment/deploymentSections.js'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'

function createStep(id: DeploymentStatus['id']): DeploymentStatus {
	return {
		address: zeroAddress,
		dependencies: [],
		deploy: async () => zeroHash,
		deployed: false,
		id,
		label: id,
	}
}

describe('getStatoblastDeploymentSections', () => {
	test('adds Statoblast contracts without teaching Zoltar about them', () => {
		const sections = getStatoblastDeploymentSections([createStep('proxyDeployer'), createStep('zoltar'), createStep('openOracle'), createStep('securityPoolFactory')])

		expect(sections.map(section => section.title)).toEqual(['Utilities', 'Zoltar', 'Security Pools'])
		expect(sections.at(-1)?.steps.map(step => step.id)).toEqual(['openOracle', 'securityPoolFactory'])
	})
})
