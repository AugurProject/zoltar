/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import { getScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { ZoltarChildUniverseSummary, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { ZoltarMigrationSection } from '@zoltar/ui-zoltar-shared/features/universes/components/ZoltarMigrationSection.js'
import { WalletActionsProvider } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { getUniverseLinkHref } from '@zoltar/ui-core-shared/navigation/universeNavigation.js'
import type { ZoltarMigrationFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { describe, expect, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { createUniverseSummary } from '@zoltar/ui-core-shared/tests/testUtils/universeFixtures.js'

type ZoltarMigrationSectionProps = Parameters<typeof ZoltarMigrationSection>[0]
const ATTO_REP = 10n ** 18n
const ZOLTAR_ADDRESS = '0x00000000000000000000000000000000000000a1' as const
const CHILD_REP_ADDRESS = '0x00000000000000000000000000000000000000b2' as const

const yesChild: ZoltarChildUniverseSummary = { exists: true, forkTime: 1n, outcomeIndex: 1n, outcomeLabel: 'Yes', parentUniverseId: 1n, reputationToken: CHILD_REP_ADDRESS, universeId: 2n }
const noChild: ZoltarChildUniverseSummary = { exists: false, forkTime: 0n, outcomeIndex: 2n, outcomeLabel: 'No', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 3n }

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return createUniverseSummary({
		childUniverses: [yesChild, noChild],
		forkThresholdAttoRep: 100n,
		forkTime: 1n,
		hasForked: true,
		totalTheoreticalSupplyAttoRep: 1000n,
		zoltarAddress: ZOLTAR_ADDRESS,
		...overrides,
	})
}

function createForm(overrides: Partial<ZoltarMigrationFormState> = {}): ZoltarMigrationFormState {
	return { amount: '10', outcomeIndexes: [1n], ...overrides }
}

function createProps(overrides: Partial<ZoltarMigrationSectionProps> = {}): ZoltarMigrationSectionProps {
	return {
		accountAddress: zeroAddress,
		isOnActiveAppChain: true,
		loadingZoltarForkAccess: false,
		loadingZoltarUniverse: false,
		onApproveZoltarForkRep: () => undefined,
		onMigrateInternalRep: () => undefined,
		onDeployChildUniverse: () => undefined,
		pendingChildUniverseOutcomeIndex: undefined,
		onRetryMigrationBalances: () => undefined,
		onRetryUniverse: () => undefined,
		onZoltarMigrationFormChange: () => undefined,
		zoltarForkActiveAction: undefined,
		zoltarForkApproval: { error: undefined, loading: false, value: 20n * ATTO_REP },
		zoltarForkRepBalanceAttoRep: 20n * ATTO_REP,
		zoltarMigrationActiveAction: undefined,
		zoltarMigrationChildRepBalancesAttoRep: { '2': 0n },
		zoltarMigrationChildSplitAmountsAttoRep: { '2': 0n },
		zoltarMigrationError: undefined,
		zoltarMigrationForm: createForm(),
		zoltarMigrationPending: false,
		zoltarMigrationPreparedRepBalanceAttoRep: 10n * ATTO_REP,
		zoltarUniverse: createUniverse(),
		zoltarUniverseState: 'ready',
		...overrides,
	}
}

function getStepButton(title: string) {
	const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.migration-wizard-steps button')).find(candidate => candidate.querySelector('.migration-wizard-step-title')?.textContent === title)
	if (button === undefined) throw new Error(`Missing wizard step ${title}`)
	return button
}

async function openStep(title: string) {
	const button = getStepButton(title)
	expect(button.disabled).toBe(false)
	await act(() => button.click())
}

function getCurrentStepTitle() {
	return document.body.querySelector('.migration-wizard-steps [aria-current="step"] .migration-wizard-step-title')?.textContent
}

installTestRouting()
describe('ZoltarMigrationSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('keeps every migration control disabled before a fork and unlocks after a fork', async () => {
		const updates: Partial<ZoltarMigrationFormState>[] = []
		const props = createProps({ zoltarUniverse: createUniverse({ hasForked: false, childUniverses: [], forkTime: 0n }), onZoltarMigrationFormChange: update => updates.push(update) })
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, props))
		cleanupRenderedComponent = rendered.cleanup
		const queries = within(document.body)
		expect(document.querySelector('.migration-wizard')).toBeTruthy()
		expect(queries.getByText('Outcome choices appear after this universe forks.')).toBeTruthy()
		expect(queries.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true)
		for (const button of document.querySelectorAll<HTMLButtonElement>('.migration-wizard button')) {
			expect(button.disabled).toBe(true)
			await act(() => button.click())
		}
		expect(updates).toEqual([])
		await act(() => render(h(ZoltarMigrationSection, { ...props, zoltarUniverse: createUniverse() }), rendered.container))
		expect(queries.queryByText('Outcome choices appear after this universe forks.')).toBeNull()
		expect(queries.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false)
	})

	test('shows the pre-fork preview with no wallet REP instead of claiming migration is complete', async () => {
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ accountAddress: undefined, zoltarForkRepBalanceAttoRep: 0n, zoltarMigrationPreparedRepBalanceAttoRep: 0n, zoltarUniverse: createUniverse({ hasForked: false, childUniverses: [], forkTime: 0n }) })))
		cleanupRenderedComponent = rendered.cleanup
		expect(document.querySelector('.migration-wizard')).toBeTruthy()
		expect(within(document.body).queryByText('All your REP here is migrated')).toBeNull()
		expect(within(document.body).getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true)
	})

	test('waits for required related-universe details instead of showing an empty wizard', async () => {
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ loadingZoltarUniverse: true, zoltarUniverse: createUniverse({ childUniverses: [], relatedUniversesLoaded: false }) })))
		cleanupRenderedComponent = rendered.cleanup
		expect(document.querySelector('.migration-wizard')).toBeNull()
		expect(within(document.body).queryByText('No outcome universes available.')).toBeNull()
		expect(within(document.body).getByText('Loading universe details.')).toBeTruthy()
	})

	test('shows the related-detail read failure and retries without pretending outcomes are empty', async () => {
		let retries = 0
		const props = {
			...createProps({ zoltarUniverse: createUniverse({ childUniverses: [], relatedUniversesLoaded: false }) }),
			zoltarUniverseError: 'Failed to load Zoltar universe. Reason: RPC unavailable',
			onRetryUniverse: () => {
				retries += 1
			},
		}
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, props))
		cleanupRenderedComponent = rendered.cleanup
		const queries = within(document.body)
		expect(queries.getByText(props.zoltarUniverseError)).toBeTruthy()
		expect(document.querySelector('.migration-wizard')).toBeNull()
		await act(() => queries.getByRole('button', { name: 'Retry' }).click())
		expect(retries).toBe(1)
		await act(() => render(h(ZoltarMigrationSection, { ...props, zoltarUniverse: createUniverse({ relatedUniversesLoaded: true }), zoltarUniverseError: undefined }), rendered.container))
		expect(document.querySelector('.migration-wizard')).toBeTruthy()
		expect(queries.queryByText(props.zoltarUniverseError)).toBeNull()
	})

	test('starts on outcome selection with outcome names, destination status, and no raw ids', async () => {
		const updates: Partial<ZoltarMigrationFormState>[] = []
		const deployed: bigint[] = []
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ universeBrowserHref: '#/pools/universes?universe=1', onDeployChildUniverse: outcomeIndex => deployed.push(outcomeIndex), onZoltarMigrationFormChange: update => updates.push(update) })))
		cleanupRenderedComponent = rendered.cleanup
		const queries = within(document.body)

		expect(getCurrentStepTitle()).toBe('Choose outcomes')
		expect(document.body.textContent).toContain('Not deployed')
		expect(document.body.textContent).not.toContain('0x2')
		expect(document.body.textContent).not.toContain('Split REP')
		expect(document.body.textContent).not.toContain('prepared REP')
		expect(queries.getByRole('link', { name: 'Open Yes universe' }).getAttribute('href')).toBe('#/pools/universes?universe=2')
		expect(queries.getByRole('button', { name: /^Yes/ }).getAttribute('aria-pressed')).toBe('true')
		queries.getByRole('button', { name: /^No/ }).click()
		expect(updates).toEqual([{ outcomeIndexes: [1n, 2n] }])
		queries.getByRole('button', { name: 'Deploy No universe' }).click()
		expect(deployed).toEqual([2n])
	})

	test('uses the scalar picker for deployed, undeployed and Invalid outcomes without listing ticks', async () => {
		const question = createMarketDetails({ marketType: 'scalar', outcomeLabels: [], numTicks: 10n ** 25n, displayValueMax: 100n * ATTO_REP, answerUnit: '°C' })
		const maxIndex = getScalarOutcomeIndex(question, question.numTicks)
		const child = { ...yesChild, outcomeIndex: maxIndex, outcomeLabel: '100 °C' }
		const updates: Partial<ZoltarMigrationFormState>[] = []
		const deployments: bigint[] = []
		const rendered = await renderIntoDocument(
			h(ZoltarMigrationSection, createProps({ zoltarUniverse: createUniverse({ forkQuestionDetails: question, childUniverses: [child] }), zoltarMigrationForm: createForm({ outcomeIndexes: [] }), onDeployChildUniverse: index => deployments.push(index), onZoltarMigrationFormChange: update => updates.push(update) })),
		)
		cleanupRenderedComponent = rendered.cleanup
		const q = within(document.body)
		expect(document.querySelectorAll('.migration-outcome-row')).toHaveLength(0)
		q.getByRole('button', { name: 'Deploy 0 °C universe' }).click()
		expect(deployments).toEqual([getScalarOutcomeIndex(question, 0n)])
		await act(() => fireEvent.input(q.getByLabelText('Scalar value'), { target: { value: '100' } }))
		expect(document.querySelectorAll('.migration-outcome-row')).toHaveLength(1)
		q.getByRole('button', { name: '100 °C' }).click()
		expect(updates).toEqual([{ outcomeIndexes: [maxIndex] }])
		expect(q.getByRole('link', { name: 'Open 100 °C universe' }).getAttribute('href')).toBe(getUniverseLinkHref(child.universeId))
		await act(() => fireEvent.input(q.getByRole('textbox', { name: 'Select outcome' }), { target: { value: (question.numTicks + 1n).toString() } }))
		expect(q.queryByRole('button', { name: /^Deploy .* universe$/ })).toBeNull()
		expect(document.body.textContent).toContain('Enter an exact tick within')
		await act(() => fireEvent.click(q.getByRole('checkbox', { name: 'Invalid' })))
		q.getByRole('button', { name: 'Deploy Invalid universe' }).click()
		expect(deployments.at(-1)).toBe(0n)
	})

	test('pages categorical choices without losing selected outcomes', async () => {
		const children = Array.from({ length: 12 }, (_, i) => ({ ...yesChild, universeId: BigInt(i + 2), outcomeIndex: BigInt(i + 1), outcomeLabel: `Option ${i + 1}` }))
		const updates: Partial<ZoltarMigrationFormState>[] = []
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ zoltarUniverse: createUniverse({ childUniverses: children }), onZoltarMigrationFormChange: update => updates.push(update) })))
		cleanupRenderedComponent = rendered.cleanup
		const q = within(document.body)
		expect(document.querySelectorAll('.migration-outcome-row')).toHaveLength(10)
		await act(() => q.getByRole('button', { name: 'Next page' }).click())
		expect(document.querySelectorAll('.migration-outcome-row')).toHaveLength(2)
		q.getByRole('button', { name: 'Option 11' }).click()
		expect(updates).toEqual([{ outcomeIndexes: [1n, 11n] }])
		await act(() => q.getByRole('button', { name: 'Previous page' }).click())
		expect(q.getByRole('button', { name: 'Option 1' }).getAttribute('aria-pressed')).toBe('true')
	})

	test('keeps scalar selections visible and removable after moving the picker', async () => {
		const question = createMarketDetails({ marketType: 'scalar', outcomeLabels: [], numTicks: 20n, displayValueMax: 100n * ATTO_REP, answerUnit: '°C' })
		const index = getScalarOutcomeIndex(question, 10n)
		const updates: Partial<ZoltarMigrationFormState>[] = []
		const child = { ...yesChild, outcomeIndex: index, outcomeLabel: '50 °C' }
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ zoltarUniverse: createUniverse({ forkQuestionDetails: question, childUniverses: [child] }), zoltarMigrationForm: createForm({ outcomeIndexes: [index] }), onZoltarMigrationFormChange: update => updates.push(update) })))
		cleanupRenderedComponent = rendered.cleanup
		const q = within(document.body)
		await act(() => fireEvent.input(q.getByRole('slider', { name: 'Select outcome' }), { target: { value: '10' } }))
		await act(() => fireEvent.input(q.getByRole('slider', { name: 'Select outcome' }), { target: { value: '1' } }))
		expect(q.getByRole('button', { name: 'Remove 50 °C' })).toBeTruthy()
		expect(q.getByRole('button', { name: 'Deploy 5 °C universe' })).toBeTruthy()
		expect(q.getByText('Not deployed')).toBeTruthy()
		q.getByRole('button', { name: 'Remove 50 °C' }).click()
		expect(updates).toEqual([{ outcomeIndexes: [] }])
		await act(() => render(h(ZoltarMigrationSection, createProps({ zoltarUniverse: createUniverse({ forkQuestionDetails: question, childUniverses: [child] }), zoltarMigrationForm: createForm({ outcomeIndexes: [] }) })), rendered.container))
		expect(q.queryByRole('button', { name: 'Remove 50 °C' })).toBeNull()
	})

	test('keeps selections from other categorical pages visible and removable', async () => {
		const children = Array.from({ length: 12 }, (_, i) => ({ ...yesChild, universeId: BigInt(i + 2), outcomeIndex: BigInt(i + 1), outcomeLabel: `Option ${i + 1}` }))
		const updates: Partial<ZoltarMigrationFormState>[] = []
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ zoltarUniverse: createUniverse({ childUniverses: children }), zoltarMigrationForm: createForm({ outcomeIndexes: [1n, 11n] }), onZoltarMigrationFormChange: update => updates.push(update) })))
		cleanupRenderedComponent = rendered.cleanup
		const q = within(document.body)
		expect(q.getByRole('button', { name: 'Remove Option 11' })).toBeTruthy()
		await act(() => q.getByRole('button', { name: 'Next page' }).click())
		q.getByRole('button', { name: 'Remove Option 1' }).click()
		expect(updates).toEqual([{ outcomeIndexes: [11n] }])
		await act(() => render(h(ZoltarMigrationSection, createProps({ zoltarUniverse: createUniverse({ childUniverses: children }), zoltarMigrationForm: createForm({ outcomeIndexes: [11n] }) })), rendered.container))
		expect(q.queryByRole('button', { name: 'Remove Option 1' })).toBeNull()
		expect(q.getByRole('button', { name: 'Remove Option 11' })).toBeTruthy()
	})

	test('enables Continue when the first outcome selection reaches the form', async () => {
		let props = createProps({ zoltarMigrationForm: createForm({ outcomeIndexes: [] }) })
		props.onZoltarMigrationFormChange = update => {
			props = { ...props, zoltarMigrationForm: { ...props.zoltarMigrationForm, ...update } }
			render(h(ZoltarMigrationSection, props), rendered.container)
		}
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, props))
		cleanupRenderedComponent = rendered.cleanup
		expectTransactionButtonDisabled(document.body, 'Continue', 'Select at least one outcome.')
		await act(() => within(document.body).getByRole('button', { name: 'Yes' }).click())
		expectTransactionButtonEnabled(document.body, 'Continue')
		await act(() => within(document.body).getByRole('button', { name: 'Continue' }).click())
		expect(getCurrentStepTitle()).toBe('Amount')
	})

	test('blocks Continue until an outcome is selected', async () => {
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ zoltarMigrationForm: createForm({ outcomeIndexes: [] }) })))
		cleanupRenderedComponent = rendered.cleanup
		expectTransactionButtonDisabled(document.body, 'Continue', 'Select at least one outcome.')
		expect(getStepButton('Amount').disabled).toBe(true)
		expect(getStepButton('Review').disabled).toBe(true)
	})

	test('moves forward with Continue and skips approval that is not needed', async () => {
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps()))
		cleanupRenderedComponent = rendered.cleanup
		await act(() => within(document.body).getByRole('button', { name: 'Continue' }).click())
		expect(getCurrentStepTitle()).toBe('Amount')
		await act(() => within(document.body).getByRole('button', { name: 'Continue' }).click())
		expect(getCurrentStepTitle()).toBe('Review')
		expect(getStepButton('Approve').textContent).toContain('Not needed')
		await act(() => within(document.body).getByRole('button', { name: 'Back' }).click())
		expect(getCurrentStepTitle()).toBe('Amount')
	})

	test('labels the amount Max with the total it fills in', async () => {
		const updates: Partial<ZoltarMigrationFormState>[] = []
		const rendered = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarForkRepBalanceAttoRep: 2_550_000n * ATTO_REP,
					zoltarMigrationPreparedRepBalanceAttoRep: 360_000n * ATTO_REP,
					onZoltarMigrationFormChange: update => updates.push(update),
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup
		await openStep('Amount')
		expect(within(document.body).getByLabelText('Amount to migrate')).not.toBeNull()
		expect(within(document.body).queryByRole('button', { name: 'Max' })).toBeNull()
		within(document.body)
			.getByRole('button', { name: /^Use all .*REP$/ })
			.click()
		expect(updates).toEqual([{ amount: '2910000' }])
	})

	test('shows the approval step only for wallet REP that the migration burns', async () => {
		const approvals: (bigint | undefined)[] = []
		const rendered = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					onApproveZoltarForkRep: amount => approvals.push(amount),
					zoltarForkApproval: { error: undefined, loading: false, value: 0n },
					zoltarMigrationPreparedRepBalanceAttoRep: 4n * ATTO_REP,
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup
		await openStep('Approve')
		expect(getStepButton('Review').disabled).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Continue')
		within(document.body)
			.getByRole('button', { name: /^Approve 6/ })
			.click()
		expect(approvals).toEqual([6n * ATTO_REP])
	})

	test('child REP needs no approval', async () => {
		const rendered = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarForkApproval: { error: undefined, loading: false, value: 0n },
					zoltarMigrationPreparedRepBalanceAttoRep: 0n,
					zoltarUniverse: createUniverse({ reputationTokenKind: 'child', reputationTokenSymbol: 'REP4' }),
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup
		await openStep('Review')
		expect(getStepButton('Approve').textContent).toContain('Not needed')
		expect(document.body.querySelector('.approval-amount-field')).toBeNull()
		expectTransactionButtonEnabled(document.body, 'Migrate REP')
	})

	test('reviews the migration in plain language and submits the wallet REP it burns', async () => {
		const preparations: bigint[] = []
		const rendered = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarMigrationChildSplitAmountsAttoRep: { '2': 7n * ATTO_REP },
					zoltarMigrationForm: createForm({ outcomeIndexes: [2n, 1n] }),
					onMigrateInternalRep: amount => preparations.push(amount),
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup
		await openStep('Review')
		expect(document.body.querySelector('.migration-review-summary')?.textContent).toBe('Migrate 10 REP to: No, Yes')
		expect(document.body.textContent).toContain('Burned REP cannot be returned to this universe.')
		expect(document.body.textContent).not.toContain('Outcome index')
		expectTransactionButtonEnabled(document.body, 'Migrate REP')
		const navigation = document.body.querySelector<HTMLElement>('.migration-wizard-nav')
		if (navigation === null) throw new Error('Missing wizard navigation')
		expect(
			within(navigation)
				.getAllByRole('button')
				.map(button => button.textContent),
		).toEqual(['Back', 'Migrate REP'])
		within(document.body).getByRole('button', { name: 'Migrate REP' }).click()
		expect(preparations).toEqual([7n * ATTO_REP])
	})

	test.each([
		{ name: 'partial migration balance with approval', prepared: 4n * ATTO_REP, allowance: 6n * ATTO_REP, wallet: 6n * ATTO_REP, reachable: true },
		{ name: 'insufficient approval', prepared: 4n * ATTO_REP, allowance: 5n * ATTO_REP, wallet: 6n * ATTO_REP, reachable: false },
		{ name: 'insufficient wallet REP', prepared: 4n * ATTO_REP, allowance: 6n * ATTO_REP, wallet: 5n * ATTO_REP, reachable: false },
		{ name: 'fully covered by the migration balance', prepared: 10n * ATTO_REP, allowance: 0n, wallet: 0n, reachable: true },
	])('only reaches review with $name', async ({ prepared, allowance, wallet, reachable }) => {
		const rendered = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarMigrationPreparedRepBalanceAttoRep: prepared,
					zoltarForkRepBalanceAttoRep: wallet,
					zoltarForkApproval: { error: undefined, loading: false, value: allowance },
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(getStepButton('Review').disabled).toBe(!reachable)
	})

	test('keeps Migrate disabled off the app chain and explains recovery', async () => {
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ isOnActiveAppChain: false })))
		cleanupRenderedComponent = rendered.cleanup
		await openStep('Review')
		expectTransactionButtonDisabled(document.body, 'Migrate REP')
		expect(document.body.textContent).toContain('Switch to Sepolia')
	})

	test('offers the network switch fix on Migrate instead of the hint text', async () => {
		const calls: string[] = []
		const walletActions = { isConnectingWallet: false, isManagingWallet: false, onConnect: () => calls.push('connect'), onSwitchNetwork: () => calls.push('switch') }
		const rendered = await renderIntoDocument(h(WalletActionsProvider, { walletActions }, h(ZoltarMigrationSection, createProps({ isOnActiveAppChain: false }))))
		cleanupRenderedComponent = rendered.cleanup
		await openStep('Review')
		expectTransactionButtonDisabled(document.body, 'Migrate REP')
		const fix = within(document.body).getByRole('button', { name: 'Switch to Sepolia' })
		expect(within(document.body).getByRole('button', { name: 'Migrate REP' }).getAttribute('aria-describedby')).toBe(fix.id)
		expect(document.querySelector('.migration-wizard-nav-hint')?.textContent).toBe('')
		await act(() => fix.click())
		expect(calls).toEqual(['switch'])
	})

	test('stops outcome balance spinners when reads finish without a value', async () => {
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ zoltarMigrationChildRepBalancesAttoRep: {}, zoltarMigrationChildSplitAmountsAttoRep: {} })))
		cleanupRenderedComponent = rendered.cleanup
		expect(rendered.container.querySelectorAll('.migration-outcome-metric .loading').length).toBe(0)
	})

	test('falls back to the first unfinished step and stays there once it is fixed', async () => {
		let form = createForm()
		const Harness = () => h(ZoltarMigrationSection, createProps({ zoltarMigrationForm: form }))
		const rendered = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = rendered.cleanup
		await openStep('Review')
		form = createForm({ amount: '' })
		await act(() => render(h(Harness, {}), rendered.container))
		expect(getCurrentStepTitle()).toBe('Amount')
		form = createForm()
		await act(() => render(h(Harness, {}), rendered.container))
		expect(getCurrentStepTitle()).toBe('Amount')
	})

	test('recovers from a failed wallet balance read with Retry', async () => {
		let walletBalance: bigint | undefined
		const Harness = () =>
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarForkRepBalanceAttoRep: walletBalance,
					zoltarMigrationPreparedRepBalanceAttoRep: 0n,
					onRetryMigrationBalances: () => {
						walletBalance = 20n * ATTO_REP
						render(h(Harness, {}), rendered.container)
					},
				}),
			)
		const rendered = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = rendered.cleanup
		await openStep('Amount')
		expectTransactionButtonDisabled(document.body, 'Continue', 'Could not read migration balances. Retry to continue.')
		await act(() => within(document.body).getByRole('button', { name: 'Retry' }).click())
		expectTransactionButtonEnabled(document.body, 'Continue')
		expect(within(document.body).queryByRole('button', { name: 'Retry' })).toBeNull()
	})

	test('shows completion once every outcome received the whole migration balance', async () => {
		const rendered = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarForkRepBalanceAttoRep: 0n,
					zoltarMigrationChildRepBalancesAttoRep: { '2': 10n * ATTO_REP },
					zoltarMigrationChildSplitAmountsAttoRep: { '2': 10n * ATTO_REP },
					zoltarUniverse: createUniverse({ childUniverses: [yesChild] }),
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(document.body.textContent).toContain('All your REP here is migrated')
		expect(document.body.querySelector('.migration-wizard')).toBeNull()
	})

	test('offers wallet import only for outcome REP the account holds', async () => {
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ zoltarMigrationChildRepBalancesAttoRep: { '2': 5n * ATTO_REP }, zoltarMigrationChildSplitAmountsAttoRep: { '2': 5n * ATTO_REP } })))
		cleanupRenderedComponent = rendered.cleanup
		const walletTokensSection = Array.from(document.querySelectorAll('details')).find(details => details.querySelector('summary')?.textContent === 'Outcome-universe REP in your wallet')
		if (walletTokensSection === undefined) throw new Error('Expected outcome REP section')
		expect(walletTokensSection.open).toBe(false)
		expect(walletTokensSection.textContent).toContain('Yes')
		expect(walletTokensSection.textContent).toContain(CHILD_REP_ADDRESS)
		await cleanupRenderedComponent()
		cleanupRenderedComponent = undefined
		const withoutHeldTokens = await renderIntoDocument(h(ZoltarMigrationSection, createProps()))
		cleanupRenderedComponent = withoutHeldTokens.cleanup
		expect(Array.from(document.querySelectorAll('summary')).some(summary => summary.textContent === 'Outcome-universe REP in your wallet')).toBe(false)
	})
})
