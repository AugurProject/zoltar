import { describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createInjectedBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { installModuleMocks } from '@zoltar/ui-core-shared/tests/testUtils/moduleMocks.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { navigateToUrl } from '@zoltar/ui-core-shared/navigation/historyEntries.js'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { resetLocalEntityStoreForTesting, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import type { OpenOracleReportDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { openOracleReportDownloadStore, toCachedOpenOracleReportSummary } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/reportBrowse.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { useProtocolAppShell } from '@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js'
import { buildDeploymentRouteContentProps } from '@zoltar/ui-zoltar-shared/features/deployment/lib/deploymentRoute.js'
import { installOpenOracleRouting } from '../../app/routing.js'
import { onchainStateDependencies } from '../../app/onchainStateDependencies.js'

const moduleMocks = installModuleMocks(specifier => import.meta.resolve(specifier))
let availableReport: OpenOracleReportDetails | undefined
const loadReport = mock(async (_client: unknown, _address: unknown, reportId: bigint): Promise<OpenOracleReportDetails> => {
	if (availableReport?.reportId === reportId) return availableReport
	throw new Error('Report read unavailable')
})
let deploymentMissing = false
const settledReport: OpenOracleReportDetails = {
	callbackContract: zeroAddress,
	callbackGasLimit: 0,
	currentAmount1: 100n,
	currentAmount2: 25n,
	currentBlockNumber: 10n,
	currentReporter: '0x0000000000000000000000000000000000000001',
	currentTime: 200n,
	disputeDelay: 1n,
	disputeOccurred: false,
	escalationHalt: 0n,
	exactToken1Report: 100n,
	feePercentage: 0n,
	feesOnlyAtHalt: false,
	flexibleEscalation: false,
	initialReporter: '0x0000000000000000000000000000000000000001',
	isDistributed: true,
	lastReportOppoTime: 0n,
	multiplier: 2n * 10n ** 18n,
	numReports: 1n,
	openOracleAddress: '0x0000000000000000000000000000000000000002',
	price: 4n * 10n ** 18n,
	protocolFee: 0n,
	protocolFeeRecipient: zeroAddress,
	reportId: 7n,
	reportTimestamp: 100n,
	settlementTime: 10n,
	settlementTimestamp: 111n,
	settlerRewardAttoEth: 0n,
	stateHash: '0x1234000000000000000000000000000000000000000000000000000000000000',
	timeType: true,
	token1: '0x0000000000000000000000000000000000000003',
	token1Decimals: 18,
	token1Symbol: 'REP',
	token2: '0x0000000000000000000000000000000000000004',
	token2Decimals: 18,
	token2Symbol: 'WETH',
	trackDisputes: false,
}

// Keep the real route hooks, oracle operations and rendered controls. Only the shell's
// wallet/deployment session and the RPC read are replaced in these navigation tests.
await moduleMocks.mockModule('@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js', () => ({
	useProtocolAppShell: ({ deploymentRoute }: Parameters<typeof useProtocolAppShell>[0]) => ({
		accountState: { address: undefined, chainId: undefined, ethBalanceAttoEth: undefined, wethBalanceAttoEth: undefined },
		activeEnvironmentNonce: 0,
		applicationDeploymentMissing: deploymentMissing,
		canReadOnchainData: true,
		currentBlockNumber: 10n,
		currentTimestamp: 200n,
		deployRouteContentProps: buildDeploymentRouteContentProps({
			accountAddress: undefined,
			deploymentStateReady: !deploymentMissing,
			deploymentStatusError: undefined,
			deploymentStatuses: onchainStateDependencies.getDeploymentSteps().map(step => ({ ...step, deployed: !deploymentMissing })),
			flow: { busyStepId: undefined, deployNextMissingPending: false, deployNextMissing: async () => undefined, deployStep: async () => undefined },
			isLoadingDeploymentStatuses: false,
			isOnActiveAppChain: false,
			onRetryDeploymentStatus: () => undefined,
			...deploymentRoute,
		}),
		environmentBootstrapError: undefined,
		errorMessages: [],
		overviewWalletProps: {
			accountState: { address: undefined, chainId: undefined, ethBalanceAttoEth: undefined, wethBalanceAttoEth: undefined },
			isConnectingWallet: false,
			isManagingWallet: false,
			isRefreshing: false,
			onChangeWallet: () => undefined,
			onConnect: () => undefined,
			onDisconnectWallet: () => undefined,
			onSwitchNetwork: () => undefined,
			walletBootstrapComplete: true,
		},
		readBackendMessage: undefined,
		readBackendStatus: undefined,
		refreshActiveEnvironment: async () => undefined,
		refreshSimulationView: async () => undefined,
		retryReadBackend: async () => undefined,
		routeContentBlocked: false,
		showDeployTab: false,
		simulationController: undefined,
		transactionTray: { transactionState: { value: undefined } },
		walletScopedAccountAddress: undefined,
		walletScopedHookConfig: { accountAddress: undefined, refreshState: async () => undefined },
	}),
}))
await moduleMocks.mockModule('@zoltar/ui-statoblast-shared/protocol/openOracle.js', () => ({ loadOpenOracleReportDetails: loadReport }))
const { App } = await import('../../app/App.js')

const lifecycle = installDomTestLifecycle({
	beforeTest: () => {
		deploymentMissing = false
		availableReport = undefined
		loadReport.mockClear()
		resetLocalEntityStoreForTesting()
		installOpenOracleRouting()
		installActiveEnvironmentForTesting(createInjectedBackend({ profile: SEPOLIA_NETWORK_PROFILE }))
	},
	afterTest: () => {
		resetActiveEnvironmentForTesting()
		resetRoutingForTesting()
	},
})

async function renderApp(hash = '') {
	window.history.replaceState(undefined, '', `/${hash}`)
	return lifecycle.trackRendered(await renderIntoDocument(<App />))
}

async function navigate(hash: string) {
	await act(() => navigateToUrl(hash))
}

describe('OpenOracle application navigation', () => {
	test('returns from deployment to the oracle browser', async () => {
		await renderApp('#/deploy')
		expect(document.title).toContain('Deploy contracts')
		expect(within(document.body).getByRole('link', { name: 'Browse reports' }).getAttribute('href')).toBe('#/open-oracle')
		expect(loadReport).not.toHaveBeenCalled()
	})

	test('redirects a missing deployment without trapping Back in a redirect loop', async () => {
		deploymentMissing = true
		const historyLength = window.history.length
		await renderApp('#/open-oracle')
		await waitFor(() => expect(window.location.hash).toBe('#/deploy'))
		expect(window.history.length).toBe(historyLength)
		expect(loadReport).not.toHaveBeenCalled()
	})

	test('opens the browser on a hashless URL and keeps standalone controls out of other views', async () => {
		await renderApp()
		expect(window.location.hash).toBe('#/open-oracle')
		expect(document.title).toContain('OpenOracle')
		expect(document.body.textContent).not.toContain('Genesis')
		const query = within(document.body)
		expect(query.getByRole('link', { name: 'Browse reports' }).getAttribute('aria-current')).toBe('page')
		expect(query.queryByRole('button', { name: 'Create standalone OpenOracle report' })).toBeNull()
		await act(() => fireEvent.click(query.getByRole('link', { name: 'Create report' })))
		expect(window.location.hash).toBe('#/open-oracle?openOracleView=create')
		expect(query.getByRole('link', { name: 'Create report' }).getAttribute('aria-current')).toBe('page')
		expect(query.getByRole('button', { name: 'Create standalone OpenOracle report' })).toBeTruthy()
		expect(loadReport).not.toHaveBeenCalled()
	})

	test('loads a deep-linked report and retries it without adding a history entry', async () => {
		await renderApp('#/open-oracle?openOracleReportId=7')
		await waitFor(() => expect(loadReport).toHaveBeenCalledTimes(1))
		expect(loadReport.mock.calls[0]?.[2]).toBe(7n)
		const query = within(document.body)
		expect(query.getByRole('link', { name: 'View report' }).getAttribute('aria-current')).toBe('page')
		await waitFor(() => expect(document.body.textContent).toContain('Report read unavailable'))
		const historyLength = window.history.length
		await act(() => fireEvent.click(query.getByRole('button', { name: 'Open report' })))
		await waitFor(() => expect(loadReport).toHaveBeenCalledTimes(2))
		expect(window.history.length).toBe(historyLength)
	})

	test('loads a newly submitted report once and records its selected-report URL', async () => {
		await renderApp('#/open-oracle?openOracleView=selected-report')
		const query = within(document.body)
		await act(() => fireEvent.input(query.getByLabelText('Report ID'), { target: { value: '8' } }))
		await act(() => fireEvent.click(query.getByRole('button', { name: 'Open report' })))
		await waitFor(() => expect(loadReport).toHaveBeenCalled())
		expect(window.location.hash).toBe('#/open-oracle?openOracleView=selected-report&openOracleReportId=8')
		expect(loadReport).toHaveBeenCalledTimes(1)
	})

	test('opens a favorite with one history entry and returns to browse with Back', async () => {
		availableReport = settledReport
		const scope = getLocalEntityScope('openoracle', 'oracleReport')
		openOracleReportDownloadStore.record(scope, [{ id: '7', data: toCachedOpenOracleReportSummary(settledReport) }])
		setEntityFavorite(scope, '7', true)
		await renderApp('#/open-oracle')
		const historyLength = window.history.length
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Open report: REP / WETH · report #7' })))
		await waitFor(() => expect(loadReport).toHaveBeenCalledTimes(1))
		expect(window.history.length).toBe(historyLength + 1)
		expect(window.location.hash).toContain('openOracleReportId=7')
		await act(async () => {
			const popped = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }))
			window.history.back()
			await popped
		})
		expect(window.location.hash).toBe('#/open-oracle')
		expect(within(document.body).getByRole('link', { name: 'Browse reports' }).getAttribute('aria-current')).toBe('page')
		expect(within(document.body).getByRole('button', { name: 'Open report: REP / WETH · report #7' })).toBeTruthy()
	})

	test('refreshes an equivalent numeric report ID without rewriting its URL or history', async () => {
		availableReport = settledReport
		const hash = '#/open-oracle?openOracleReportId=0007'
		await renderApp(hash)
		const query = within(document.body)
		await waitFor(() => expect(query.getByRole('button', { name: 'Refresh report' })).toBeTruthy())
		const historyLength = window.history.length
		await act(() => fireEvent.click(query.getByRole('button', { name: 'Refresh report' })))
		await waitFor(() => expect(loadReport).toHaveBeenCalledTimes(2))
		expect(window.history.length).toBe(historyLength)
		expect(window.location.hash).toBe(hash)
		expect(loadReport.mock.calls.at(-1)?.[2]).toBe(7n)
	})

	test('opens the selected view when a browse URL already carries the same report ID', async () => {
		availableReport = settledReport
		await renderApp('#/open-oracle?openOracleView=browse&openOracleReportId=7')
		await waitFor(() => expect(loadReport).toHaveBeenCalledTimes(1))
		const query = within(document.body)
		await act(() => fireEvent.input(query.getByLabelText('Search reports'), { target: { value: '7' } }))
		const historyLength = window.history.length
		await act(() => fireEvent.click(query.getByRole('button', { name: 'Open report #7' })))
		expect(query.getByRole('link', { name: 'View report' }).getAttribute('aria-current')).toBe('page')
		expect(window.history.length).toBe(historyLength + 1)
	})

	test('clears the selected report when switching views and restores a report on history navigation', async () => {
		await renderApp('#/open-oracle?openOracleReportId=7')
		await waitFor(() => expect(loadReport).toHaveBeenCalledTimes(1))
		await act(() => fireEvent.click(within(document.body).getByRole('link', { name: 'Create report' })))
		expect(window.location.hash).not.toContain('openOracleReportId')
		// Reproduce the browser's notification when Back/Forward restores a selected report entry.
		window.history.replaceState(undefined, '', '#/open-oracle?openOracleReportId=9')
		await act(() => window.dispatchEvent(new Event('popstate')))
		await waitFor(() => expect(loadReport.mock.calls.at(-1)?.[2]).toBe(9n))
		expect(within(document.body).getByRole('link', { name: 'View report' }).getAttribute('aria-current')).toBe('page')
	})

	test('rejects invalid view URLs without reading the supplied report', async () => {
		await renderApp('#/open-oracle?openOracleView=invalid&openOracleReportId=7')
		expect(within(document.body).getByRole('heading', { name: 'Page not found', level: 1 })).toBeTruthy()
		expect(loadReport).not.toHaveBeenCalled()
		await navigate('#/open-oracle?openOracleView=')
		expect(within(document.body).getByRole('heading', { name: 'Page not found', level: 1 })).toBeTruthy()
		await navigate('#/unknown')
		expect(within(document.body).getByRole('heading', { name: 'Page not found', level: 1 })).toBeTruthy()
		await navigate('#/deploy?openOracleView=create')
		expect(within(document.body).getByRole('heading', { name: 'Page not found', level: 1 })).toBeTruthy()
	})
})
