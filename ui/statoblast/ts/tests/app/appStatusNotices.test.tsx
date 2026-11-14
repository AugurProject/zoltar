import { describe, expect, test } from 'bun:test'
import { disconnectedAccountState, disconnectedOverviewWalletProps } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installModuleMocks } from '@zoltar/ui-core-shared/tests/testUtils/moduleMocks.js'
import { waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { createInjectedBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import type { useProtocolAppShell } from '@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js'
import { buildDeploymentRouteContentProps } from '@zoltar/ui-zoltar-shared/features/deployment/lib/deploymentRoute.js'
import { onchainStateDependencies } from '../../app/onchainStateDependencies.js'

const moduleMocks = installModuleMocks(specifier => import.meta.resolve(specifier))

// Keep the real notices, routing and deployment page. Only the shell's wallet/deployment
// session and the Uniswap REP price reads are replaced, with every contract reported missing.
await moduleMocks.mockModule('@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js', () => ({
	useProtocolAppShell: ({ deploymentRoute }: Parameters<typeof useProtocolAppShell>[0]) => {
		const deploymentStatuses = onchainStateDependencies.getDeploymentSteps().map(step => ({ ...step, deployed: false }))
		return {
			accountState: disconnectedAccountState,
			activeEnvironmentNonce: 0,
			applicationDeploymentMissing: true,
			canReadOnchainData: true,
			currentBlockNumber: 10n,
			currentTimestamp: 200n,
			deploymentStatuses,
			deployRouteContentProps: buildDeploymentRouteContentProps({
				accountAddress: undefined,
				deploymentStateReady: true,
				deploymentStatusError: undefined,
				deploymentStatuses,
				flow: { busyStepId: undefined, deployNextMissingPending: false, deployNextMissing: async () => undefined, deployStep: async () => undefined },
				isLoadingDeploymentStatuses: false,
				isOnActiveAppChain: false,
				onRetryDeploymentStatus: () => undefined,
				...deploymentRoute,
			}),
			environmentBootstrapError: undefined,
			errorMessages: [],
			overviewWalletProps: disconnectedOverviewWalletProps,
			readBackendMessage: undefined,
			readBackendStatus: undefined,
			refreshActiveEnvironment: async () => undefined,
			refreshSimulationView: async () => undefined,
			retryReadBackend: async () => undefined,
			routeContentBlocked: false,
			showDeployTab: true,
			simulationController: undefined,
			transactionTray: { transactionState: { value: undefined } },
			walletBootstrapComplete: false,
			walletScopedAccountAddress: undefined,
			walletScopedHookConfig: { accountAddress: undefined, refreshState: async () => undefined },
		}
	},
}))
await moduleMocks.mockModule('@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js', () => ({
	useRepPrices: () => ({
		isLoadingRepPrices: false,
		isRefreshingRepPrices: false,
		refreshRepPrices: () => undefined,
		repPerEthFailure: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		repUsdcFailure: undefined,
		repUsdcPrice: undefined,
		repUsdcSource: undefined,
		repUsdcSourceUrl: undefined,
	}),
}))
const { App } = await import('../../app/App.js')

const lifecycle = installDomTestLifecycle({
	beforeTest: () => {
		installStatoblastRouting()
		installActiveEnvironmentForTesting(createInjectedBackend({ profile: SEPOLIA_NETWORK_PROFILE }))
	},
	afterTest: () => {
		resetActiveEnvironmentForTesting()
		resetRoutingForTesting()
	},
})

async function renderApp(hash: string) {
	window.history.replaceState(undefined, '', `/${hash}`)
	return lifecycle.trackRendered(await renderIntoDocument(<App />))
}

describe('Statoblast setup-incomplete notice', () => {
	test('stays off the deploy page, which already lists the missing contracts', async () => {
		await renderApp('#/deploy')
		const query = within(document.body)
		await waitFor(() => expect(query.getByRole('heading', { level: 1, name: 'Deploy contracts' })).toBeTruthy())
		expect(document.body.textContent).toContain('SecurityPoolFactory')
		// Assert on text, not on a queried element: Bun stalls formatting an element attached to a
		// whole-app DOM and can then let a failed toBeNull() pass.
		expect(document.body.textContent).not.toContain(appCopy.setupIncomplete)
		expect(document.body.textContent).not.toContain(appCopy.deploymentIncompleteReason)
	})

	test('still explains missing contracts on a not-found page under the deploy path', async () => {
		// The page is not the deploy page, and the missing-deployment redirect leaves an
		// unrecognised deploy URL alone, so the notice is the only sign of missing contracts here.
		await renderApp('#/deploy?openOracleView=create')
		const query = within(document.body)
		await waitFor(() => expect(query.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy())
		expect(window.location.hash).toBe('#/deploy?openOracleView=create')
		expect(query.getByText(appCopy.setupIncomplete)).toBeTruthy()
		expect(query.getByText(appCopy.deploymentIncompleteReason)).toBeTruthy()
	})
})
