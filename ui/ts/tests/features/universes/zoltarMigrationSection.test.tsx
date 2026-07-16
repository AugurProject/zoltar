/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '../../testUtils/queries'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ZoltarMigrationSection } from '../../../features/universes/components/ZoltarMigrationSection.js'
import type { ZoltarMigrationFormState } from '../../../types/app.js'
import type { ZoltarUniverseSummary } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '../../testUtils/transactionActionButton.js'

type ZoltarMigrationSectionProps = Parameters<typeof ZoltarMigrationSection>[0]
const REP = 10n ** 18n
const ZOLTAR_ADDRESS = '0x00000000000000000000000000000000000000a1' as const
const HASH = '0x0000000000000000000000000000000000000000000000000000000000000001' as const

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
		forkThreshold: 100n,
		forkQuestionDetails: undefined,
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupply: 1000n,
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
		isMainnet: true,
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
			value: 20n * REP,
		},
		zoltarForkRepBalance: 20n * REP,
		zoltarMigrationActiveAction: undefined,
		zoltarMigrationChildRepBalances: { '2': 0n },
		zoltarMigrationError: undefined,
		zoltarMigrationForm: createForm(),
		zoltarMigrationPending: false,
		zoltarMigrationPreparedRepBalance: 10n * REP,
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

		expectTransactionButtonDisabled(document.body, 'Prepare REP', 'REP preparation is unavailable because this universe has not forked.')
		expectTransactionButtonDisabled(document.body, 'Split REP', 'REP migration is unavailable because this universe has not forked.')
	})

	test('enables prepare when additional REP must be moved into the migration balance', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarForkApproval: {
						error: undefined,
						loading: false,
						value: 10n * REP,
					},
					zoltarMigrationPreparedRepBalance: 0n,
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
					isMainnet: false,
					zoltarForkApproval: {
						error: undefined,
						loading: false,
						value: 0n,
					},
					zoltarMigrationPreparedRepBalance: 0n,
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
					isMainnet: false,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Prepare REP')
		expectTransactionButtonDisabled(document.body, 'Split REP')
		expect(document.body.textContent?.includes('Split the migration REP across the selected universes.')).toBe(false)
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(true)
	})

	test('advances to one verify stage after the selected split succeeds', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarMigrationResult: {
						action: 'splitMigrationRep',
						amount: 10n * REP,
						hash: HASH,
						outcomeIndexes: [1n],
						universeId: 1n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const currentSteps = document.body.querySelectorAll('.migration-workflow-steps .current')
		expect(currentSteps).toHaveLength(1)
		expect(currentSteps[0]?.textContent).toBe('6. Verify destination REP')
	})

	test('reviews labeled child-universe outputs against the Zoltar contract without consuming custody', async () => {
		const renderedComponent = await renderIntoDocument(h(ZoltarMigrationSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const review = within(document.body).getByRole('heading', { name: 'Transaction Review' }).closest('section')
		if (review === null) throw new Error('Expected transaction review')
		expect(review.textContent).toContain('Yes · Universe 2')
		expect(review.textContent).toContain('Child-Universe REP Received')
		expect(review.textContent).toContain('Custody REP After Split (Unchanged)')
		expect(review.textContent).toContain(ZOLTAR_ADDRESS)
		expect(review.textContent).not.toContain('Selected Destinations1')
	})
})
