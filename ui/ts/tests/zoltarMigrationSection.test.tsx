/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ZoltarMigrationSection } from '../components/ZoltarMigrationSection.js'
import type { ZoltarMigrationFormState } from '../types/app.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'

type ZoltarMigrationSectionProps = Parameters<typeof ZoltarMigrationSection>[0]
const REP = 10n ** 18n

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
		zoltarMigrationChildRepBalances: { '1': 0n },
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

	test('keeps migration approval silently disabled off mainnet', async () => {
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
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(false)
	})

	test('keeps prepare and split silently disabled off mainnet', async () => {
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
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(false)
	})
})
