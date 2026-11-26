import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createPublicClient, http, zeroAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { useZoltarUniverse, type UseZoltarUniverseDependencies } from '@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarUniverse.js'

const { trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: zeroAddress, installActiveEnvironment: installActiveEnvironmentForTesting })

test('reconciles replaced page identities and revalidates exact lookups (#1751)', async () => {
	const first = createMarketDetails({ questionId: '0x1' })
	const replacement = createMarketDetails({ questionId: '0x2' })
	let current = first
	const dependencies = testDouble<UseZoltarUniverseDependencies>({
		createConnectedReadClient: () => createPublicClient({ transport: http('http://127.0.0.1:8545') }),
		loadZoltarQuestionCount: async () => 1n,
		loadZoltarQuestionPage: async () => ({ pageIndex: 0, pageSize: 1, questionCount: 1n, questions: [current] }),
		loadMarketDetails: async () => ({ ...first, exists: false }),
	})
	let state: ReturnType<typeof useZoltarUniverse> | undefined
	function Harness() {
		state = useZoltarUniverse(
			{
				accountAddress: zeroAddress,
				activeUniverseId: 1n,
				autoLoadInitialData: false,
				deploymentStatuses: [{ address: zeroAddress, dependencies: [], deploy: async () => zeroHash, deployed: true, id: 'zoltar', label: 'Zoltar' }],
				environmentRefreshKey: 77,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
			},
			dependencies,
		)
		return <div />
	}
	trackCleanup((await renderIntoDocument(<Harness />)).cleanup)
	await act(async () => await requireHookState(state).loadZoltarQuestionPage(0, 1))
	current = replacement
	await act(async () => await requireHookState(state).loadZoltarQuestionPage(0, 1))
	expect(requireHookState(state).zoltarQuestions).toEqual([replacement])
	current = first
	await act(async () => await requireHookState(state).loadZoltarQuestionPage(0, 1))
	await act(async () => await requireHookState(state).loadZoltarQuestion('0x1'))
	expect(requireHookState(state).zoltarQuestions).toEqual([])
})
