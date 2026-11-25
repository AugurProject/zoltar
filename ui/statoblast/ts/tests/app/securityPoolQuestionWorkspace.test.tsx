import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { SecurityPoolQuestionWorkspace } from '../../app/components/SecurityPoolQuestionWorkspace.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs, simulationWaitOptions } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { loadQuestionLedgerListing } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'
import * as securityPoolCopy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import { abbreviateAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const callbacks = { onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

test(
	'security pool question browser selects a registered question and renders its trading and reporting workspace',
	async () => {
		const backend = await createBootstrappedSimulationBackendWithRetry('securitypoolx2', 1, 'statoblast')
		try {
			let failQuestionRead = false
			let failListing = true
			const client = backend.createReadClient()
			const readContract: typeof client.readContract = async request => {
				if (failListing && request.functionName === 'questionLedgerDeploymentCount') throw new Error('Temporary question listing failure.')
				if (failQuestionRead && request.functionName === 'getQuestionLedgerOriginId') throw new Error('Temporary question read failure.')
				return await client.readContract(request)
			}
			installActiveEnvironmentForTesting({ ...backend, createReadClient: () => client.extend(() => ({ readContract })) })
			const [owner] = await backend.getAccounts()
			if (owner === undefined) throw new Error('Missing scenario owner')
			const { pools } = await loadQuestionLedgerListing(backend.createReadClient())
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
			installStatoblastRouting()
			window.history.replaceState({}, '', '#/pools?simulate=1&genesis=yes&simScenario=securitypoolx2')
			const view = await renderIntoDocument(<SecurityPoolQuestionWorkspace {...props} selectedAddress='' />)
			lifecycle.trackRendered(view)
			await waitFor(() => expect(view.container.textContent).toContain('Temporary question listing failure.'), simulationWaitOptions)
			expect(view.container.textContent).not.toContain(securityPoolCopy.noRegisteredQuestions)
			const retryListing = () => {
				const button = [...view.container.querySelectorAll('button')].find(item => item.textContent === securityPoolCopy.retryQuestionList)
				if (button === undefined) throw new Error('Missing listing retry action')
				button.click()
			}
			failListing = false
			await act(retryListing)
			await waitFor(() => expect(view.container.querySelectorAll('tbody tr')).toHaveLength(2), simulationWaitOptions)
			failListing = true
			await act(() => invalidateAppData())
			await waitFor(() => expect(view.container.textContent).toContain('Temporary question listing failure.'), simulationWaitOptions)
			expect(view.container.querySelectorAll('tbody tr')).toHaveLength(2)
			failListing = false
			await act(retryListing)
			await waitFor(() => expect(view.container.textContent).not.toContain('Temporary question listing failure.'), simulationWaitOptions)
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
			expect(securityPoolLink.getAttribute('href')).toBe(`#/security-pools?simulate=1&genesis=yes&simScenario=securitypoolx2&securityPool=${securityPoolAddress}&universe=0`)
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
			failQuestionRead = true
			await act(() => invalidateAppData())
			await waitFor(() => expect(view.container.textContent).toContain('Temporary question read failure.'), simulationWaitOptions)
			expect(view.container.textContent).toContain('Reporting workflow')
			failQuestionRead = false
			const retry = [...view.container.querySelectorAll('button')].find(item => item.textContent === securityPoolCopy.retryQuestionDetails)
			if (retry === undefined) throw new Error('Missing question retry action')
			await act(() => retry.click())
			await waitFor(() => expect(view.container.textContent).not.toContain('Temporary question read failure.'), simulationWaitOptions)
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
