import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { usePortfolio } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolio.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, owner, portfolio } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
const lifecycle = installDomTestLifecycle({ url: `https://example.test/#/portfolios?portfolio=${portfolio}&owner=${owner}`, afterTest: resetActiveEnvironmentForTesting })
async function mount() {
	const hook = await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n })
	lifecycle.trackRendered(hook)
	return hook
}
test('permissionless question growth is paged independently of the three owner positions', async () => {
	const source = capitalClient(capitalSnapshot({ questionCount: 1_000_000n }))
	source.install()
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	expect(hook.state().snapshot?.positions).toHaveLength(1)
	expect(hook.state().snapshot?.questions).toHaveLength(64)
	await act(() => hook.state().nextQuestionPage())
	expect(hook.state().snapshot?.questionStart).toBe(64n)
	expect(source.reads.filter(read => read.name === 'getQuestions').every(read => read.args?.[1] === 64n)).toBe(true)
	expect(source.reads.some(read => read.name === 'getLogs')).toBe(false)
})
test('an invalidated in-flight load cannot overwrite a changed universe or strand loading', async () => {
	const source = capitalClient()
	const delayed = createDeferred<number>()
	let first = true
	const client = source.client.extend(() => ({
		getChainId: async () => {
			if (first) {
				first = false
				return delayed.promise
			}
			return 1
		},
	}))
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
	const hook = await mount()
	await waitFor(() => expect(hook.state().loading).toBe(true))
	await act(() => hook.state().setUniverseInput('2'))
	source.setSnapshot(capitalSnapshot({ universeId: 2n }))
	await act(() => hook.state().load())
	expect(hook.state().snapshot?.universeId).toBe(2n)
	await act(() => delayed.resolve(1))
	expect(hook.state().snapshot?.universeId).toBe(2n)
	expect(hook.state().loading).toBe(false)
})
test('disabling clears pending views and re-enabling authenticates a fresh account', async () => {
	const source = capitalClient()
	source.install()
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	await hook.setProps({ enabled: false })
	expect(hook.state().snapshot).toBeUndefined()
	expect(hook.state().loading).toBe(false)
	await hook.setProps({ enabled: true })
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	expect(hook.state().snapshot?.owner).toBe(owner)
})
test('a newly created portfolio can load before any question exists', async () => {
	const source = capitalClient(capitalSnapshot({ questionCount: 0n, questions: [], positions: [], ownerAccount: { ...capitalSnapshot().ownerAccount, positions: [0n, 0n, 0n] } }))
	source.install()
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	expect(hook.state().snapshot?.questions).toEqual([])
	expect(hook.state().error).toBeUndefined()
})

test('partial setup loads without touching undeployed capital and resumes on refresh', async () => {
	const source = capitalClient()
	source.setSetupStage(1n)
	source.install()
	const hook = await mount()
	await waitFor(() => expect(hook.state().setup?.stage).toBe(1))
	expect(hook.state().snapshot).toBeUndefined()
	expect(source.reads.some(read => read.name === 'capitalLedger')).toBe(false)
	source.setSetupStage(3n)
	await act(() => hook.state().refresh())
	expect(hook.state().snapshot?.capitalLedger).toBeDefined()
})

test('remembered portfolios stay scoped to their genesis REP deployment', async () => {
	const source = capitalClient()
	source.install()
	const yes = await mount()
	await waitFor(() => expect(yes.state().snapshot).toBeDefined())
	await yes.cleanup()
	window.history.replaceState({}, '', '#/portfolios')
	installActiveEnvironmentForTesting({
		...source.backend,
		profile: { ...source.backend.profile, genesisOutcome: 'no', genesisRepTokenAddress: '0x00000000000000000000000000000000000000b2' },
	})
	const no = await mount()
	expect(no.state().managerInput).toBe('')
	expect(no.state().snapshot).toBeUndefined()
	await no.cleanup()
	source.install()
	const restored = await mount()
	await waitFor(() => expect(restored.state().snapshot).toBeDefined())
	expect(restored.state().managerInput).toBe(portfolio)
})

test('switching genesis while mounted clears the prior selection and restores only that root’s saved portfolio', async () => {
	const source = capitalClient()
	source.install()
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	installActiveEnvironmentForTesting({
		...source.backend,
		profile: { ...source.backend.profile, genesisOutcome: 'no', genesisRepTokenAddress: '0x00000000000000000000000000000000000000b2' },
	})
	await hook.setProps({ environmentKey: 1 })
	expect(hook.state().managerInput).toBe('')
	expect(hook.state().snapshot).toBeUndefined()
	source.install()
	await hook.setProps({ environmentKey: 2 })
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	expect(hook.state().managerInput).toBe(portfolio)
})
