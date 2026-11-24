import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { useSecurityPool } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPool.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, owner, securityPool } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
const lifecycle = installDomTestLifecycle({ url: `https://example.test/#/security-pools?securityPool=${securityPool}&owner=${owner}`, afterTest: resetActiveEnvironmentForTesting })
async function mount() {
	const hook = await renderHookWithProps(useSecurityPool, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n })
	lifecycle.trackRendered(hook)
	return hook
}
test('the bare simulation route opens the seeded security pool without querying logs', async () => {
	window.history.replaceState({}, '', '#/security-pools')
	const source = capitalClient()
	let logRequests = 0
	const client = source.client.extend(() => ({
		getLogs: async () => {
			logRequests++
			return []
		},
	}))
	installActiveEnvironmentForTesting({ ...source.backend, id: 'simulation', seededSecurityPool: { address: securityPool, questionIds: [] }, createReadClient: () => client })
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot?.securityPool).toBe(securityPool))
	expect(logRequests).toBe(0)
})
test('a wallet switch updates an automatic owner and preserves an explicit selection', async () => {
	window.history.replaceState({}, '', '#/security-pools')
	capitalClient().install()
	const hook = await mount()
	expect(hook.state().ownerInput).toBe(owner)
	await hook.setProps({ accountAddress: securityPool })
	await waitFor(() => expect(hook.state().ownerInput).toBe(securityPool))
	await act(() => hook.state().setOwnerInput(owner))
	await hook.setProps({ accountAddress: undefined })
	expect(hook.state().ownerInput).toBe(owner)
})

