import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { SecurityPoolSharedFork } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolSharedFork.js'
import * as forkCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolSharedFork.js'
import { expect, spyOn, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { decodeFunctionData, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { getActiveBackend, installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { localEntityScopeForNetwork, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { unscopedTransaction } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { useSecurityPoolSharedFork, type SecurityPoolSharedForkParameters } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolSharedFork.js'
import type { SecurityPoolTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
import { getInfraContractAddresses } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, token, capital, owner, unit } from './capitalFixture.js'
import { capitalClient, modules } from './capitalClient.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
async function setup() {
	const snapshot = capitalSnapshot({ forkTime: 900n })
	const source = capitalClient(snapshot)
	let chosen = false
	let prepared = true
	let started = false
	let ready = false
	let forkReadError: Error | undefined
	let readDelay = 0
	const client = source.client.extend(() =>
		createMockReadClient(async request => {
			if (request.functionName === 'getForkChoiceDeadline' && forkReadError !== undefined) throw forkReadError
			if (readDelay > 0 && (request.functionName === 'getForkChoiceDeadline' || request.functionName === 'getChildUniverseId')) await Bun.sleep(readDelay)
			const values: Record<string, unknown> = {
				getForkChoiceDeadline: 2_000n,
				getForkRecapitalizationDeadline: 3_000n,
				forks: [100n * unit, 20n * unit, 10n * unit, 10n * unit, 2n * unit, 0n, 0n, 0n, true, false, true],
				choices: [1n, chosen],
				getChildUniverseId: 42n,
				getRepToken: token,
				branches: [0n, 1n, 0n, 0n, 0n, 100n * unit, prepared || chosen, started, ready],
				universes: [900n, 7n, 0n, false, 0n],
				zoltarQuestionData: token,
				questions: ['Fork question', 0n, 0n, 0n, 0n, 0n, 0n, ''],
				getOutcomeLabels: ['Yes'],
			}
			if (request.functionName in values) return values[request.functionName]
			return source.client.readContract(request)
		}),
	)
	installActiveEnvironmentForTesting({ ...source.backend, createReadClient: () => client })
	const requests: SecurityPoolTransaction[] = []
	const opened: bigint[] = []
	const actions = {
		scope: unscopedTransaction,
		busy: undefined,
		ownerReason: undefined,
		runSecurityPoolAction: async (_a: string, _t: string, build: () => SecurityPoolTransaction | Promise<SecurityPoolTransaction>) => {
			requests.push(await build())
		},
	}
	const parameters: SecurityPoolSharedForkParameters = {
		snapshot,
		actions,
		bidder: owner,
		openUniverse: (universe: bigint) => {
			opened.push(universe)
		},
	}
	const hook = await renderHookWithProps(useSecurityPoolSharedFork, parameters)
	lifecycle.trackRendered(hook)
	await act(() => hook.state().setOutcome('1'))
	await waitFor(() => expect(hook.state().state?.branch).toBeDefined())
	return {
		hook,
		requests,
		parameters,
		source,
		snapshot,
		opened,
		setForkReadError: (error: Error | undefined) => {
			forkReadError = error
		},
		setReadDelay: (milliseconds: number) => {
			readDelay = milliseconds
		},
		setChosen: (v: boolean) => {
			chosen = v
		},
		setPrepared: (value: boolean) => {
			prepared = value
		},
		setStarted: (v: boolean) => {
			started = v
		},
		setReady: (v: boolean) => {
			ready = v
		},
	}
}

/** Fills question 7, two shares to `capital`, and 1/2/3 Invalid/Yes/No rights; call inside one `act`. */
function fillMigrationDraft(hook: Awaited<ReturnType<typeof setup>>['hook']) {
	hook.state().setQuestion('7')
	hook.state().setShares('2')
	hook.state().setRecipient(capital)
	hook.state().setInvalidRights('1')
	hook.state().setYesRights('2')
	hook.state().setNoRights('3')
}
test('a previously verified branch identifies its saved views before live fork data returns', async () => {
	const { hook, parameters, snapshot, setChosen } = await setup()
	const branch = hook.state().state?.branch
	if (branch === undefined) throw new Error('Missing verified branch')
	setChosen(true)
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'aa'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.choice.recorded).toBe(true))
	const restored = await renderHookWithProps(useSecurityPoolSharedFork, { ...parameters, snapshot: undefined, presentationSnapshot: snapshot })
	lifecycle.trackRendered(restored)
	expect(restored.state().savedBranch?.universeId).toBe(branch.universeId)
	expect(restored.state().displayedState?.choice).toEqual({ recorded: true, outcomeIndex: 1n })
	expect(restored.state().displayedAt).toBeGreaterThan(0)
	await act(() => restored.state().setOutcome('1'))
	expect(restored.state().state).toBeUndefined()
	expect(restored.state().savedBranch?.universeId).toBe(branch.universeId)
	expect(restored.state().chooseReason).toContain('Checking fork status')
	await act(() => restored.state().setOutcome('2'))
	expect(restored.state().savedBranch).toBeUndefined()
})

test('the fork banner records a choice for the wallet’s own position only', async () => {
	const fixture = await setup()
	fixture.setChosen(true)
	const choices: boolean[] = []
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolSharedFork {...fixture.parameters} bidder={token} onBranchCommitted={choice => choices.push(choice)} />))
	await waitFor(() => expect(view.container.textContent).toContain(forkCopy.chosen(1n)))
	await act(() => Bun.sleep(25))
	expect(choices).toEqual([])
})

