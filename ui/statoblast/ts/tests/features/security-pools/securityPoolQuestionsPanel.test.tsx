import { expect, spyOn, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { localEntityScopeForNetwork, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { SecurityPoolQuestionsPanel } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolQuestionsPanel.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { statoblastDisplayCache } from '@zoltar/ui-statoblast-shared/protocol/statoblastPageCache.js'
import { decodeWatchlistRows } from '@zoltar/ui-statoblast-shared/protocol/watchlistRows.js'
import { securityPool, owner } from './capitalFixture.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })

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
