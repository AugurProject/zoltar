/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { DeploymentRouteContent } from '../../../features/deployment/components/DeploymentRouteContent.js'
import type { DeploymentRouteContentProps } from '../../../features/types.js'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'

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
		deploymentStateReady: true,
		deploymentStatusError: undefined,
		deployNextMissingPending: false,
		deploymentSections: [
			{ title: 'Utilities', steps: deploymentStatuses.slice(0, 3) },
			{ title: 'Zoltar', steps: deploymentStatuses.slice(3) },
		],
		deploymentStatuses,
		isLoadingDeploymentStatuses: false,
		isOnActiveAppChain: true,
		onDeploy: async () => undefined,
		onDeployNextMissing: () => undefined,
		onRetryDeploymentStatus: () => undefined,
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

	test('shows current deployment guidance and progressively discloses all contracts', async () => {
		const renderedComponent = await renderIntoDocument(h(DeploymentRouteContent, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Deployment Readiness')).toBeNull()
		expect(documentQueries.getAllByText('Next deployable').length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('Scalar Outcomes').length).toBeGreaterThan(0)
		expect(document.body.querySelector('.route-header.deployment-route-header')).not.toBeNull()

		const allContractsDisclosure = document.body.querySelector('.deployment-contract-details')
		if (!(allContractsDisclosure instanceof HTMLElement) || allContractsDisclosure.tagName !== 'DETAILS') throw new Error('Expected all-contracts disclosure')
		expect(allContractsDisclosure.hasAttribute('open')).toBe(false)
		expect(allContractsDisclosure.querySelector('summary')?.textContent).toContain('All contracts')
		expect(allContractsDisclosure.querySelector('summary')?.textContent).not.toContain('3 of 4 deployed')
		expect(documentQueries.getByText('3 / 4')).not.toBeNull()
		expect(within(allContractsDisclosure).getByText('Proxy Deployer')).not.toBeNull()
		expect(document.body.querySelector('.section-block.default .section-block.default')).toBeNull()
		expect(document.body.querySelector('.deployment-contract-details .contract-panel.plain')).not.toBeNull()
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

		expectTransactionButtonDisabled(document.body, 'Deploy next missing', 'Connect wallet to continue.')
		expectTransactionButtonDisabled(document.body, 'Deploy Scalar Outcomes', 'Connect wallet to deploy this contract.')
	})

	test('enables deploy-next when a deterministic step is ready to deploy', async () => {
		const renderedComponent = await renderIntoDocument(h(DeploymentRouteContent, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Deploy next missing')
	})

	test('disables all deployment actions while the deployment snapshot is unavailable', async () => {
		const renderedComponent = await renderIntoDocument(
			h(DeploymentRouteContent, {
				...createProps(),
				deploymentStateReady: false,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Deploy next missing', 'Deployment status is unavailable.')
		expectTransactionButtonDisabled(document.body, 'Deploy Scalar Outcomes', 'Deployment status is unavailable.')
		expect(document.body.textContent).not.toContain('Not Deployed')
		expect(document.body.textContent).not.toContain('Can deploy now.')
		expect(document.body.textContent).not.toContain('Requires ')
		expect(document.body.textContent).toContain('Unavailable')
		expect(document.body.textContent).not.toContain('Loading deployment status…')
		const scalarDeployButton = within(document.body).getByRole('button', { name: 'Deploy Scalar Outcomes' })
		const describedById = scalarDeployButton.getAttribute('aria-describedby')
		if (describedById === null) throw new Error('Expected unavailable deployment action to reference the shared recovery reason')
		expect(document.getElementById(describedById)?.textContent).toBe('Deployment status is unavailable.')
	})

	test('shows a completed deployment load failure with retry instead of a loading state', async () => {
		let retryCalls = 0
		const renderedComponent = await renderIntoDocument(
			h(DeploymentRouteContent, {
				...createProps(),
				deploymentStateReady: false,
				deploymentStatusError: 'Deployment RPC unavailable',
				onRetryDeploymentStatus: () => {
					retryCalls += 1
				},
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('alert').textContent).toContain('Deployment RPC unavailable')
		expect(document.body.textContent).not.toContain('Loading deployment status…')
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
		expect(retryCalls).toBe(1)
	})

	test('replaces deployment controls with a clear next destination when setup is complete', async () => {
		window.location.hash = '#/deploy?simulate=1&simScenario=deployed&simState=slow&universe=7'
		const props = createProps()
		const deploymentStatuses = props.deploymentStatuses.map(step => ({ ...step, deployed: true }))
		const renderedComponent = await renderIntoDocument(
			h(DeploymentRouteContent, {
				...props,
				deploymentStatuses,
				deploymentSections: [
					{ title: 'Utilities', steps: deploymentStatuses.slice(0, 3) },
					{ title: 'Zoltar', steps: deploymentStatuses.slice(3) },
				],
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Deploy next missing' })).toBeNull()
		const nextStep = documentQueries.getByRole('link', { name: 'Browse questions' })
		expect(nextStep.getAttribute('href')).toBe('#/zoltar?simulate=1&simScenario=deployed&simState=slow&universe=7&zoltarView=questions')
	})
})
