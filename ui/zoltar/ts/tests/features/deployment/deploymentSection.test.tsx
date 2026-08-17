/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { DeploymentSection } from '../../../features/deployment/components/DeploymentSection.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '../../testUtils/transactionActionButton.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

function createDeploymentStep(props: { id: DeploymentStatus['id']; deployed: boolean; dependencies?: DeploymentStatus['id'][]; label?: string }) {
	const hash = props.id === 'proxyDeployer' ? ZERO_HASH : ('0x1234' as `0x${string}`)

	return {
		address: zeroAddress,
		dependencies: props.dependencies ?? [],
		deploy: async () => hash,
		deployed: props.deployed,
		id: props.id,
		label: props.label ?? props.id,
	}
}

describe('DeploymentSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('marks already deployed steps once without redundant detail or action', async () => {
		let onDeployCalls = 0
		const deploymentStep = createDeploymentStep({ id: 'proxyDeployer', deployed: true, label: 'Proxy Deployer' })
		const rendered = await renderIntoDocument(
			<DeploymentSection
				title='Deployment'
				steps={[deploymentStep]}
				allSteps={[deploymentStep]}
				accountAddress={zeroAddress}
				busyStepId={undefined}
				deploymentStateReady={true}
				isOnActiveAppChain={true}
				onDeploy={async () => {
					onDeployCalls += 1
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup

		expect(rendered.container.querySelector('span.badge')?.textContent).toBe('Deployed')
		expect(rendered.container.textContent).not.toContain('Code found at expected address.')
		expect(rendered.container.querySelector('button')).toBeNull()
		expect(onDeployCalls).toBe(0)
	})

	test('shows deployment progress for busy steps', async () => {
		const deploymentStep = createDeploymentStep({ id: 'multicall3', deployed: false, dependencies: [] })
		const rendered = await renderIntoDocument(<DeploymentSection title='Deployment' steps={[deploymentStep]} allSteps={[deploymentStep]} accountAddress={zeroAddress} busyStepId='multicall3' deploymentStateReady={true} isOnActiveAppChain={true} onDeploy={async () => undefined} />)
		cleanupRendered = rendered.cleanup

		expect(rendered.container.textContent).toContain('Deployment in progress.')
		expectTransactionButtonDisabled(document.body, 'Deploying multicall3…')
	})

	test('shows the connect-wallet branch when account is missing', async () => {
		const deploymentStep = createDeploymentStep({ id: 'multicall3', deployed: false, dependencies: [] })
		const rendered = await renderIntoDocument(<DeploymentSection title='Deployment' steps={[deploymentStep]} allSteps={[deploymentStep]} accountAddress={undefined} busyStepId={undefined} deploymentStateReady={true} isOnActiveAppChain={true} onDeploy={async () => undefined} />)
		cleanupRendered = rendered.cleanup

		expect(rendered.container.textContent).toContain('Connect wallet to continue.')
		expect(rendered.container.textContent?.match(/Connect wallet/g) ?? []).toHaveLength(1)
		expectTransactionButtonDisabled(document.body, 'Deploy multicall3')
		const button = rendered.container.querySelector('button')
		const detailId = button?.getAttribute('aria-describedby')
		expect(detailId).toBe('deployment-multicall3-status-detail')
		expect(rendered.container.querySelector(`#${detailId}`)?.textContent).toBe('Connect wallet to continue.')
	})

	test('shows the network-guard branch when account is present but not on mainnet', async () => {
		const deploymentStep = createDeploymentStep({ id: 'multicall3', deployed: false, dependencies: [] })
		const rendered = await renderIntoDocument(<DeploymentSection title='Deployment' steps={[deploymentStep]} allSteps={[deploymentStep]} accountAddress={zeroAddress} busyStepId={undefined} deploymentStateReady={true} isOnActiveAppChain={false} onDeploy={async () => undefined} />)
		cleanupRendered = rendered.cleanup

		expect(rendered.container.textContent).toContain('Switch to Ethereum mainnet.')
		expectTransactionButtonDisabled(document.body, 'Deploy multicall3')
	})

	test('shows waiting state while prerequisite step is missing', async () => {
		const prerequisite = createDeploymentStep({ id: 'proxyDeployer', deployed: false, label: 'Proxy Deployer' })
		const dependent = createDeploymentStep({ id: 'deploymentStatusOracle', deployed: false, dependencies: ['proxyDeployer'], label: 'Deployment Status Oracle' })
		const rendered = await renderIntoDocument(<DeploymentSection title='Deployment' steps={[dependent]} allSteps={[prerequisite, dependent]} accountAddress={zeroAddress} busyStepId={undefined} deploymentStateReady={true} isOnActiveAppChain={true} onDeploy={async () => undefined} />)
		cleanupRendered = rendered.cleanup

		expect(rendered.container.textContent).toContain('Requires Proxy Deployer')
		expect(rendered.container.textContent?.match(/Requires Proxy Deployer/g) ?? []).toHaveLength(1)
		expectTransactionButtonDisabled(document.body, 'Deploy Deployment Status Oracle', 'Requires Proxy Deployer')
		const button = rendered.container.querySelector('button')
		const detailId = button?.getAttribute('aria-describedby')
		expect(detailId).toBe('deployment-deploymentStatusOracle-status-detail')
		expect(rendered.container.querySelector(`#${detailId}`)?.textContent).toBe('Requires Proxy Deployer')
		expect(rendered.container.textContent).toContain('Waiting')
		expect(rendered.container.textContent).not.toContain('Blocked')
		expect(rendered.container.textContent).toContain('Deployment Status Oracle')
	})

	test('enables deploy when wallet and chain are ready and prerequisites are satisfied', async () => {
		const step = createDeploymentStep({ id: 'multicall3', deployed: false })
		const rendered = await renderIntoDocument(<DeploymentSection title='Deployment' steps={[step]} allSteps={[step]} accountAddress={zeroAddress} busyStepId={undefined} deploymentStateReady={true} isOnActiveAppChain={true} onDeploy={async () => undefined} />)
		cleanupRendered = rendered.cleanup

		expectTransactionButtonEnabled(document.body, 'Deploy multicall3')
		expect(rendered.container.textContent).toContain('Can deploy now.')
	})
})