test('permissionless question growth is paged independently of the owner’s single position', async () => {
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
test('a failed account read for another owner keeps the active security pool setup', async () => {
	const source = capitalClient()
	let failBalance = false
	const client = source.client.extend(() => ({
		getBalance: async () => {
			if (failBalance) throw new Error('No fork url set')
			return 0n
		},
	}))
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	expect(hook.state().setup?.stage).toBe(4)
	failBalance = true
	await act(() => hook.state().load())
	await waitFor(() => expect(hook.state().error).toContain('No fork url set'))
	expect(hook.state().snapshot).toBeUndefined()
	expect(hook.state().setup?.stage).toBe(4)
})
const unchangedInputs = [
	{ name: 'securityPool', repeat: (model: ReturnType<typeof useSecurityPool>) => model.setManagerInput(model.managerInput) },
	{ name: 'owner', repeat: (model: ReturnType<typeof useSecurityPool>) => model.setOwnerInput(model.ownerInput) },
	{ name: 'universe', repeat: (model: ReturnType<typeof useSecurityPool>) => model.setUniverseInput(model.universeInput) },
]
for (const input of unchangedInputs) {
	test(`repeating the current ${input.name} input preserves the loaded security pool`, async () => {
		capitalClient().install()
		const hook = await mount()
		await waitFor(() => expect(hook.state().snapshot).toBeDefined())
		const snapshot = hook.state().snapshot
		const setup = hook.state().setup
		await act(() => input.repeat(hook.state()))
		expect(hook.state().snapshot).toBe(snapshot)
		expect(hook.state().setup).toBe(setup)
		expect(hook.state().loading).toBe(false)
	})
	test(`repeating the current ${input.name} input preserves an in-flight security pool load`, async () => {
		const source = capitalClient()
		const delayed = createDeferred<number>()
		const client = source.client.extend(() => ({ getChainId: () => delayed.promise }))
		installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
		const hook = await mount()
		await waitFor(() => expect(hook.state().loading).toBe(true))
		try {
			await act(() => input.repeat(hook.state()))
			expect(hook.state().loading).toBe(true)
			await act(() => delayed.resolve(1))
			await waitFor(() => expect(hook.state().snapshot).toBeDefined())
			expect(hook.state().loading).toBe(false)
		} finally {
			delayed.resolve(1)
		}
	})
}
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
test('a newly created security pool can load before any question exists', async () => {
	const source = capitalClient(capitalSnapshot({ questionCount: 0n, questions: [], positions: [], ownerPrincipalAttoRep: 0n, ownerCommitmentAttoEth: 0n, withdrawableAttoRep: 0n, ownerAccount: { ...capitalSnapshot().ownerAccount, positionId: 0n } }))
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
	expect(hook.state().setup?.stage).toBe(3)
	expect(hook.state().snapshot).toBeUndefined()
	expect(source.reads.some(read => read.name === 'capitalLedger')).toBe(false)
	source.setSetupStage(4n)
	await act(() => hook.state().refresh())
	expect(hook.state().snapshot?.capitalLedger).toBeDefined()
})

test('remembered security pools stay scoped to their genesis REP deployment', async () => {
	const source = capitalClient()
	source.install()
	const yes = await mount()
	await waitFor(() => expect(yes.state().snapshot).toBeDefined())
	await yes.cleanup()
	window.history.replaceState({}, '', '#/security-pools')
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
	expect(restored.state().managerInput).toBe(securityPool)
})

test('switching genesis while mounted clears the prior selection and restores only that root’s saved security pool', async () => {
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
	expect(hook.state().managerInput).toBe(securityPool)
})

test('same-context authentication preserves presentation only and replaces it with resolved removal', async () => {
	const source = capitalClient()
	const gate = createDeferred<number>()
	let pause = false
	const client = source.client.extend(() => ({ getChainId: () => (pause ? gate.promise : Promise.resolve(1)) }))
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	const previous = hook.state().snapshot
	await hook.setProps({ enabled: false })
	expect(hook.state().snapshot).toBeUndefined()
	expect(hook.state().presentationSnapshot).toBe(previous)
	pause = true
	await hook.setProps({ enabled: true })
	expect(hook.state().snapshot).toBeUndefined()
	expect(hook.state().presentationSnapshot).toBe(previous)
	expect(hook.state().loading).toBe(true)
	source.setSnapshot(capitalSnapshot({ positions: [], ownerCommitmentAttoEth: 0n, ownerAccount: { ...capitalSnapshot().ownerAccount, positionId: 0n } }))
	await act(() => gate.resolve(1))
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	expect(hook.state().presentationSnapshot).toBe(hook.state().snapshot)
	expect(hook.state().presentationSnapshot?.positions).toEqual([])
})

test.each(['failure', 'incomplete setup'])('retained presentation distinguishes a %s from verified account data', async result => {
	const source = capitalClient()
	let fail = false
	const client = source.client.extend(() => ({
		getChainId: async () => {
			if (fail) throw new Error('Account read failed.')
			return 1
		},
	}))
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	await hook.setProps({ enabled: false })
	expect(hook.state().presentationSnapshot).toBeDefined()
	if (result === 'failure') fail = true
	else source.setSetupStage(1n)
	await hook.setProps({ enabled: true })
	await waitFor(() => expect(hook.state().loading).toBe(false))
	expect(hook.state().snapshot).toBeUndefined()
	if (result === 'failure') {
		expect(hook.state().error).toContain('Account read failed.')
		expect(hook.state().presentationSnapshot).toBeDefined()
	} else {
		expect(hook.state().setup?.stage).toBe(1)
		expect(hook.state().presentationSnapshot).toBeUndefined()
	}
})

test.each(['securityPool', 'owner', 'universe', 'environment', 'backend replacement', 'backend reinstall', 'bootstrap reset'])('changing %s clears retained presentation immediately', async change => {
	const source = capitalClient()
	const backend = { ...source.backend, isBootstrapped: true, isBootstrapping: false }
	installActiveEnvironmentForTesting(backend)
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	await hook.setProps({ enabled: false })
	expect(hook.state().presentationSnapshot).toBeDefined()
	if (change === 'securityPool') await act(() => hook.state().setManagerInput(owner))
	else if (change === 'owner') await act(() => hook.state().setOwnerInput(securityPool))
	else if (change === 'universe') await hook.setProps({ activeUniverseId: 1n })
	else if (change === 'environment') await hook.setProps({ environmentKey: 1 })
	else {
		if (change === 'backend replacement') installActiveEnvironmentForTesting({ ...backend })
		else if (change === 'backend reinstall') installActiveEnvironmentForTesting(backend)
		else backend.isBootstrapping = true
		await hook.setProps({ enabled: false, accountAddress: securityPool })
	}
	expect(hook.state().snapshot).toBeUndefined()
	expect(hook.state().presentationSnapshot).toBeUndefined()
})

test('an in-place backend reset clears presentation and suspends account reads until bootstrap completes', async () => {
	const source = capitalClient()
	let loads = 0
	const client = source.client.extend(() => ({
		getChainId: async () => {
			loads++
			return 1
		},
	}))
	const backend = { ...source.backend, createReadClient: () => client, isBootstrapped: true, isBootstrapping: false }
	installActiveEnvironmentForTesting(backend)
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	const previousLoads = loads
	backend.isBootstrapping = true
	await hook.setProps({ accountAddress: securityPool })
	await act(() => hook.state().load())
	expect(loads).toBe(previousLoads)
	expect(hook.state().snapshot).toBeUndefined()
	expect(hook.state().presentationSnapshot).toBeUndefined()
	backend.isBootstrapping = false
	await hook.setProps({ accountAddress: owner })
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	expect(loads).toBeGreaterThan(previousLoads)
})

test('authentication refresh preserves a manually selected universe independently of the global universe', async () => {
	const source = capitalClient()
	source.install()
	const hook = await mount()
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	source.setSnapshot(capitalSnapshot({ universeId: 2n }))
	await act(() => hook.state().setUniverseInput('2'))
	await act(() => hook.state().load())
	expect(hook.state().snapshot?.universeId).toBe(2n)
	await hook.setProps({ enabled: false })
	expect(hook.state().universeInput).toBe('2')
	expect(hook.state().snapshot).toBeUndefined()
	expect(hook.state().presentationSnapshot?.universeId).toBe(2n)
	await hook.setProps({ enabled: true })
	await waitFor(() => expect(hook.state().snapshot).toBeDefined())
	expect(hook.state().universeInput).toBe('2')
	expect(hook.state().snapshot?.universeId).toBe(2n)
})
