/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { ZoltarChildUniverseSummary, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { ZoltarMigrationSection } from '@zoltar/ui-zoltar-shared/features/universes/components/ZoltarMigrationSection.js'
import { getUniverseLinkHref } from '@zoltar/ui-zoltar-shared/features/universes/lib/universe.js'
import type { ZoltarMigrationFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { describe, expect, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'

type ZoltarMigrationSectionProps = Parameters<typeof ZoltarMigrationSection>[0]
const ATTO_REP = 10n ** 18n
const ZOLTAR_ADDRESS = '0x00000000000000000000000000000000000000a1' as const
const CHILD_REP_ADDRESS = '0x00000000000000000000000000000000000000b2' as const

const yesChild: ZoltarChildUniverseSummary = { exists: true, forkTime: 1n, outcomeIndex: 1n, outcomeLabel: 'Yes', parentUniverseId: 1n, reputationToken: CHILD_REP_ADDRESS, universeId: 2n }
const noChild: ZoltarChildUniverseSummary = { exists: false, forkTime: 0n, outcomeIndex: 2n, outcomeLabel: 'No', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 3n }

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [yesChild, noChild],
		forkThresholdAttoRep: 100n,
		forkQuestionDetails: undefined,
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 1000n,
		universeId: 1n,
		zoltarAddress: ZOLTAR_ADDRESS,
		...overrides,
	}
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

	test('starts on outcome selection with outcome names, destination status, and no raw ids', async () => {
		const updates: Partial<ZoltarMigrationFormState>[] = []
		const deployed: bigint[] = []
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ onDeployChildUniverse: outcomeIndex => deployed.push(outcomeIndex), onZoltarMigrationFormChange: update => updates.push(update) })))
		cleanupRenderedComponent = rendered.cleanup
		const queries = within(document.body)

		expect(getCurrentStepTitle()).toBe('Choose outcomes')
		expect(document.body.textContent).toContain('Not created yet')
		expect(document.body.textContent).not.toContain('0x2')
		expect(document.body.textContent).not.toContain('Split REP')
		expect(document.body.textContent).not.toContain('prepared REP')
		expect(queries.getByRole('link', { name: 'Open Yes universe' }).getAttribute('href')).toBe(getUniverseLinkHref(2n))
		expect(queries.getByRole('button', { name: /^Yes/ }).getAttribute('aria-pressed')).toBe('true')
		queries.getByRole('button', { name: /^No/ }).click()
		expect(updates).toEqual([{ outcomeIndexes: [1n, 2n] }])
		queries.getByRole('button', { name: 'Deploy universe' }).click()
		expect(deployed).toEqual([2n])
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
