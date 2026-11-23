import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { SecurityPoolQuestionWorkspace } from '../../app/components/SecurityPoolQuestionWorkspace.js'
import { useOpenOracleRoute } from '../../app/hooks/useOpenOracleRoute.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs, simulationWaitOptions } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { loadAllQuestionLedgers } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'
import * as securityPoolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import { abbreviateAddress } from '@zoltar/ui-core-shared/lib/address.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const callbacks = { onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

test(
	'security pool question browser selects a registered question and renders its trading and reporting workspace',
	async () => {
		const backend = await createBootstrappedSimulationBackendWithRetry('securitypoolx2', 1, 'statoblast')
		try {
			installActiveEnvironmentForTesting(backend)
			const [owner] = await backend.getAccounts()
			if (owner === undefined) throw new Error('Missing scenario owner')
			const pools = await loadAllQuestionLedgers(backend.createReadClient())
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
			const view = await renderIntoDocument(<SecurityPoolQuestionWorkspace {...props} selectedAddress='' />)
			lifecycle.trackRendered(view)
			await waitFor(() => expect(view.container.querySelectorAll('tbody tr')).toHaveLength(2), simulationWaitOptions)
			const table = view.container.querySelector('[role="region"]')
			expect([...view.container.querySelectorAll('tbody td')].filter(cell => cell.getAttribute('data-label') === securityPoolCopy.outcomeColumn).map(cell => cell.textContent)).toEqual(['Unresolved', 'Unresolved'])
			expect(table?.getAttribute('tabindex')).toBe('0')
			// Explicit roles keep the table semantics when phone widths stack the rows.
			expect(table?.querySelectorAll('[role="row"]')).toHaveLength(3)
			expect(table?.querySelectorAll('[role="columnheader"]')).toHaveLength(3)
			const securityPoolLink = table?.querySelector('tbody td[data-label] a')
			if (securityPoolLink === null || securityPoolLink === undefined) throw new Error('Missing security pool link')
			const securityPoolAddress = securityPoolLink.getAttribute('title') ?? ''
			expect(securityPoolAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
			// The full address stays in the page text; the shortened forms are for a cell too narrow to show it.
			expect(securityPoolLink.querySelector('.address-value-full')?.textContent).toBe(securityPoolAddress)
			expect([...securityPoolLink.querySelectorAll('.address-value-abbreviated')].map(form => form.textContent)).toContain(abbreviateAddress(securityPoolAddress, 6, 4))
			expect(securityPoolLink.getAttribute('aria-label')).toBe(securityPoolCopy.formatOpenSecurityPoolLabel(securityPoolAddress))
			expect(securityPoolLink.getAttribute('href')).toBe(`#/securityPools?securityPool=${securityPoolAddress}&universe=0`)
			const button = table?.querySelector('button')
			if (!(button instanceof HTMLButtonElement)) throw new Error('Missing question selector')
			await act(() => {
				button.click()
			})
			expect(selected).toEqual([first.questionLedgerAddress])
			await act(() => {
				render(<SecurityPoolQuestionWorkspace {...props} selectedAddress={first.questionLedgerAddress} />, view.container)
			})
			await waitFor(() => expect(view.container.textContent).toContain('Mint complete sets'), simulationWaitOptions)
			await waitFor(() => expect(view.container.textContent).toContain('Reporting workflow'), simulationWaitOptions)
			await act(() => {
				render(<SecurityPoolQuestionWorkspace {...props} enabled={false} environmentKey={1} selectedAddress='' />, view.container)
			})
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
		result = useOpenOracleRoute({
			accountState: createAccountState(),
			canReadOnchainData: false,
			navigate: route => calls.push(['navigate', route]),
			route: 'securityPools',
			setOpenOracleReport: (id, mode) => calls.push(['report', id, mode]),
			urlOpenOracleReportId: '',
			walletScopedHookConfig: { ...callbacks, accountAddress: undefined },
		})
		return null
	}
	const view = await renderIntoDocument(<Harness />)
	lifecycle.trackRendered(view)
	if (result === undefined) throw new Error('Route hook missing')
	await act(() => {
		result?.onViewPendingReport(42n)
	})
	expect(calls).toEqual([
		['navigate', 'open-oracle'],
		['report', '42', 'replace'],
	])
	expect(result.openOracleRouteContentProps.openOracleForm.reportId).toBe('42')
	await act(() => {
		result?.setOpenOracleReportId('43')
	})
	expect(result.openOracleRouteContentProps.openOracleForm.reportId).toBe('43')
})