test('a failed fork question read keeps the chooser visible with a retry', async () => {
	const fixture = await setup()
	let retries = 0
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolSharedFork {...fixture.parameters} redesigned forkQuestionRead={{ loading: false, error: 'RPC could not load the fork question.', retry: () => retries++ }} />))
	await waitFor(() => expect(view.container.textContent).toContain('RPC could not load the fork question.'))
	const retry = [...view.container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Try again')
	await act(() => retry?.click())
	expect(retries).toBe(1)
})

test('the scalar fork diagram exposes every valid outcome in bounded pages', async () => {
	const fixture = await setup()
	const question = { title: 'Scalar fork', description: '', marketType: 'scalar' as const, outcomeLabels: [], questionId: '0x7', createdAt: 1n, exists: true, startTime: 1n, endTime: 800n, displayValueMin: -2n * unit, displayValueMax: 5n * unit, numTicks: 7n, answerUnit: '' }
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolSharedFork {...fixture.parameters} redesigned forkQuestion={question} />))
	const figure = () => view.container.querySelector('figure.statoblast-fork-diagram')
	const labels = () => [...(figure()?.querySelectorAll('li strong') ?? [])].map(label => label.textContent)
	await waitFor(() => expect(labels()).toEqual(['Invalid', '-2', '-1', '0', '1', '2']))
	const next = [...(figure()?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Next page')
	await act(() => next?.click())
	expect(labels()).toEqual(['3', '4', '5'])
	expect(next?.getAttribute('aria-disabled') === 'true' || next?.disabled).toBe(true)
})

test('redesigned branch steps keep seven rows and show confirmed progress after reloading', async () => {
	const fixture = await setup()
	fixture.setChosen(true)
	fixture.setStarted(true)
	fixture.setReady(true)
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolSharedFork {...fixture.parameters} redesigned />))
	const steps = () => [...view.container.querySelectorAll('.statoblast-fork-workflow > li')]
	await waitFor(() => expect(steps().filter(step => step.getAttribute('data-done') === 'true')).toHaveLength(4))
	expect(steps()).toHaveLength(7)
	for (const index of [0, 1, 2, 5]) {
		expect(steps()[index]?.textContent).toContain('Done')
		const button = steps()[index]?.querySelector('button')
		expect(button?.disabled === true || button?.getAttribute('aria-disabled') === 'true').toBe(true)
	}
	expect(view.container.textContent?.match(/Recapitalization deadline/g)).toHaveLength(1)
	expect(steps()[3]?.querySelector('.statoblast-price-summary')).not.toBeNull()
	expect(steps()[4]?.querySelector('h4')?.textContent).toContain('auction')
})

test('the choice page states that missing the deadline ends the commitment', async () => {
	const fixture = await setup()
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolSharedFork {...fixture.parameters} redesigned />))
	await waitFor(() => expect(view.container.textContent).toContain('your commitment ends'))
	expect(view.container.textContent).toContain('claimants in every branch')
})

