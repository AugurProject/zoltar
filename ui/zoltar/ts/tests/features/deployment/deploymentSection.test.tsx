/// <reference types='bun-types' />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { WalletActionsProvider } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import { DeploymentSection } from '@zoltar/ui-zoltar-shared/features/deployment/components/DeploymentSection.js'
import { describe, expect, test } from 'bun:test'

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
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	test("keeps a deployed step's button in place, disabled and labelled Deployed, without a redundant badge or detail", async () => {
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

		expect(rendered.container.querySelector('span.badge')).toBeNull()
		expect(rendered.container.textContent).not.toContain('Code found at expected address.')
		const button = rendered.container.querySelector('button')
		expect(button?.textContent).toBe('Deployed')
		expect(button?.getAttribute('aria-label')).toBe('Proxy Deployer deployed')
		expect(button?.disabled).toBe(true)
		expect(rendered.container.textContent?.split('Deployed').length).toBe(2)
		button?.click()
		expect(onDeployCalls).toBe(0)
	})

	test('shows deployment progress for busy steps', async () => {
		const deploymentStep = createDeploymentStep({ id: 'multicall3', deployed: false, dependencies: [] })
		const rendered = await renderIntoDocument(<DeploymentSection title='Deployment' steps={[deploymentStep]} allSteps={[deploymentStep]} accountAddress={zeroAddress} busyStepId='multicall3' deploymentStateReady={true} isOnActiveAppChain={true} onDeploy={async () => undefined} />)
		cleanupRendered = rendered.cleanup

		expect(rendered.container.textContent).toContain('Deployment in progress.')
		// The pending button is the only place that says "Deploying…".
		expect(rendered.container.querySelector('span.badge')).toBeNull()
		expect(rendered.container.textContent?.split('Deploying…').length).toBe(2)
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

	test('says no browser wallet was found instead of asking to connect when the browser has no wallet', async () => {
		const deploymentStep = createDeploymentStep({ id: 'multicall3', deployed: false, dependencies: [] })
		const walletActions = { hasInjectedWallet: false, isConnectingWallet: false, isManagingWallet: false, onConnect: () => undefined, onSwitchNetwork: () => undefined }
		const rendered = await renderIntoDocument(
			<WalletActionsProvider walletActions={walletActions}>
				<DeploymentSection title='Deployment' steps={[deploymentStep]} allSteps={[deploymentStep]} accountAddress={undefined} busyStepId={undefined} deploymentStateReady={true} isOnActiveAppChain={true} onDeploy={async () => undefined} />
			</WalletActionsProvider>,
		)
		cleanupRendered = rendered.cleanup

		expect(rendered.container.textContent).not.toContain('Connect wallet')
		expect(rendered.container.querySelector('#deployment-multicall3-status-detail')?.textContent).toBe('No browser wallet found. Install or enable one to connect.')
		expectTransactionButtonDisabled(document.body, 'Deploy multicall3')
	})

	test('shows the network-guard branch when account is present but not on Sepolia', async () => {
		const deploymentStep = createDeploymentStep({ id: 'multicall3', deployed: false, dependencies: [] })
		const rendered = await renderIntoDocument(<DeploymentSection title='Deployment' steps={[deploymentStep]} allSteps={[deploymentStep]} accountAddress={zeroAddress} busyStepId={undefined} deploymentStateReady={true} isOnActiveAppChain={false} onDeploy={async () => undefined} />)
		cleanupRendered = rendered.cleanup

		expect(rendered.container.textContent).toContain('Switch to Sepolia.')
		expectTransactionButtonDisabled(document.body, 'Deploy multicall3')
	})

	test('shows waiting state while prerequisite step is missing', async () => {
		const prerequisite = createDeploymentStep({ id: 'proxyDeployer', deployed: false, label: 'Proxy Deployer' })
		const dependent = createDeploymentStep({ id: 'deploymentStatusOracle', deployed: false, dependencies: ['proxyDeployer'], label: 'DeploymentStatusOracle' })
		const rendered = await renderIntoDocument(<DeploymentSection title='Deployment' steps={[dependent]} allSteps={[prerequisite, dependent]} accountAddress={zeroAddress} busyStepId={undefined} deploymentStateReady={true} isOnActiveAppChain={true} onDeploy={async () => undefined} />)
		cleanupRendered = rendered.cleanup

		expect(rendered.container.textContent).toContain('Requires Proxy Deployer.')
		expect(rendered.container.textContent?.match(/Requires Proxy Deployer\./g) ?? []).toHaveLength(1)
		expectTransactionButtonDisabled(document.body, 'Deploy DeploymentStatusOracle', 'Requires Proxy Deployer.')
		const button = rendered.container.querySelector('button')
		const detailId = button?.getAttribute('aria-describedby')
		expect(detailId).toBe('deployment-deploymentStatusOracle-status-detail')
		expect(rendered.container.querySelector(`#${detailId}`)?.textContent).toBe('Requires Proxy Deployer.')
		expect(rendered.container.textContent).toContain('Waiting')
		expect(rendered.container.textContent).not.toContain('Blocked')
		// Waiting for an earlier contract is the normal order on a first run, so the badge is neutral rather than error red.
		expect(rendered.container.querySelector('span.badge')?.className).toContain('muted')
		expect(rendered.container.textContent).toContain('DeploymentStatusOracle')
	})

	test('enables deploy when wallet and chain are ready and prerequisites are satisfied', async () => {
		const step = createDeploymentStep({ id: 'multicall3', deployed: false })
		const rendered = await renderIntoDocument(<DeploymentSection title='Deployment' steps={[step]} allSteps={[step]} accountAddress={zeroAddress} busyStepId={undefined} deploymentStateReady={true} isOnActiveAppChain={true} onDeploy={async () => undefined} />)
		cleanupRendered = rendered.cleanup

		expectTransactionButtonEnabled(document.body, 'Deploy multicall3')
		expect(rendered.container.textContent).toContain('Can deploy now.')
	})
})
