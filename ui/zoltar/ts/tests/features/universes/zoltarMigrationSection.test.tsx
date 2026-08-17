/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ZoltarMigrationSection } from '../../../features/universes/components/ZoltarMigrationSection.js'
import type { ZoltarMigrationFormState } from '../../../types/app.js'
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
		expectTransactionButtonDisabled(document.body, 'Prepare REP', 'REP preparation is unavailable because this universe has not forked.')
		expectTransactionButtonDisabled(document.body, 'Split REP', 'Available after this universe forks.')
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

		const review = within(document.body).getByRole('heading', { name: 'Transaction Review' }).closest('section')
		if (review === null) throw new Error('Expected transaction review')
		expect(review.textContent).toContain('Yes · Universe 0x2')
		expect(review.textContent).toContain('Child-Universe REP Received')
		expect(review.textContent).not.toContain('Technical Details')
		expect(review.textContent?.match(/Selected Destinations/g)).toHaveLength(1)
		const balanceChanges = within(document.body).getByText('Balance Changes').closest('details')
		if (balanceChanges === null) throw new Error('Expected balance changes disclosure')
		expect(balanceChanges.textContent).toContain('Custody REP After Split (Unchanged)')
		expect(balanceChanges.closest('.actions')).toBeNull()
		const migrationActions = balanceChanges.nextElementSibling
		if (!(migrationActions instanceof HTMLElement)) throw new Error('Expected migration action row after balance changes')
		expect(migrationActions.classList.contains('actions')).toBe(true)
		expect(within(migrationActions).getByRole('button', { name: 'Prepare REP' })).not.toBeNull()
		expect(within(migrationActions).getByRole('button', { name: 'Split REP' })).not.toBeNull()
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
