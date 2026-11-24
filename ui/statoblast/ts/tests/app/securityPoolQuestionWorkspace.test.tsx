import { expect, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { SecurityPoolQuestionWorkspace } from '../../app/components/SecurityPoolQuestionWorkspace.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs, simulationWaitOptions } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const callbacks = { onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

test(
	'a pool and question ID open the question and preserve visible data through a failed refresh',
	async () => {
		const backend = await createBootstrappedSimulationBackendWithRetry('securitypoolx2', 1, 'statoblast')
		try {
			const pool = backend.seededSecurityPool
			const questionId = pool?.questionIds[0]
			const [owner] = await backend.getAccounts()
			if (pool === undefined || questionId === undefined || owner === undefined) throw new Error('Missing seeded pool, question or wallet.')
			let offline = true
			const client = backend.createReadClient()
			const readContract: typeof client.readContract = async request => {
				if (offline && request.functionName === 'initialReportPriorityFeeAttoEthPerGas') throw new Error('Temporary question read failure.')
				return await client.readContract(request)
			}
			installActiveEnvironmentForTesting({ ...backend, createReadClient: () => client.extend(() => ({ readContract })) })
			installStatoblastRouting()
			window.history.replaceState({}, '', `#/pool/${pool.address}/question/${questionId}/shares?simulate=1&genesis=yes&simScenario=securitypoolx2`)
			const props = {
				parameters: { ...callbacks, accountAddress: owner },
				accountState: createAccountState({ address: owner, chainId: backend.profile.chainIdHex }),
				deploymentStatuses: [],
				enabled: true,
				environmentKey: 0,
				universeId: 0n,
				currentTimestamp: undefined,
				entry: { kind: 'question', pool: pool.address, questionId, tab: 'shares' } as const,
			}
			const view = lifecycle.trackRendered(await renderIntoDocument(h(SecurityPoolQuestionWorkspace, props)))
			const clickRetry = async () => {
				const retry = [...view.container.querySelectorAll('button')].find(button => button.textContent === 'Try again')
				if (retry === undefined) throw new Error('Missing question retry')
				await act(() => retry.click())
			}
			await waitFor(() => expect(view.container.textContent).toContain('Temporary question read failure.'), simulationWaitOptions)
			expect(view.container.textContent).not.toContain('showing data from')
			offline = false
			await clickRetry()
			await waitFor(() => expect(view.container.textContent).toContain('Mint complete sets'), simulationWaitOptions)
			expect(view.container.textContent).toContain('Resolution rules and details')
			expect(view.container.querySelector('[aria-current="page"]')?.textContent).toBe('Question')
			const poolLink = [...view.container.querySelectorAll('a')].find(link => link.textContent === 'Open security pool')
			expect(poolLink?.getAttribute('href')).toContain(`#/pool/${pool.address}`)
			offline = true
			await act(() => invalidateAppData())
			await waitFor(() => expect(view.container.textContent).toContain('Temporary question read failure.'), simulationWaitOptions)
			expect(view.container.textContent).toMatch(/Couldn’t refresh, showing data from \d+s ago\./)
			expect(view.container.textContent).toContain('Mint complete sets')
			offline = false
			await clickRetry()
			await waitFor(() => expect(view.container.textContent).not.toContain('showing data from'), simulationWaitOptions)
			await act(() => render(h(SecurityPoolQuestionWorkspace, { ...props, entry: { ...props.entry, tab: 'reporting' } }), view.container))
			await waitFor(() => expect(view.container.textContent).toContain('Add to calendar'), simulationWaitOptions)
		} finally {
			await backend.dispose()
		}
	},
	simulationSetupTimeoutMs,
)
