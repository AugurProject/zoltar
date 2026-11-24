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
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import type { RegisterStatoblastPageRefresh, ReportStatoblastReadStatus } from '@zoltar/ui-statoblast-shared/features/useStatoblastPageRefresh.js'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { statoblastDisplayCache } from '@zoltar/ui-statoblast-shared/protocol/statoblastPageCache.js'

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
			let balanceRead: ReturnType<typeof createDeferred<void>> | undefined
			let reportingRead: ReturnType<typeof createDeferred<void>> | undefined
			let detailsReadStarted = false
			const client = backend.createReadClient()
			const readContract: typeof client.readContract = async request => {
				if (offline && request.functionName === 'initialReportPriorityFeeAttoEthPerGas') throw new Error('Temporary question read failure.')
				if (request.functionName === 'balanceOfShares' && balanceRead !== undefined) {
					detailsReadStarted = true
					await balanceRead.promise
				}
				return await client.readContract(request)
			}
			const multicall: typeof client.multicall = async request => {
				if (reportingRead !== undefined && request.contracts.some(call => call.functionName === 'initialEscalationGameDepositAttoRep')) {
					detailsReadStarted = true
					await reportingRead.promise
				}
				return await client.multicall(request)
			}
			installActiveEnvironmentForTesting({ ...backend, createReadClient: () => client.extend(() => ({ readContract, multicall })) })
			installStatoblastRouting()
			window.history.replaceState({}, '', `#/pool/${pool.address}/question/${questionId}/shares?simulate=1&genesis=yes&simScenario=securitypoolx2`)
			const deployments: DeploymentStatus[] = [{ address: zeroAddress, dependencies: [], deploy: async () => zeroAddress, deployed: true, id: 'proxyDeployer', label: 'proxyDeployer' }]
			let refresh: (() => Promise<unknown>) | undefined
			let status: { readAt: number | undefined; progress: string | undefined } | undefined
			const registerPageRefresh: RegisterStatoblastPageRefresh = callback => {
				refresh = callback
				return () => {
					refresh = undefined
				}
			}
			const onReadStatus: ReportStatoblastReadStatus = (readAt, progress) => {
				status = { readAt, progress }
			}
			const props = {
				parameters: { ...callbacks, accountAddress: owner },
				accountState: createAccountState({ address: owner, chainId: backend.profile.chainIdHex }),
				deploymentStatuses: deployments,
				registerPageRefresh,
				onReadStatus,
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
			const checkDetailsFailure = async (gate: ReturnType<typeof createDeferred<void>>, assertVisible: () => void, fail: string) => {
				if (refresh === undefined || status?.readAt === undefined) throw new Error('Missing verified question refresh status')
				const previousReadAt = status.readAt
				detailsReadStarted = false
				let completed = false
				const pending = refresh().then(() => {
					completed = true
				})
				await waitFor(() => expect(status?.progress).toBe('Refreshing… 2 of 2'), simulationWaitOptions)
				await waitFor(() => expect(detailsReadStarted).toBe(true), simulationWaitOptions)
				expect(status?.readAt).toBe(previousReadAt)
				assertVisible()
				expect(completed).toBe(false)
				gate.reject(new Error(fail))
				await pending
				await waitFor(() => expect(view.container.textContent).toMatch(/Couldn’t refresh, showing data from \d+s ago\./), simulationWaitOptions)
				assertVisible()
				expect(view.container.textContent).toContain(fail)
				expect(status?.readAt).toBe(previousReadAt)
			}
			const assertSharesVisible = () => expect(view.container.textContent).toContain('1.00 sets')
			await waitFor(assertSharesVisible, simulationWaitOptions)
			await waitFor(() => expect(status?.progress).toBeUndefined(), simulationWaitOptions)
			const sharesCache = statoblastDisplayCache(backend.profile, { universeId: 0n, owner, page: `shares:${pool.address}:${questionId}:0` }, value => value)
			const savedBalances = sharesCache.read()
			if (savedBalances === undefined) throw new Error('Missing saved share balances')
			balanceRead = createDeferred<void>()
			await checkDetailsFailure(balanceRead, assertSharesVisible, 'Share balances temporarily unavailable.')
			expect(sharesCache.read()).toEqual(savedBalances)
			balanceRead = undefined
			await clickRetry()
			await waitFor(() => expect(view.container.textContent).not.toContain('showing data from'), simulationWaitOptions)
			await act(() => render(h(SecurityPoolQuestionWorkspace, { ...props, entry: { ...props.entry, tab: 'reporting' } }), view.container))
			const assertReportingVisible = () => expect(view.container.querySelector('.statoblast-report-banner')).not.toBeNull()
			await waitFor(assertReportingVisible, simulationWaitOptions)
			await waitFor(() => expect(status?.progress).toBeUndefined(), simulationWaitOptions)
			reportingRead = createDeferred<void>()
			await checkDetailsFailure(reportingRead, assertReportingVisible, 'Reporting details temporarily unavailable.')
			reportingRead = undefined
			await clickRetry()
			await waitFor(() => expect(view.container.textContent).not.toContain('showing data from'), simulationWaitOptions)
		} finally {
			await backend.dispose()
		}
	},
	simulationSetupTimeoutMs,
)
