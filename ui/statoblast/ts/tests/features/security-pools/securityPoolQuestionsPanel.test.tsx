import { expect, spyOn, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { localEntityScopeForNetwork, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { createBlockWithTimestamp, createMulticallStub, getContractFunctionName } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { SecurityPoolQuestionsPanel } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolQuestionsPanel.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { statoblastDisplayCache } from '@zoltar/ui-statoblast-shared/protocol/statoblastPageCache.js'
import { decodeWatchlistRows } from '@zoltar/ui-statoblast-shared/protocol/watchlistRows.js'
import { capitalClient } from './capitalClient.js'
import { securityPool, owner, token } from './capitalFixture.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })

test('the approved question page verifies only its visible IDs and offers a checked registration action', async () => {
	const source = capitalClient()
	let registered = false
	const readIds: unknown[] = []
	const readClient = source.client.extend(() => ({
		getBlock: async () => ({ ...createBlockWithTimestamp(1n), number: 10n }),
		multicall: createMulticallStub(async ({ contracts }) =>
			contracts.map(contract => {
				const [id] = contract.args ?? []
				switch (getContractFunctionName(contract)) {
					case 'isSecurityPool':
						return { status: 'success', result: true }
					case 'getQuestionLedger':
						readIds.push(id)
						return id === 8n && !registered ? { status: 'failure', error: new Error('Multicall contract call failed: execution reverted: Question not registered') } : { status: 'success', result: token }
					case 'questions':
						return { status: 'success', result: [id === 8n ? 'Can this be registered?' : 'Already registered', '', 1n, 1000n, 0n, 0n, 0n, ''] }
					case 'getOutcomeLabels':
						return { status: 'success', result: ['Yes', 'No'] }
					default:
						throw new Error('Unexpected read of an approved question')
				}
			}),
		),
	}))
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => readClient })
	installStatoblastRouting()
	const sent: bigint[] = []
	const actions = testDouble<Parameters<typeof SecurityPoolQuestionsPanel>[0]['actions']>({
		questionInput: '',
		approvedRegistrationReason: () => undefined,
		register: async (id?: bigint) => {
			if (id !== undefined) sent.push(id)
			registered = true
		},
	})
	const admission = { address: token, mode: 'fixed' as const, questionStart: 0n, questionCount: 70n, questions: [8n, 9n] }
	const view = lifecycle.trackRendered(
		await renderIntoDocument(<SecurityPoolQuestionsPanel pool={securityPool} owner={owner} universeId={0n} enabled environmentKey={0} actions={actions} admission={admission} onPreviousApprovedPage={() => undefined} onNextApprovedPage={() => undefined} registerPageRefresh={undefined} />),
	)
	const approved = [...view.container.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === 'Approved questions')
	const row = () => [...(approved?.querySelectorAll('tbody tr') ?? [])].find(row => row.textContent?.includes('Can this be registered?'))
	await waitFor(() => expect(row()?.querySelector('button.tx-action-button')?.textContent).toBe('Register question'))
	expect(approved?.textContent).toContain('Already registered')
	expect(readIds).toEqual([8n, 9n])
	await act(() => row()?.querySelector<HTMLButtonElement>('button.tx-action-button')?.click())
	await waitFor(() => expect(row()?.textContent).toContain('Registered'))
	expect(sent).toEqual([8n])
})

test('removing a saved pool question warns when REP is staked and the wallet holds no shares', async () => {
	const backend = createFakeBackend({ accountAddress: owner })
	installActiveEnvironmentForTesting(backend)
	installStatoblastRouting()
	const questionId = 8n
	const id = `${securityPool}:${formatQuestionIdHex(questionId)}`
	setEntityFavorite(localEntityScopeForNetwork(backend.profile, 'statoblast', 'question'), id, true)
	const cache = statoblastDisplayCache(backend.profile, { universeId: 0n, owner, page: 'watchlist' }, decodeWatchlistRows)
	cache.write([{ entity: { id, kind: 'question', pool: securityPool, questionId }, status: 'question', reportingPrincipal: 4n, shares: { yesAttoShares: 0n, noAttoShares: 0n, invalidAttoShares: 0n } }], { number: 1n, timestamp: 1n })
	const actions = testDouble<Parameters<typeof SecurityPoolQuestionsPanel>[0]['actions']>({ questionInput: '' })
	const confirmation = spyOn(window, 'confirm').mockReturnValue(false)
	try {
		const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolQuestionsPanel pool={securityPool} owner={owner} universeId={0n} enabled={false} environmentKey={0} actions={actions} admission={undefined} registerPageRefresh={undefined} />))
		const saved = () => view.container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
		await waitFor(() => expect(saved()).not.toBeNull())
		await act(() => saved()?.click())
		expect(confirmation).toHaveBeenCalledTimes(1)
		expect(saved()).not.toBeNull()
	} finally {
		confirmation.mockRestore()
	}
})
