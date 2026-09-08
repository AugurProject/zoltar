/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/evm/ethereum'
import { ZoltarMigrationSection } from '@zoltar/ui-zoltar-shared/features/universes/components/ZoltarMigrationSection.js'
import type { ZoltarMigrationFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'

type ZoltarMigrationSectionProps = Parameters<typeof ZoltarMigrationSection>[0]
const ATTO_REP = 10n ** 18n
const ZOLTAR_ADDRESS = '0x00000000000000000000000000000000000000a1' as const
const CHILD_REP_ADDRESS = '0x00000000000000000000000000000000000000b2' as const

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [
			{
				exists: false,
				forkTime: 1n,
				outcomeIndex: 1n,
				outcomeLabel: 'Yes',
				parentUniverseId: 1n,
				reputationToken: zeroAddress,
				universeId: 2n,
			},
		],
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
	return {
		amount: '10',
		outcomeIndexes: '1',
		...overrides,
	}
}

function createProps(overrides: Partial<ZoltarMigrationSectionProps> = {}): ZoltarMigrationSectionProps {
	return {
		accountAddress: zeroAddress,
		isOnActiveAppChain: true,
		loadingZoltarForkAccess: false,
		loadingZoltarUniverse: false,
		onApproveZoltarForkRep: () => undefined,
		onMigrateInternalRep: () => undefined,
		onPrepareRepForMigration: () => undefined,
		onZoltarMigrationFormChange: () => undefined,
		zoltarForkActiveAction: undefined,
		zoltarForkApproval: {
			error: undefined,
			loading: false,
			value: 20n * ATTO_REP,
		},
		zoltarForkRepBalanceAttoRep: 20n * ATTO_REP,
		zoltarMigrationActiveAction: undefined,
		zoltarMigrationChildRepBalancesAttoRep: { '2': 0n },
		zoltarMigrationError: undefined,
		zoltarMigrationForm: createForm(),
		zoltarMigrationPending: false,
		zoltarMigrationPreparedRepBalanceAttoRep: 10n * ATTO_REP,
		zoltarUniverse: createUniverse(),
		zoltarUniverseState: 'ready',
		...overrides,
	}
}