test('a fork choice becomes neutral at the deadline and closes after verifying the block', async () => {
	const fixture = await setup()
	const nearDeadline = { ...fixture.snapshot, timestamp: 1_999n }
	fixture.source.setSnapshot(nearDeadline)
	const view = lifecycle.trackRendered(await renderIntoDocument(<SecurityPoolSharedFork {...fixture.parameters} snapshot={nearDeadline} redesigned />))
	await waitFor(() => expect(view.container.textContent).toContain('1s left'))
	fixture.source.setSnapshot({ ...nearDeadline, timestamp: 2_000n })
	fixture.setReadDelay(250)
	await waitFor(() => expect(view.container.textContent).toContain('Ended · checking…'), { timeout: 3_000 })
	expect(view.container.textContent).not.toContain('1s left')
	await waitFor(() => expect(view.container.textContent).toContain('Branch choice closed'))
	expect(view.container.textContent).not.toContain('Ended · checking…')
})

test('a failed fork refresh retains the completed steps and visibly retries the verified read', async () => {
	const { hook, snapshot, setForkReadError } = await setup()
	expect(hook.state().displayedState?.branch?.prepared).toBe(true)
	setForkReadError(new Error('Fork data unavailable'))
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'21'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().forkError).toContain('Fork data unavailable'))
	expect(hook.state().displayedState?.branch?.prepared).toBe(true)
	expect(hook.state().state).toBeUndefined()
	setForkReadError(undefined)
	await act(() => {
		hook.state().retryFork()
	})
	await waitFor(() => expect(hook.state().state?.branch?.prepared).toBe(true))
	expect(hook.state().forkError).toBeUndefined()
})

