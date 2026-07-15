/// <reference types="bun-types" />

import { describe, expect, mock, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import { AppHeaderShell } from '../components/AppHeaderShell.js'
import type { SimulationController } from '../simulation/controller.js'
import type { OverviewPanelsProps, TabNavigationProps } from '../types/components.js'
import { fireEvent, within } from './testUtils/queries'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createOverviewProps(): OverviewPanelsProps {
	return {
		accountState: {
			address: undefined,
			chainId: undefined,
			ethBalance: undefined,
			wethBalance: undefined,
		},
		activeUniverseId: 0n,
		isConnectingWallet: false,
		isLoadingRepPrices: false,
		isRefreshingRepPrices: false,
		isLoadingUniverseRepBalance: false,
		isRefreshing: false,
		onConnect: () => undefined,
		onGoToGenesisUniverse: () => undefined,
		onRefreshRepPrices: () => undefined,
		parentUniverseId: undefined,
		readBackendStatus: {
			blockNumber: undefined,
			blockTimestamp: undefined,
			rpcSource: 'default',
			rpcUrl: 'browser-simulation',
			transportMode: 'rpc',
		},
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		repUsdcPrice: undefined,
		repUsdcSource: undefined,
		repUsdcSourceUrl: undefined,
		universeHasForked: false,
		universeLabel: 'Genesis',
		universePresentation: undefined,
		universeRepBalance: undefined,
		walletBootstrapComplete: true,
	}
}

function createTabNavigationProps(): TabNavigationProps {
	return {
		augurPlaceHolderDeployed: true,
		deployRoute: '#/deploy',
		marketRoute: '#/zoltar',
		onRouteChange: () => undefined,
		openOracleRoute: '#/open-oracle',
		route: 'zoltar',
		securityPoolsRoute: '#/security-pools',
	}
}

function createSimulationController(): SimulationController {
	const selectedAccount = '0x00000000000000000000000000000000000000a1' as Address
	return {
		accounts: [selectedAccount],
		advanceTime: async () => undefined,
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		blockCountSinceReset: 0n,
		currentScenario: 'baseline',
		currentTimestamp: 1n,
		dispose: async () => undefined,
		exportState: async () => '{}',
		isActive: true,
		isBootstrapped: true,
		isBootstrapping: false,
		mineBlock: async () => undefined,
		mintRep: async () => undefined,
		queryDelayMilliseconds: 0,
		repPerEthPrice: 10n ** 18n,
		repPerUsdcPrice: 10n ** 6n,
		reset: async () => undefined,
		selectAccount: async () => undefined,
		selectedAccount,
		setQueryDelayMilliseconds: () => undefined,
		setRepPerEthPrice: () => undefined,
		setRepPerUsdcPrice: () => undefined,
		setTransactionDelayMilliseconds: () => undefined,
		simulationSource: {
			kind: 'scenario',
			scenario: 'baseline',
		},
		subscribe: () => () => undefined,
		transactionCountSinceReset: 0n,
		transactionDelayMilliseconds: 0,
		waitUntilReady: async () => undefined,
	}
}

describe('AppHeaderShell', () => {
	test('always shows a skip link and focuses app content without changing the hash', async () => {
		const domEnvironment = installDomEnvironment('http://localhost/#/zoltar?simulate=1')
		const appContent = document.createElement('main')
		appContent.id = 'app-content'
		appContent.tabIndex = -1
		document.body.appendChild(appContent)

		const overview = createOverviewProps()
		const tabNavigation = createTabNavigationProps()
		const onRefresh = mock(async () => undefined)
		const withoutSimulation = await renderIntoDocument(<AppHeaderShell overview={overview} simulationController={undefined} tabNavigation={tabNavigation} onRefresh={onRefresh} />)

		try {
			const skipLink = within(withoutSimulation.container).getByRole('button', { name: 'Skip to main content' })
			fireEvent.click(skipLink)
			expect(document.activeElement).toBe(appContent)
		} finally {
			await withoutSimulation.cleanup()
		}

		const beforeHash = domEnvironment.window.location.hash
		const withSimulation = await renderIntoDocument(<AppHeaderShell overview={overview} simulationController={createSimulationController()} tabNavigation={tabNavigation} onRefresh={onRefresh} />)

		try {
			const skipLink = within(withSimulation.container).getByRole('button', { name: 'Skip to main content' })
			fireEvent.click(skipLink)

			expect(document.activeElement).toBe(appContent)
			expect(domEnvironment.window.location.hash).toBe(beforeHash)
		} finally {
			await withSimulation.cleanup()
			appContent.remove()
			domEnvironment.cleanup()
		}
	})
})
