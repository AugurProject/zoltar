/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '../../testUtils/queries'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { DeploymentRouteContent } from '../../../features/deployment/components/DeploymentRouteContent.js'
import type { DeploymentRouteContentProps } from '../../../features/types.js'
import type { DeploymentStatus } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '../../testUtils/transactionActionButton.js'

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

	test('shows deployment summary and collapses completed groups by default', async () => {
		const renderedComponent = await renderIntoDocument(h(DeploymentRouteContent, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Deployment Readiness')).toBeNull()
		expect(documentQueries.getAllByText('Next deployable').length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('Scalar Outcomes').length).toBeGreaterThan(0)

		const completedAccordion = Array.from(document.body.querySelectorAll('details')).find(detail => {
			const summaryText = detail.querySelector('summary')?.textContent
			return summaryText !== undefined && summaryText !== null && summaryText.includes('Utilities (Completed)')
		})
		if (completedAccordion === undefined) throw new Error('Expected completed deployment group accordion')
		expect(completedAccordion.hasAttribute('open')).toBe(false)
		expect(within(completedAccordion).queryByRole('heading', { name: 'Utilities' })).toBeNull()
		expect(within(completedAccordion).queryByText('Deployed')).toBeNull()
		expect(within(completedAccordion).getByText('Proxy Deployer')).not.toBeNull()
	})

	test('disables deploy-next and blocked per-step actions until prerequisites are satisfied', async () => {
		const renderedComponent = await renderIntoDocument(
			h(DeploymentRouteContent, {
				...createProps(),
				accountAddress: undefined,
				deploymentStatuses: [createStep('proxyDeployer', 'Proxy Deployer', true), createStep('scalarOutcomes', 'Scalar Outcomes', false, ['deploymentStatusOracle'])],
				deploymentSections: [{ title: 'Zoltar', steps: [createStep('scalarOutcomes', 'Scalar Outcomes', false, ['deploymentStatusOracle'])] }],
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Deploy Next Missing', 'Connect wallet to continue.')
		expectTransactionButtonDisabled(document.body, 'Deploy', 'Connect wallet to deploy this contract.')
	})

	test('enables deploy-next when a deterministic step is ready to deploy', async () => {
		const renderedComponent = await renderIntoDocument(h(DeploymentRouteContent, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Deploy Next Missing')
	})
})
