import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { PortfolioQuestionWorkspace } from '../../app/components/PortfolioQuestionWorkspace.js'
import { useOpenOracleRoute } from '../../app/hooks/useOpenOracleRoute.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs, simulationWaitOptions } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { loadAllSecurityPools } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'
import * as portfolioCopy from '@zoltar/ui-statoblast-shared/copy/portfolio.js'
import { abbreviateAddress } from '@zoltar/ui-core-shared/lib/address.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const callbacks = { onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

test(
	'portfolio question browser selects a registered question and renders its trading and reporting workspace',
	async () => {
		const backend = await createBootstrappedSimulationBackendWithRetry('portfolio', 1, 'statoblast')
		try {
			installActiveEnvironmentForTesting(backend)
			const [owner] = await backend.getAccounts()
			if (owner === undefined) throw new Error('Missing scenario owner')
			const pools = await loadAllSecurityPools(backend.createReadClient())
			const first = pools[0]
			if (first === undefined) throw new Error('Missing seeded question')
			const selected: string[] = []
			const props = {
				parameters: { ...callbacks, accountAddress: owner },
				accountState: createAccountState({ address: owner, chainId: backend.profile.chainIdHex }),
				deploymentStatuses: [],
				enabled: true,
				environmentKey: 0,
				universeId: 0n,
				currentTimestamp: undefined,
				onSelect: (_universe: bigint, address: string) => selected.push(address),
			}
			const view = await renderIntoDocument(<PortfolioQuestionWorkspace {...props} selectedAddress='' />)
			lifecycle.trackRendered(view)
			await waitFor(() => expect(view.container.querySelectorAll('tbody tr')).toHaveLength(2), simulationWaitOptions)
			const table = view.container.querySelector('[role="region"]')
			expect(table?.getAttribute('tabindex')).toBe('0')
			// Explicit roles keep the table semantics when phone widths stack the rows.
			expect(table?.querySelectorAll('[role="row"]')).toHaveLength(3)
			expect(table?.querySelectorAll('[role="columnheader"]')).toHaveLength(3)
			const portfolioLink = table?.querySelector('tbody td[data-label] a')
			if (portfolioLink === null || portfolioLink === undefined) throw new Error('Missing portfolio link')
			const portfolioAddress = portfolioLink.getAttribute('title') ?? ''
			expect(portfolioAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
			expect(portfolioLink.textContent).toBe(abbreviateAddress(portfolioAddress, 6, 4))
			expect(portfolioLink.getAttribute('aria-label')).toBe(portfolioCopy.formatOpenPortfolioLabel(portfolioAddress))
			expect(portfolioLink.getAttribute('href')).toBe(`#/portfolios?portfolio=${portfolioAddress}&universe=0`)
			const button = table?.querySelector('button')
			if (!(button instanceof HTMLButtonElement)) throw new Error('Missing question selector')
			await act(() => button.click())
			expect(selected).toEqual([first.securityPoolAddress])
			await act(() => render(<PortfolioQuestionWorkspace {...props} selectedAddress={first.securityPoolAddress} />, view.container))
			await waitFor(() => expect(view.container.textContent).toContain('Mint complete sets'), simulationWaitOptions)
			await waitFor(() => expect(view.container.textContent).toContain('Reporting workflow'), simulationWaitOptions)
			await act(() => render(<PortfolioQuestionWorkspace {...props} enabled={false} environmentKey={1} selectedAddress='' />, view.container))
			await waitFor(() => expect(view.container.querySelector('table')).toBeNull())
		} finally {
			await backend.dispose()
		}
	},
	simulationSetupTimeoutMs,
)

test('viewing a pending price report replaces the new oracle route entry and preserves the return route', async () => {
	const calls: unknown[] = []
	let result: ReturnType<typeof useOpenOracleRoute> | undefined
	function Harness() {
		result = useOpenOracleRoute({ accountState: createAccountState(), canReadOnchainData: false, navigate: route => calls.push(['navigate', route]), route: 'portfolios', setOpenOracleReport: (id, mode) => calls.push(['report', id, mode]), urlOpenOracleReportId: '', walletScopedHookConfig: callbacks })
		return null
	}
	const view = await renderIntoDocument(<Harness />)
	lifecycle.trackRendered(view)
	if (result === undefined) throw new Error('Route hook missing')
	await act(() => result?.onViewPendingReport(42n))
	expect(calls).toEqual([
		['navigate', 'open-oracle'],
		['report', '42', 'replace'],
	])
	expect(result.openOracleRouteContentProps.openOracleForm.reportId).toBe('42')
	await act(() => result?.setOpenOracleReportId('43'))
	expect(result.openOracleRouteContentProps.openOracleForm.reportId).toBe('43')
})
