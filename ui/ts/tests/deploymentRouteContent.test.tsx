/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { zeroAddress } from 'viem'
import { DeploymentRouteContent } from '../components/DeploymentRouteContent.js'
import type { DeploymentRouteContentProps } from '../types/components.js'
import type { DeploymentStatus } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createStep(id: DeploymentStatus['id'], label: string, deployed: boolean, dependencies: DeploymentStatus['id'][] = []): DeploymentStatus {
	return {
		address: zeroAddress,
		dependencies,
		deploy: async () => '0x0',
		deployed,
		id,
		label,
	}
}

function createProps(): DeploymentRouteContentProps {
	const deploymentStatuses: DeploymentStatus[] = [createStep('proxyDeployer', 'Proxy Deployer', true), createStep('deploymentStatusOracle', 'Deployment Status Oracle', true, ['proxyDeployer']), createStep('multicall3', 'Multicall3', true, ['proxyDeployer']), createStep('scalarOutcomes', 'Scalar Outcomes', false)]

	return {
		accountAddress: zeroAddress,
		busyStepId: undefined,
		deployNextMissingPending: false,
		deploymentSections: [
			{ title: 'Utilities', steps: deploymentStatuses.slice(0, 3) },
			{ title: 'Zoltar', steps: deploymentStatuses.slice(3) },
		],
		deploymentStatuses,
		isLoadingDeploymentStatuses: false,
		isMainnet: true,
		onDeploy: async () => undefined,
		onDeployNextMissing: () => undefined,
	}
}

describe('DeploymentRouteContent', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('shows deployment readiness and collapses completed groups by default', async () => {
		const renderedComponent = await renderIntoDocument(h(DeploymentRouteContent, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Deployment Readiness')).not.toBeNull()
		expect(documentQueries.getByText('Next: Scalar Outcomes')).not.toBeNull()

		const completedAccordion = Array.from(document.body.querySelectorAll('details')).find(detail => {
			const summaryText = detail.querySelector('summary')?.textContent
			return summaryText !== undefined && summaryText !== null && summaryText.includes('Utilities (Completed)')
		})
		if (completedAccordion === undefined) throw new Error('Expected completed deployment group accordion')
		expect(completedAccordion.hasAttribute('open')).toBe(false)
	})
})
