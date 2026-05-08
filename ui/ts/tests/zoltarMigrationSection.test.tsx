/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, test } from 'bun:test'
import { h } from 'preact'
import { zeroAddress } from 'viem'
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
		zoltarMigrationResult: undefined,
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

		expectTransactionButtonDisabled(document.body, 'Prepare REP', 'Fork Zoltar before preparing REP.')
		expectTransactionButtonDisabled(document.body, 'Split REP', 'Fork Zoltar before migrating REP.')
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
})
