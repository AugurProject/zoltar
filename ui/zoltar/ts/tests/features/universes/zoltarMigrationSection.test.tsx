/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { ZoltarMigrationSection } from '@zoltar/ui-zoltar-shared/features/universes/components/ZoltarMigrationSection.js'
import { getUniverseLinkHref } from '@zoltar/ui-zoltar-shared/features/universes/lib/universe.js'
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
		onDeployChildUniverse: () => undefined,
		pendingChildUniverseOutcomeIndex: undefined,
		onRetryMigrationBalances: () => undefined,
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

	test('stops outcome balance spinners when reads finish without a value', async () => {
		const rendered = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarUniverse: createUniverse({ childUniverses: [{ exists: true, forkTime: 0n, outcomeIndex: 1n, outcomeLabel: 'Yes', parentUniverseId: 1n, reputationToken: CHILD_REP_ADDRESS, universeId: 2n }] }),
					zoltarMigrationChildRepBalancesAttoRep: {},
					zoltarMigrationChildSplitAmountsAttoRep: {},
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(rendered.container.querySelectorAll('.migration-outcome-metric .loading').length).toBe(0)
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
		expect(rendered.container.textContent).toContain('Max includes wallet REP and unused prepared REP for the selected destinations.')
		expect(within(rendered.container).queryByRole('button', { name: 'Prepare REP' })).toBeNull()
	})

	test('disables split until forking and amount prerequisites are satisfied', async () => {
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

		expect(document.body.querySelector('.migration-workflow-steps')).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Split REP', 'Enter an amount greater than zero.')
	})

	test('shares one amount notice above approval and split buttons', async () => {
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ zoltarMigrationForm: createForm({ amount: '' }) })))
		cleanupRenderedComponent = rendered.cleanup
		const notices = rendered.container.querySelectorAll('.tx-action-notice')
		expect(notices.length).toBe(1)
		const notice = notices[0]
		if (notice === undefined) throw new Error('Missing migration notice')
		expect(notice.textContent).toBe('Enter an amount greater than zero.')
		for (const name of ['Approve REP', 'Split REP']) {
			const button = within(rendered.container).getByRole('button', { name })
			expect(button.getAttribute('aria-describedby')).toBe(notice.id)
			expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
		}
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

	test('enables the combined split when additional REP needs preparation', async () => {
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

		expectTransactionButtonEnabled(document.body, 'Split REP')
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
		expectTransactionButtonEnabled(document.body, 'Split REP')
	})

	test('enables split when the selected amount is already prepared and valid outcome universes are selected', async () => {
		const renderedComponent = await renderIntoDocument(h(ZoltarMigrationSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Split REP')
	})

	test('shows deployment state and deploys missing universes from the outcome selector', async () => {
		const deployedOutcomes: bigint[] = []
		const formUpdates: Partial<ZoltarMigrationFormState>[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					onDeployChildUniverse: outcomeIndex => deployedOutcomes.push(outcomeIndex),
					onZoltarMigrationFormChange: update => formUpdates.push(update),
					zoltarUniverse: createUniverse({
						childUniverses: [
							{ exists: false, forkTime: 1n, outcomeIndex: 1n, outcomeLabel: 'Yes', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 2n },
							{ exists: true, forkTime: 1n, outcomeIndex: 2n, outcomeLabel: 'No', parentUniverseId: 1n, reputationToken: CHILD_REP_ADDRESS, reputationTokenName: 'No Reputation', reputationTokenSymbol: 'REP-NO', universeId: 3n },
						],
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const queries = within(document.body)
		const deployedLink = queries.getByRole('link', { name: 'Open universe' })
		expect(deployedLink.getAttribute('href')).toBe(getUniverseLinkHref(3n))
		expect(deployedLink.querySelector('[role="button"]')).toBeNull()
		expect(document.body.textContent).toContain('0x3')
		expect(document.body.textContent).toContain('No Reputation')
		queries.getByRole('button', { name: /^No/ }).click()
		expect(formUpdates).toEqual([{ outcomeIndexes: '1, 2' }])
		queries.getByRole('button', { name: 'Deploy universe' }).click()
		expect(deployedOutcomes).toEqual([1n])
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

	test('keeps split disabled off mainnet and explains recovery', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					isOnActiveAppChain: false,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Split REP')
		expect(document.body.textContent?.includes('Split the migration REP across the selected universes.')).toBe(false)
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet')).toBe(true)
	})

	test('places the migration summary below outcomes and before approval controls', async () => {
		const renderedComponent = await renderIntoDocument(h(ZoltarMigrationSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const outcomes = document.body.querySelector('.migration-outcome-section')
		expect(outcomes?.nextElementSibling?.textContent).toContain('Selected Destinations')
		expect(outcomes?.nextElementSibling?.nextElementSibling?.textContent).toContain('Approval Amount')
		expect(document.body.textContent?.includes('Ready to split.')).toBe(false)
	})

	test('reviews labeled child-universe outputs without consuming custody', async () => {
		const renderedComponent = await renderIntoDocument(h(ZoltarMigrationSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent).toContain('Yes')
		expect(document.body.textContent).toContain('0x2')
		expect(document.body.textContent).toContain('Child-Universe REP Received')
		expect(document.body.textContent).not.toContain('Technical Details')
		expect(document.body.textContent?.match(/Selected Destinations/g)).toHaveLength(1)
		expect(document.body.textContent).not.toContain('Balance Changes')
		expect(within(document.body).queryByRole('button', { name: 'Prepare REP' })).toBeNull()
		expect(within(document.body).getByRole('button', { name: 'Split REP' })).not.toBeNull()
	})

	test('splits fully prepared REP when the wallet balance read failed', async () => {
		const rendered = await renderIntoDocument(h(ZoltarMigrationSection, createProps({ zoltarForkRepBalanceAttoRep: undefined })))
		cleanupRenderedComponent = rendered.cleanup
		expectTransactionButtonEnabled(document.body, 'Split REP')
	})

	test('recovers a wallet-funded split by retrying the wallet balance read', async () => {
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
		expectTransactionButtonDisabled(document.body, 'Split REP', 'Could not read migration balances. Retry to continue.')
		await act(() => within(document.body).getByRole('button', { name: 'Retry' }).click())
		expectTransactionButtonEnabled(document.body, 'Split REP')
		expect(within(document.body).queryByRole('button', { name: 'Retry' })).toBeNull()
	})

	test('offers retry when migration history could not be read', async () => {
		let retries = 0
		const rendered = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarMigrationPreparedRepBalanceAttoRep: undefined,
					zoltarForkApproval: { error: undefined, loading: false, value: 0n },
					onRetryMigrationBalances: () => {
						retries += 1
					},
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(within(document.body).queryByRole('button', { name: /^Approve [0-9]/ })).toBeNull()
		expect(document.body.textContent).toContain('Wallet REP Used—')
		expectTransactionButtonDisabled(document.body, 'Split REP', 'Could not read migration balances. Retry to continue.')
		within(document.body).getByRole('button', { name: 'Retry' }).click()
		expect(retries).toBe(1)
	})

	test('uses historical splits instead of wallet holdings to prepare a repeat split', async () => {
		const preparations: bigint[] = []
		const universe = createUniverse()
		const rendered = await renderIntoDocument(
			h(
				ZoltarMigrationSection,
				createProps({
					zoltarUniverse: { ...universe, childUniverses: universe.childUniverses.map(child => ({ ...child, exists: true, reputationToken: CHILD_REP_ADDRESS })) },
					zoltarMigrationChildRepBalancesAttoRep: { '2': 0n },
					zoltarMigrationChildSplitAmountsAttoRep: { '2': 7n * ATTO_REP },
					onMigrateInternalRep: amount => preparations.push(amount),
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup
		expectTransactionButtonEnabled(document.body, 'Split REP')
		within(document.body).getByRole('button', { name: 'Split REP' }).click()
		expect(preparations).toEqual([7n * ATTO_REP])
	})

	test.each([
		{ name: 'partial preparation', prepared: 4n * ATTO_REP, allowance: 6n * ATTO_REP, wallet: 6n * ATTO_REP, enabled: true },
		{ name: 'insufficient approval', prepared: 4n * ATTO_REP, allowance: 5n * ATTO_REP, wallet: 6n * ATTO_REP, enabled: false },
		{ name: 'insufficient wallet REP', prepared: 4n * ATTO_REP, allowance: 6n * ATTO_REP, wallet: 5n * ATTO_REP, enabled: false },
		{ name: 'already prepared without approval', prepared: 10n * ATTO_REP, allowance: 0n, wallet: 0n, enabled: true },
	])('checks $name before splitting', async ({ prepared, allowance, wallet, enabled }) => {
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
		if (enabled) expectTransactionButtonEnabled(document.body, 'Split REP')
		else expectTransactionButtonDisabled(document.body, 'Split REP')
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
					zoltarMigrationChildSplitAmountsAttoRep: { '2': 5n * ATTO_REP },
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
					zoltarMigrationChildSplitAmountsAttoRep: { '2': 0n },
					zoltarUniverse: createUniverse({ childUniverses: [heldChild] }),
				}),
			),
		)
		cleanupRenderedComponent = withoutHeldTokens.cleanup
		expect(within(document.body).queryByRole('heading', { name: 'Wallet REP Tokens' })).toBeNull()
	})
})