test('successive fork RPC reads keep the verified steps usable for display beyond one request timeout', async () => {
	const shortened = new Proxy(globalThis.setTimeout, {
		apply(schedule, receiver, [handler, delay, ...args]) {
			return Reflect.apply(schedule, receiver, [handler, delay === 15_000 ? 460 : delay, ...args])
		},
	})
	const timer = spyOn(globalThis, 'setTimeout').mockImplementation(shortened)
	try {
		const { hook, snapshot, setReadDelay } = await setup()
		const prepared = hook.state().displayedState?.branch
		setReadDelay(290)
		await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'42'.repeat(32)}` } })
		expect(hook.state().state).toBeUndefined()
		expect(hook.state().displayedState?.branch).toEqual(prepared)
		await waitFor(() => expect(hook.state().state?.branch?.prepared).toBe(true))
		expect(hook.state().forkError).toBeUndefined()
	} finally {
		timer.mockRestore()
	}
})

test('one irreversible choice has an explicit review and rechecks the strict native cutoff', async () => {
	const { hook, requests, source, snapshot } = await setup()
	expect(hook.state().chooseReason).toBeUndefined()
	await act(() => hook.state().choose())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Choice request missing')
	expect(request.to).toBe(modules.fork)
	expect(decodeFunctionData({ abi: parseAbi(['function choose(uint248 source,uint256 outcome)']), data: request.data })).toEqual({ functionName: 'choose', args: [0n, 1n] })
	expect(request.reviewDescription).toContain('This choice is irreversible.')
	source.setSnapshot({ ...snapshot, timestamp: 2_000n })
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('no longer available')
})
test('shared preparation waits until cutoff and activation waits until the activation deadline', async () => {
	const { hook, source, snapshot, requests } = await setup()
	expect(hook.state().startReason).toContain('choice deadline')
	expect(hook.state().finalizeReason).toContain('earliest activation time')
	source.setSnapshot({ ...snapshot, timestamp: 2_000n, blockNumber: 11n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'11'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.timestamp).toBe(2_000n))
	expect(hook.state().startReason).toBeUndefined()
	await act(() => hook.state().start())
	expect(requests).toHaveLength(1)
	expect(hook.state().state?.branch?.recoveryAttoRep).toBe(100n * unit)
})

test('a viewer can prepare, start and activate a branch using their own wallet', async () => {
	const { hook, source, snapshot, requests, parameters, setPrepared } = await setup()
	const ownerReason = 'Connect the selected owner account'
	setPrepared(false)
	await hook.setProps({ bidder: token, actions: { ...parameters.actions, ownerReason }, snapshot: { ...snapshot, blockHash: `0x${'77'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.branch?.prepared).toBe(false))
	expect(hook.state().chooseReason).toBe(ownerReason)
	await act(() => hook.state().setQuestion('7'))
	expect(hook.state().recoverReason).toBe(ownerReason)
	expect(hook.state().transferReason).toBe(ownerReason)
	expect(hook.state().prepareBranchReason).toBeUndefined()
	await act(() => hook.state().prepareBranch())

	setPrepared(true)
	source.setSnapshot({ ...snapshot, timestamp: 3_000n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'78'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.timestamp).toBe(3_000n))
	expect(hook.state().startReason).toBeUndefined()
	expect(hook.state().finalizeReason).toBeUndefined()
	await act(() => hook.state().start())
	await act(() => hook.state().finalize())
	expect(requests.map(request => request.account)).toEqual([token, token, token])
	const abi = parseAbi(['function prepareBranch(uint248 source,uint256 outcome) returns (uint248)', 'function startBranch(uint248 source,uint256 outcome) returns (uint248)', 'function finalizeBranch(uint248 child)'])
	expect(requests.map(request => decodeFunctionData({ abi, data: request.data }).functionName)).toEqual(['prepareBranch', 'startBranch', 'finalizeBranch'])
	await hook.setProps({ bidder: undefined })
	expect(hook.state().startReason).toContain('Connect a wallet')
	await expect(hook.state().start()).rejects.toThrow('Connect a wallet')
	expect(requests).toHaveLength(3)
})
test('fork drafts survive a transient snapshot reload so a prepared branch can be activated', async () => {
	const { hook, source, snapshot, requests, setStarted } = await setup()
	source.setSnapshot({ ...snapshot, timestamp: 3_001n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'44'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.timestamp).toBe(3_001n))
	await act(() => fillMigrationDraft(hook))
	const draft = { sourceInput: '0', outcomeInput: '1', questionInput: '7', sharesInput: '2', recipientInput: capital, invalidRightsInput: '1', yesRightsInput: '2', noRightsInput: '3' }
	await act(() => hook.state().start())
	expect(requests).toHaveLength(1)
	setStarted(true)
	await hook.setProps({ snapshot: undefined })
	expect(hook.state()).toMatchObject(draft)
	expect(hook.state().state).toBeUndefined()
	expect(hook.state().finalizeReason).toBe('Checking fork status…')
	await expect(hook.state().finalize()).rejects.toThrow('Checking fork status…')
	expect(requests).toHaveLength(1)
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'55'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.branch?.started).toBe(true))
	expect(hook.state()).toMatchObject(draft)
	expect(hook.state().startReason).toBe('Migration has already started for this branch.')
	expect(hook.state().finalizeReason).toBeUndefined()
	await act(() => hook.state().finalize())
	expect(requests).toHaveLength(2)
	const request = requests[1]
	if (request === undefined) throw new Error('Activation request missing')
	expect(decodeFunctionData({ abi: parseAbi(['function finalizeBranch(uint248 child)']), data: request.data })).toEqual({ functionName: 'finalizeBranch', args: [42n] })
})
test('fresh branches can prepare custody or start migration in a single transaction', async () => {
	const { hook, source, snapshot, requests, setPrepared, setStarted } = await setup()
	const refresh = async (id: string) => hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${id.repeat(32)}` } })
	setPrepared(false)
	source.setSnapshot({ ...snapshot, timestamp: 2_500n })
	await refresh('66')
	await waitFor(() => expect(hook.state().state?.branch?.prepared).toBe(false))
	expect(hook.state().prepareBranchReason).toBeUndefined()
	expect(hook.state().startReason).toBeUndefined()
	await act(() => hook.state().prepareBranch())
	const prepare = requests[0]
	if (prepare === undefined) throw new Error('Prepare branch request missing')
	expect(requests).toHaveLength(1)
	expect(decodeFunctionData({ abi: parseAbi(['function prepareBranch(uint248 source,uint256 outcome) returns (uint248)']), data: prepare.data })).toEqual({ functionName: 'prepareBranch', args: [0n, 1n] })
	await expect(prepare.validateBeforeSubmit?.()).resolves.toBeUndefined()
	setPrepared(true)
	await expect(prepare.validateBeforeSubmit?.()).rejects.toThrow('already prepared')
	setPrepared(false)
	await act(() => hook.state().start())
	const migrate = requests[1]
	if (migrate === undefined) throw new Error('Start branch request missing')
	expect(requests).toHaveLength(2)
	expect(decodeFunctionData({ abi: parseAbi(['function startBranch(uint248 source,uint256 outcome) returns (uint248)']), data: migrate.data })).toEqual({ functionName: 'startBranch', args: [0n, 1n] })
	await expect(migrate.validateBeforeSubmit?.()).resolves.toBeUndefined()
	setPrepared(true)
	setStarted(true)
	await expect(migrate.validateBeforeSubmit?.()).rejects.toThrow('already started')
	await refresh('aa')
	await waitFor(() => expect(hook.state().finalizeReason).toContain('earliest activation time'))
})
test.each([
	['securityPool', { securityPool: capital }],
	['owner', { owner: capital }],
	['universe', { universeId: 1n }],
])('fork drafts reset when the %s changes after a snapshot reload', async (_identity, changed) => {
	const { hook, snapshot } = await setup()
	await act(() => {
		hook.state().setSource('2')
		fillMigrationDraft(hook)
	})
	await hook.setProps({ snapshot: undefined })
	const next = { ...snapshot, ...changed }
	await hook.setProps({ snapshot: next })
	expect(hook.state()).toMatchObject({ sourceInput: next.universeId.toString(), outcomeInput: '', questionInput: '', sharesInput: '', recipientInput: '', invalidRightsInput: '0', yesRightsInput: '0', noRightsInput: '0' })
})
test('replacing the backend clears fork drafts even when the same security pool identity reloads', async () => {
	const { hook, snapshot } = await setup()
	await act(() => {
		hook.state().setQuestion('7')
		hook.state().setShares('2')
	})
	installActiveEnvironmentForTesting({ ...getActiveBackend() })
	await hook.setProps({ snapshot: undefined })
	expect(hook.state()).toMatchObject({ sourceInput: '', outcomeInput: '', questionInput: '', sharesInput: '' })
	await hook.setProps({ snapshot })
	expect(hook.state()).toMatchObject({ sourceInput: '0', outcomeInput: '', questionInput: '', sharesInput: '' })
})
test('fork actions distinguish invalid source input from an automatic pending read', async () => {
	const { hook, source } = await setup()
	await act(() => hook.state().setSource('invalid'))
	expect(hook.state().chooseReason).toBe('Enter a valid source universe.')
	const controller = createDeferred<typeof modules.fork>()
	source.setRead('forkController', controller.promise)
	await act(() => hook.state().setSource('0'))
	expect(hook.state().state).toBeUndefined()
	expect(hook.state().chooseReason).toBe('Checking fork status…')
	await act(() => controller.resolve(modules.fork))
	await waitFor(() => expect(hook.state().state).toBeDefined())
})
test('a recorded choice cannot be changed and a ready child opens its direct universe account', async () => {
	const { hook, setChosen, setStarted, setReady, snapshot, source, opened } = await setup()
	setChosen(true)
	setStarted(true)
	setReady(true)
	source.setSnapshot({ ...snapshot, timestamp: 3_001n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'22'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.branch?.ready).toBe(true))
	expect(hook.state().chooseReason).toContain('already recorded')
	expect(hook.state().startReason).toContain('already started')
	expect(hook.state().finalizeReason).toContain('already active')
	hook.state().open()
	expect(opened).toEqual([42n])
})

async function recoverySetup() {
	const fixture = await setup()
	fixture.source.setRead('questionOriginIds', `0x${'11'.repeat(32)}`)
	fixture.source.setRead('sourceGame', zeroAddress)
	fixture.source.setRead('getQuestionLedger', token)
	fixture.source.setRead('shareToken', token)
	fixture.source.setRead('balanceOfSecurityPoolRecoveryRights', [3n * unit, 5n * unit, 4n * unit])
	fixture.source.setRead('isSecurityPoolRecoveryEligible', true)
	await act(() => fixture.hook.state().setQuestion('7'))
	await waitFor(() => expect(fixture.hook.state().recovery?.availableShares).toBe(3n * unit))
	return fixture
}

test('share recovery opens saved questions or a submitted decimal or hexadecimal question ID', async () => {
	const fixture = await recoverySetup()
	const scope = localEntityScopeForNetwork(getActiveBackend().profile, 'statoblast', 'question')
	setEntityFavorite(scope, `${fixture.snapshot.securityPool}:0x7`, true)
	setEntityFavorite(scope, `${capital}:0x8`, true)
	const view = await renderIntoDocument(<SecurityPoolSharedFork {...fixture.parameters} redesigned />)
	lifecycle.trackRendered(view)
	const recovery = [...view.container.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === 'Recovery for share holders')
	const picker = recovery?.querySelector('select')
	if (picker === undefined || picker === null) throw new Error('Recovery question picker missing')
	expect([...picker.options].map(option => option.value)).toContain('0x7')
	expect([...picker.options].map(option => option.value)).not.toContain('0x8')
	await act(() => {
		picker.value = '0x7'
		picker.dispatchEvent(new Event('change', { bubbles: true }))
	})
	await waitFor(() => expect(recovery?.querySelector('.statoblast-recovery-rights')?.textContent).toContain('Yes'))
	const openById = [...picker.options].find(option => option.textContent === 'Use a question ID')
	if (openById === undefined) throw new Error('Open by ID option missing')
	await act(() => {
		picker.value = openById.value
		picker.dispatchEvent(new Event('change', { bubbles: true }))
	})
	const input = [...(recovery?.querySelectorAll('input') ?? [])].find(field => field.labels?.[0]?.textContent === 'Question ID')
	const form = input?.form
	if (input === undefined || form === undefined || form === null) throw new Error('Open by ID input missing')
	for (const [entered, id] of [
		['8', 8n],
		['0xf', 15n],
	] as const) {
		await act(() => {
			input.value = entered
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		const readId = () => fixture.source.reads.some(read => read.name === 'questionOriginIds' && read.args?.[0] === id)
		expect(readId()).toBe(false)
		expect(recovery?.querySelector('.statoblast-recovery-rights')).toBeNull()
		await act(() => {
			form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
		})
		await waitFor(() => expect(readId()).toBe(true))
	}
})

test('selecting a different question clears amounts drafted against previous recovery rights', async () => {
	const { hook } = await recoverySetup()
	await act(() => fillMigrationDraft(hook))
	await act(() => hook.state().setQuestion('0x7'))
	expect(hook.state().sharesInput).toBe('2')
	await act(() => hook.state().setQuestion('8'))
	expect(hook.state()).toMatchObject({ sharesInput: '', recipientInput: '', invalidRightsInput: '0', yesRightsInput: '0', noRightsInput: '0' })
})

test('a failed recovery refresh keeps the selected question rights visible and blocks sends until retry', async () => {
	const { hook, source, snapshot } = await recoverySetup()
	await act(() => {
		hook.state().setRecipient(capital)
		hook.state().setYesRights('1')
	})
	expect(hook.state().transferReason).toBeUndefined()
	source.setRead('balanceOfSecurityPoolRecoveryRights', 'invalid')
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'44'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().recoveryError).toContain('source recovery rights'))
	expect(hook.state().recovery?.availableShares).toBe(3n * unit)
	await expect(hook.state().transfer()).rejects.toThrow('source recovery rights')
	source.setRead('balanceOfSecurityPoolRecoveryRights', [2n * unit, 5n * unit, 4n * unit])
	await act(() => {
		hook.state().retryRecovery()
	})
	await waitFor(() => expect(hook.state().recovery?.availableShares).toBe(2n * unit))
	expect(hook.state().transferReason).toBeUndefined()
})

test('a cold recovery page displays verified rights for the same selected question without using them for sends', async () => {
	const { parameters, snapshot, setForkReadError } = await recoverySetup()
	setForkReadError(new Error('Fork RPC unavailable'))
	const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolSharedFork, { ...parameters, snapshot: undefined, presentationSnapshot: snapshot }))
	await act(() => restored.state().setQuestion('7'))
	expect(restored.state().recovery?.availableShares).toBe(3n * unit)
	expect(restored.state().recoveryReadAt).toBeGreaterThan(0)
	expect(restored.state().recoverReason).toBeDefined()
	await act(() => restored.state().setQuestion('8'))
	expect(restored.state().recovery).toBeUndefined()
})

test('preparing recovery rechecks that the specific question still needs preparation', async () => {
	const { hook, source, snapshot, requests } = await recoverySetup()
	const factory = getInfraContractAddresses().securityPoolFactory
	source.setRead('getQuestionLedger', zeroAddress, factory)
	source.setSnapshot({ ...snapshot, timestamp: 2_000n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'45'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().prepareReason).toBeUndefined())
	await act(() => hook.state().prepare())
	const request = requests[0]
	if (request?.validateBeforeSubmit === undefined) throw new Error('Recovery preparation request missing')
	await expect(request.validateBeforeSubmit()).resolves.toBeUndefined()
	source.setRead('getQuestionLedger', token, factory)
	await expect(request.validateBeforeSubmit()).rejects.toThrow('recovery status changed')
})
test('outcome recovery transfer reviews one exact transaction before the choice deadline and rechecks each right', async () => {
	const { hook, source, requests } = await recoverySetup()
	expect(hook.state().recoverReason).toContain('choice deadline')
	await act(() => {
		hook.state().setRecipient(capital)
		hook.state().setInvalidRights('1')
		hook.state().setNoRights('2')
	})
	expect(hook.state().transferReason).toBeUndefined()
	await act(() => hook.state().transfer())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Recovery transfer request missing')
	expect(request).toMatchObject({ to: token, account: owner, value: 0n })
	expect(decodeFunctionData({ abi: parseAbi(['function transferSecurityPoolRecoveryRights(uint248 source,address recipient,uint256[3] amounts)']), data: request.data })).toEqual({ functionName: 'transferSecurityPoolRecoveryRights', args: [0n, capital, [unit, 0n, 2n * unit]] })
	expect(request.reviewDescription).toContain('1 Invalid, 0 Yes and 2 No')
	expect(request.reviewDescription).toContain('question 0x7 in source universe 0')
	expect(request.reviewDescription).toContain(capital)
	expect(request.reviewDescription).toContain('child migration rights remain yours')
	await request.validateBeforeSubmit?.()
	await act(() => hook.state().setNoRights('1'))
	source.setRead('balanceOfSecurityPoolRecoveryRights', [3n * unit, 5n * unit, unit])
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Recovery transfer prerequisites changed')
	expect(requests).toHaveLength(1)
})
test('recovery transfer blocks invalid recipients, zero amounts, per-outcome overdrafts and missing source preparation', async () => {
	const { hook, source, requests } = await recoverySetup()
	await act(() => hook.state().setRecipient(owner))
	expect(hook.state().transferReason).toContain('another nonzero')
	await act(() => hook.state().setRecipient(zeroAddress))
	expect(hook.state().transferReason).toContain('another nonzero')
	await act(() => hook.state().setRecipient(capital))
	expect(hook.state().transferReason).toContain('at least one')
	await act(() => hook.state().setInvalidRights('4'))
	expect(hook.state().transferReason).toContain('Insufficient recovery rights')
	await expect(hook.state().transfer()).rejects.toThrow('Insufficient recovery rights')
	expect(requests).toHaveLength(0)
	await act(() => hook.state().setInvalidRights('-1'))
	expect(hook.state().transferReason).toContain('nonnegative')
	await act(() => hook.state().setInvalidRights('1'))
	// Only the factory's origin lookup finds no child ledger; the security pool still resolves its source question.
	source.setRead('getQuestionLedger', zeroAddress, getInfraContractAddresses().securityPoolFactory)
	await act(() => hook.state().setQuestion('8'))
	await waitFor(() => expect(hook.state().recovery?.pool).toBe(zeroAddress))
	expect(hook.state().transferReason).toBe('Prepare this question first.')
})
test('received recovery sets can be redeemed independently of source balances and preserve exact review context', async () => {
	const { hook, source, snapshot, requests } = await recoverySetup()
	source.setSnapshot({ ...snapshot, timestamp: 2_000n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'33'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.timestamp).toBe(2_000n))
	await waitFor(() => expect(hook.state().recovery?.availableShares).toBe(3n * unit))
	await act(() => hook.state().setShares('3'))
	await waitFor(() => expect(hook.state().recoverReason).toBeUndefined())
	await act(() => hook.state().recover())
	const request = requests[0]
	if (request === undefined) throw new Error('Recovery request missing')
	expect(decodeFunctionData({ abi: parseAbi(['function recoverUnchosenCash(uint248 source,uint256 questionId,uint256 shares) returns (uint256)']), data: request.data })).toEqual({ functionName: 'recoverUnchosenCash', args: [0n, 7n, 3n * unit] })
	expect(request.reviewDescription).toContain('Received recovery rights are consumed first')
	await request.validateBeforeSubmit?.()
	expect(request.readReviewRows?.()).toEqual([{ label: 'Available recovery sets', value: '3 → 0' }])
	source.setRead('balanceOfSecurityPoolRecoveryRights', [2n * unit, 5n * unit, 4n * unit])
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Source recovery prerequisites changed')
})

test('finalized questions keep ordinary redemption and cannot detach source recovery rights', async () => {
	const { hook, source, requests } = await recoverySetup()
	await act(() => {
		hook.state().setRecipient(capital)
		hook.state().setInvalidRights('1')
	})
	await act(() => hook.state().transfer())
	const request = requests[0]
	if (request === undefined) throw new Error('Recovery transfer request missing')
	source.setRead('isSecurityPoolRecoveryEligible', false)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Recovery transfer prerequisites changed')
	await act(() => hook.state().setQuestion('8'))
	await waitFor(() => expect(hook.state().transferReason).toContain('Redeem finalized shares'))
	expect(hook.state().recoverReason).toContain('Redeem finalized shares')
	await expect(hook.state().transfer()).rejects.toThrow('Redeem finalized shares')
	expect(requests).toHaveLength(1)
})
test('the first owner can record a choice for a fresh branch in one transaction', async () => {
	const { hook, snapshot, requests, setPrepared, setChosen } = await setup()
	setPrepared(false)
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'ab'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.branch?.prepared).toBe(false))
	expect(hook.state().chooseReason).toBeUndefined()
	await act(() => hook.state().choose())
	const choose = requests[0]
	if (choose === undefined) throw new Error('Choice request missing')
	expect(requests).toHaveLength(1)
	expect(decodeFunctionData({ abi: parseAbi(['function choose(uint248 source,uint256 outcome)']), data: choose.data })).toEqual({ functionName: 'choose', args: [0n, 1n] })
	await expect(choose.validateBeforeSubmit?.()).resolves.toBeUndefined()
	setChosen(true)
	await expect(choose.validateBeforeSubmit?.()).rejects.toThrow('Fork choice is no longer available')
})

test('USDC source recovery quantities and outcome rights use collateral precision', async () => {
	const fixture = await recoverySetup()
	fixture.source.setRead('balanceOfSecurityPoolRecoveryRights', [3_000_000n, 5_000_000n, 4_000_000n])
	const snapshot = capitalSnapshot({ ...fixture.snapshot, collateral: { address: token, symbol: 'USDC', decimals: 6 } })
	const view = await renderIntoDocument(<SecurityPoolSharedFork {...fixture.parameters} snapshot={snapshot} />)
	lifecycle.trackRendered(view)
	const questionInput = [...view.container.querySelectorAll('label')].find(label => label.textContent === forkCopy.question)?.parentElement?.querySelector('input')
	if (questionInput === undefined || questionInput === null) throw new Error('Question input missing')
	await act(() => {
		questionInput.value = '7'
		questionInput.dispatchEvent(new Event('input', { bubbles: true }))
	})
	const quantity = (label: string) =>
		[...view.container.querySelectorAll('.metric-label')]
			.find(node => node.textContent === label)
			?.parentElement?.querySelector('.currency-value')
			?.getAttribute('title')
			?.replaceAll(/\s/g, '')
	await waitFor(() => expect(quantity(forkCopy.available)).toBe('3'))
	expect(quantity(forkCopy.invalidAvailable)).toBe('3')
	expect(quantity(forkCopy.yesAvailable)).toBe('5')
	expect(quantity(forkCopy.noAvailable)).toBe('4')
})

test('a prepared branch can activate without a separate migration-start transaction', async () => {
	const { hook, source, snapshot, requests, setPrepared } = await setup()
	source.setSnapshot({ ...snapshot, timestamp: 3_000n })
	await hook.setProps({ snapshot: { ...snapshot, blockHash: `0x${'33'.repeat(32)}` } })
	await waitFor(() => expect(hook.state().state?.timestamp).toBe(3_000n))
	expect(hook.state().state?.branch?.started).toBe(false)
	expect(hook.state().finalizeReason).toBeUndefined()
	await act(() => hook.state().finalize())
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request === undefined) throw new Error('Missing activation request')
	await expect(request.validateBeforeSubmit?.()).resolves.toBeUndefined()
	setPrepared(false)
	await expect(request.validateBeforeSubmit?.()).rejects.toThrow('Prepare branch capital first')
})
