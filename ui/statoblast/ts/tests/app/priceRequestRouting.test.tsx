import { describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installModuleMocks } from '@zoltar/ui-core-shared/tests/testUtils/moduleMocks.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createInjectedBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { PriceRequestStatusSection } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/PriceRequestStatusSection.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import type { OpenOracleReportDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { useAppRouteEffects } from '../../app/hooks/useAppRouteEffects.js'
import { useStatoblastUrlState } from '../../app/hooks/useStatoblastUrlState.js'

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

let availableReport = settledReport
const loadReport = mock(async (_client: unknown, _address: unknown, _reportId: bigint) => availableReport)
const moduleMocks = installModuleMocks(specifier => import.meta.resolve(specifier))
// Keep the real app hooks, URL synchronization, operations and request controls; replace only the RPC read.
await moduleMocks.mockModule('@zoltar/ui-statoblast-shared/protocol/openOracle.js', () => ({ loadOpenOracleReportDetails: loadReport }))
const { useOpenOracleRoute } = await import('../../app/hooks/useOpenOracleRoute.js')

function RequestRouteHarness() {
	const { navigate, route } = useHashRoute()
	const { openOracleReportId, setOpenOracleReport } = useStatoblastUrlState()
	const oracle = useOpenOracleRoute({
		accountState: createAccountState(),
		canReadOnchainData: true,
		navigate,
		route,
		setOpenOracleReport,
		urlOpenOracleReportId: openOracleReportId,
		walletScopedHookConfig: { accountAddress: undefined, refreshState: async () => undefined },
	})
	useAppRouteEffects({
		accountAddress: undefined,
		activeEnvironmentNonce: 0,
		applicationDeploymentMissing: false,
		environmentReady: true,
		formSync: { setOpenOracleReportId: oracle.setOpenOracleReportId, setSecurityPoolAddress: () => undefined, setSecurityPoolQuestionId: () => undefined, setSelectedVaultOwner: () => undefined },
		loadOracleReport: oracle.loadOracleReport,
		loadSecurityPools: async () => undefined,
		navigate,
		resetSecurityPoolCreation: () => undefined,
		route,
		securityPoolAddress: '',
		securityPoolQuestionId: '',
		securityPoolResultHash: undefined,
		selectedPoolSecurityPoolAddress: undefined,
		tradingResultHash: undefined,
		urlOpenOracleReportId: openOracleReportId,
		urlVaultAddress: undefined,
		walletBootstrapComplete: true,
	})
	return route === 'open-oracle' ? (
		<PriceRequestStatusSection {...oracle.openOracleRouteContentProps} />
	) : (
		<>
			<button type='button' onClick={() => oracle.onViewPendingReport(7n)}>
				View pending request
			</button>
			<button type='button' onClick={() => oracle.openOracleRouteContentProps.onLoadOracleReport('7')}>
				Read inline request
			</button>
		</>
	)
}

const lifecycle = installDomTestLifecycle({
	beforeTest: () => {
		availableReport = settledReport
		loadReport.mockClear()
		installStatoblastRouting()
		installActiveEnvironmentForTesting(createInjectedBackend({ profile: SEPOLIA_NETWORK_PROFILE }))
	},
	afterTest: () => {
		resetActiveEnvironmentForTesting()
		resetRoutingForTesting()
	},
})
async function renderRoute(hash: string) {
	window.history.replaceState(undefined, '', `/${hash}`)
	return lifecycle.trackRendered(await renderIntoDocument(<RequestRouteHarness />))
}

describe('Statoblast price request routing', () => {
	test('loads a new lookup once through URL synchronization', async () => {
		await renderRoute('#/open-oracle')
		const query = within(document.body)
		await act(() => fireEvent.input(query.getByLabelText('Report ID'), { target: { value: '7' } }))
		const form = query.getByRole('button', { name: 'Open report' }).closest('form')
		if (form === null) throw new Error('Expected request lookup form')
		await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
		await waitFor(() => expect(query.getByRole('heading', { name: 'Report #7' })).toBeTruthy())
		expect(loadReport).toHaveBeenCalledTimes(1)
		expect(window.location.hash).toBe('#/open-oracle?openOracleReportId=7')
	})
	test('opens a pending request once and keeps Back pointed at the pool', async () => {
		await renderRoute('#/pools')
		const historyLength = window.history.length
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'View pending request' })))
		await waitFor(() => expect(document.body.textContent).toContain('Report #7'))
		expect(loadReport).toHaveBeenCalledTimes(1)
		expect(window.history.length).toBe(historyLength + 1)
		// The request route carries only its own report, not the Pools view it was opened from; Back restores that view.
		expect(window.location.hash).toBe('#/open-oracle?openOracleReportId=7')
		await act(async () => {
			const popped = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }))
			window.history.back()
			await popped
		})
		expect(window.location.hash).toBe('#/pools')
	})
	test('automatically refreshes a numeric-equivalent ID without changing its history or URL', async () => {
		availableReport = { ...settledReport, isDistributed: false, settlementTimestamp: 0n }
		const hash = '#/open-oracle?openOracleReportId=0007'
		await renderRoute(hash)
		const historyLength = window.history.length
		await waitFor(() => expect(loadReport.mock.calls.length).toBeGreaterThanOrEqual(2))
		expect(window.history.length).toBe(historyLength)
		expect(window.location.hash).toBe(hash)
		expect(loadReport).toHaveBeenCalledTimes(2)
	})
	test('reads an inline request without navigating away from the pool', async () => {
		await renderRoute('#/pools')
		const historyLength = window.history.length
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Read inline request' })))
		await waitFor(() => expect(loadReport).toHaveBeenCalledTimes(1))
		expect(window.location.hash).toBe('#/pools')
		expect(window.history.length).toBe(historyLength)
	})
})
