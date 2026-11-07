import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { usePortfolioQuestionDetails } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioQuestionDetails.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
test('question text loads before an amount, supports off-page IDs and clears on context changes', async () => {
	const snapshot = capitalSnapshot({ questions: [999n] })
	const source = capitalClient(snapshot)
	source.setRead('questions', ['Same title', 'Resolve Yes only if the official result confirms it.', 0n, 10000n, 0n, 0n, 0n, ''])
	source.setRead('questionCreatedTimestamp', 1n)
	source.setRead('getOutcomeLabels', ['No', 'Yes'])
	source.install()
	const hook = await renderHookWithProps((props: { snapshot: typeof snapshot | undefined; input: string }) => usePortfolioQuestionDetails(props.snapshot, props.input), { snapshot, input: '999' })
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().selected?.question?.title).toBe('Same title'))
	expect(hook.state().selected?.question?.description).toContain('official result')
	expect(hook.state().selected?.question?.questionId).toBe('0x3e7')
	await hook.setProps({ snapshot, input: '1000' })
	await waitFor(() => expect(hook.state().selected?.question?.questionId).toBe('0x3e8'))
	expect(hook.state().entries?.size).toBe(2)
	await hook.setProps({ snapshot: undefined, input: '1000' })
	expect(hook.state().selected).toBeUndefined()
})

test('missing metadata offers retry and recovers without changing the selected ID', async () => {
	const snapshot = capitalSnapshot({ questions: [999n] })
	const source = capitalClient(snapshot)
	source.setRead('questions', ['', '', 0n, 0n, 0n, 0n, 0n, ''])
	source.setRead('questionCreatedTimestamp', 0n)
	source.install()
	const hook = await renderHookWithProps(() => usePortfolioQuestionDetails(snapshot, '999'), {})
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().selected?.error).toContain('unavailable'))
	source.setRead('questions', ['Recovered title', 'Description', 0n, 10000n, 0n, 0n, 0n, ''])
	source.setRead('getOutcomeLabels', ['No', 'Yes'])
	await act(() => hook.state().retry())
	await waitFor(() => expect(hook.state().selected?.question?.title).toBe('Recovered title'))
	expect(hook.state().selectedId).toBe(999n)
})