installTestRouting()
describe('ZoltarMigrationSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('Max includes prepared REP and explains the total without requiring it from the wallet again', async () => {
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
		const amountField = rendered.container.querySelector('#zoltar-migration-amount')?.parentElement
		if (amountField === undefined || amountField === null) throw new Error('Migration amount field is missing')
		within(amountField).getByRole('button', { name: 'Max' }).click()
		expect(updates).toEqual([{ amount: '2910000' }])
		expect(rendered.container.textContent).toContain('Max includes wallet REP and REP already prepared for migration.')
		const prepare = within(rendered.container).getByRole('button', { name: 'Prepare REP' })
		const reasonId = prepare.getAttribute('aria-describedby')
		if (reasonId === null) throw new Error('Prepare REP needs an associated reason')
		const reason = document.getElementById(reasonId)
		expect(reason?.classList.contains('visually-hidden')).toBe(false)
		expect(reason?.textContent?.length).toBeGreaterThan(0)
	})

	test('disables prepare and split until forking and amount prerequisites are satisfied', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarMigrationForm: createForm({ amount: '' }),
					zoltarUniverse: createUniverse({ hasForked: false }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(Array.from(document.body.querySelectorAll('.migration-workflow-steps span')).map(step => step.textContent)).toEqual(['1. Choose destinations', '2. Prepare REP', '3. Split REP'])
		expectTransactionButtonDisabled(document.body, 'Prepare REP', 'Enter an amount greater than zero.')
		expectTransactionButtonDisabled(document.body, 'Split REP', 'Enter an amount greater than zero.')
	})

	test('labels the irreversible migration amount and requires an explicit destination', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarMigrationForm: createForm({ amount: '10', outcomeIndexes: '' }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByLabelText('Migration Amount')).not.toBeNull()
		expect(document.body.querySelector('[aria-pressed="true"]')).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Split REP', 'Select at least one outcome universe.')
	})

	test('enables prepare when additional REP must be moved into the migration balance', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarForkApproval: {
						error: undefined,
						loading: false,
						value: 10n * ATTO_REP,
					},
					zoltarMigrationPreparedRepBalanceAttoRep: 0n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Prepare REP')
	})

	test('child REP preparation needs no approval transaction', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarForkApproval: { error: undefined, loading: false, value: 0n },
					zoltarMigrationPreparedRepBalanceAttoRep: 0n,
					zoltarUniverse: createUniverse({ reputationTokenKind: 'child', reputationTokenSymbol: 'REP4' }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(within(document.body).queryByRole('button', { name: /Approve/ })).toBeNull()
		expectTransactionButtonEnabled(document.body, 'Prepare REP')
	})

	test('enables split when the selected amount is already prepared and valid outcome universes are selected', async () => {
		const renderedComponent = await renderIntoDocument(h(ZoltarMigrationSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Split REP')
	})

	test('keeps migration approval disabled off mainnet and explains recovery', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					isOnActiveAppChain: false,
					zoltarForkApproval: {
						error: undefined,
						loading: false,
						value: 0n,
					},
					zoltarMigrationPreparedRepBalanceAttoRep: 0n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const approveButton = within(document.body)
			.getAllByRole('button')
			.find(button => button.textContent?.startsWith('Approve ') === true)
		if (approveButton === undefined) throw new Error('Expected approval button')
		expect(approveButton.hasAttribute('disabled')).toBe(true)
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(true)
	})

	test('keeps prepare and split disabled off mainnet and explains recovery', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					isOnActiveAppChain: false,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Prepare REP')
		expectTransactionButtonDisabled(document.body, 'Split REP')
		expect(document.body.textContent?.includes('Split the migration REP across the selected universes.')).toBe(false)
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(true)
	})

	test('shows the final workflow stage when destinations and prepared REP are ready', async () => {
		const renderedComponent = await renderIntoDocument(h(ZoltarMigrationSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const currentSteps = document.body.querySelectorAll('.migration-workflow-steps .current')
		expect(currentSteps).toHaveLength(1)
		expect(currentSteps[0]?.textContent).toBe('3. Split REP')
		expect(document.body.textContent?.includes('Ready to split.')).toBe(false)
	})

	test('reviews labeled child-universe outputs without consuming custody', async () => {
		const renderedComponent = await renderIntoDocument(h(ZoltarMigrationSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent).toContain('Yes')
		expect(document.body.textContent).not.toContain('Universe 0x2')
		expect(document.body.textContent).toContain('Child-Universe REP Received')
		expect(document.body.textContent).not.toContain('Technical Details')
		expect(document.body.textContent?.match(/Selected Destinations/g)).toHaveLength(1)
		expect(document.body.textContent).not.toContain('Balance Changes')
		expect(within(document.body).getByRole('button', { name: 'Prepare REP' })).not.toBeNull()
		expect(within(document.body).getByRole('button', { name: 'Split REP' })).not.toBeNull()
	})

	test('shows wallet import access only for deployed child tokens the account holds', async () => {
		const heldChild = {
			exists: true,
			forkTime: 1n,
			outcomeIndex: 1n,
			outcomeLabel: 'Yes',
			parentUniverseId: 1n,
			reputationToken: CHILD_REP_ADDRESS,
			universeId: 2n,
		}
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarMigrationChildRepBalancesAttoRep: { '2': 5n * ATTO_REP },
					zoltarUniverse: createUniverse({ childUniverses: [heldChild] }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const walletTokensHeading = within(document.body).getByRole('heading', { name: 'Wallet REP Tokens' })
		const walletTokensSection = walletTokensHeading.closest('section')
		if (walletTokensSection === null) throw new Error('Expected wallet REP tokens section')
		expect(walletTokensSection.textContent).toContain('Yes')
		expect(walletTokensSection.textContent).toContain(CHILD_REP_ADDRESS)

		await cleanupRenderedComponent()
		cleanupRenderedComponent = undefined
		const withoutHeldTokens = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarMigrationChildRepBalancesAttoRep: { '2': 0n },
					zoltarUniverse: createUniverse({ childUniverses: [heldChild] }),
				}),
			),
		)
		cleanupRenderedComponent = withoutHeldTokens.cleanup
		expect(within(document.body).queryByRole('heading', { name: 'Wallet REP Tokens' })).toBeNull()
	})
})
