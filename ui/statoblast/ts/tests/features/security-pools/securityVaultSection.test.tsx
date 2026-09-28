/// <reference types="bun-types" />

import { createTransactionStepController, transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { signal } from '@preact/signals'
import { act } from 'preact/test-utils'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import type { GlobalTransactionPresentation } from '@zoltar/ui-core-shared/types/components.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createWalletActions, expectWalletFixDescribesAction } from '@zoltar/ui-core-shared/tests/testUtils/walletActions.js'
import { WalletActionsProvider } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled, getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { SecurityVaultDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { SecurityVaultSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityVaultSection.js'
import { SelectedVaultSummarySection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SelectedVaultSummarySection.js'
import { SelectedPoolRepPriceContext } from '@zoltar/ui-statoblast-shared/features/security-pools/components/RepPriceStatusLabel.js'
import { resolveRepPrice } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'
import { evaluateSecurityPoolState } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolState.js'
import type { SecurityVaultSectionProps } from '@zoltar/ui-zoltar-shared/features/types.js'
import type { AccountState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { describe, expect, test } from 'bun:test'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0xaa36a7',
		ethBalanceAttoEth: 0n,
		wethBalanceAttoEth: 0n,
		...overrides,
	}
}

function createSecurityVaultDetails(overrides: Partial<SecurityVaultDetails> = {}): SecurityVaultDetails {
	return {
		associatedRepPerCapacityBps: 75_000n,
		badDebtAttoEth: 0n,
		currentRetentionRate: 10n,
		disputeStakedAttoRep: 3n * 10n ** 18n,
		managerAddress: zeroAddress,
		openInterestAttoEth: 1n * 10n ** 18n,
		poolHeldRepPerCapacityBps: 60_000n,
		totalRepBackingUnits: 1n,
		vaultAttoRepBacking: 12n * 10n ** 18n,
		repToken: zeroAddress,
		underwritingLimitAttoEth: 2n * 10n ** 18n,
		securityPoolAddress: zeroAddress,
		totalUnderwritingLimitAttoEth: 3n * 10n ** 18n,
		claimableFeesAttoEth: 1n * 10n ** 18n,
		universeId: 1n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

function createSecurityVaultSectionProps(overrides: Partial<SecurityVaultSectionProps> = {}): SecurityVaultSectionProps {
	return {
		accountState: createAccountState(),
		loadingSecurityVault: false,
		onApproveRep: () => undefined,
		onSetVaultUnderwritingLimit: () => undefined,
		onDepositRepToVault: () => undefined,
		onLoadSecurityVault: () => undefined,
		onRedeemFees: () => undefined,
		onRedeemRepFromVault: () => undefined,
		onSecurityVaultFormChange: () => undefined,
		onWithdrawRep: () => undefined,
		oracleManagerDetails: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPoolVaults: undefined,
		securityVaultActiveAction: undefined,
		securityVaultDetails: createSecurityVaultDetails(),
		securityVaultError: undefined,
		securityVaultForm: {
			depositAmount: '',
			repWithdrawAmount: '',
			targetHealthFactor: '',
			securityPoolAddress: zeroAddress,
			selectedVaultOwner: zeroAddress,
		},
		securityVaultMissing: false,
		securityVaultRepApproval: {
			error: undefined,
			loading: false,
			value: 8n * 10n ** 18n,
		},
		walletRepBalanceAttoRep: undefined,
		securityVaultResult: undefined,
		selectedPoolStatoblastSecurityMultiplierBps: 20_000n,
		showHeader: false,
		...overrides,
		walletRepBalanceError: overrides.walletRepBalanceError,
		walletRepBalanceLoading: overrides.walletRepBalanceLoading ?? false,
	}
}

function createOracleManagerDetails(overrides: Partial<NonNullable<SecurityVaultSectionProps['oracleManagerDetails']>> = {}): NonNullable<SecurityVaultSectionProps['oracleManagerDetails']> {
	return {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: true,
		lastPrice: 3n * 10n ** 18n,
		lastSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		openOracleAddress: zeroAddress,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingSettlementOperationIds: [],
		pendingSettlementQueueCapacity: 4n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: 10n,
		queuedOperationCostAttoEth: 0n,
		requestPriceCostAttoEth: 0n,
		token1: undefined,
		token2: undefined,
		...overrides,
	}
}

function createEndedPoolState() {
	return evaluateSecurityPoolState({
		lifecycleState: 'ended',
		universeHasForked: false,
	})
}

const terminalOrdinaryGameCases = [
	{
		expectedReason: 'REP deposits are unavailable because this pool has ended. Available redemption and fee actions remain below.',
		lifecycleState: 'ended',
		name: 'ended',
		universeHasForked: false,
	},
	{
		expectedReason: 'REP-backing deposits and REP withdrawals are unavailable while this pool is in fork migration. Continue in Fork & migration. Fee claiming remains available only when this vault has accrued fees.',
		lifecycleState: 'poolForked',
		name: 'pool-forked',
		universeHasForked: true,
	},
	{
		expectedReason: 'REP-backing deposits and REP withdrawals are unavailable while this pool is in fork migration. Continue in Fork & migration. Fee claiming remains available only when this vault has accrued fees.',
		lifecycleState: 'forkMigration',
		name: 'fork-migration',
		universeHasForked: true,
	},
	{
		expectedReason: 'REP-backing deposits and REP withdrawals are unavailable while this pool is in a truth auction. Continue in Fork & migration. Fee claiming remains available only when this vault has accrued fees.',
		lifecycleState: 'forkTruthAuction',
		name: 'truth-auction',
		universeHasForked: true,
	},
] satisfies ReadonlyArray<{
	expectedReason: string
	lifecycleState: 'ended' | 'forkMigration' | 'forkTruthAuction' | 'poolForked'
	name: string
	universeHasForked: boolean
}>

describe('SecurityVaultSection', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test.each([true, false])('shows queued target operation status in the vault panel (automatic: %s)', async isPendingSlot => {
		const props = createSecurityVaultSectionProps({
			onViewStagedOperations: () => undefined,
			securityVaultResult: { action: 'setVaultUnderwritingLimit', hash: '0x01', queuedOperation: { operation: 'setVaultUnderwritingLimit', operationId: 42n, isPendingSlot } },
		})
		const rendered = await renderIntoDocument(<SecurityVaultSection {...props} />)
		try {
			expect(rendered.container.textContent).toContain('Commitment limit change queued')
			expect(rendered.container.textContent).toContain('#42')
			expect(rendered.container.textContent).toContain(isPendingSlot ? 'Executes automatically' : 'manual')
		} finally {
			rendered.cleanup()
		}
	})

	test('does not guess execution or retain a queued label after refreshed active state is empty', async () => {
		const rendered = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					oracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, stagedOperations: [], activeStagedOperationCount: 0n }),
					securityVaultResult: { action: 'setVaultUnderwritingLimit', hash: '0x01', queuedOperation: { operation: 'setVaultUnderwritingLimit', operationId: 42n, isPendingSlot: true } },
				})}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(within(document.body).getByText('Commitment limit change submitted')).toBeDefined()
		expect(within(document.body).queryByText('Commitment limit change queued')).toBeNull()
		expect(within(document.body).queryByText('Commitment limit changed')).toBeNull()
	})

	test.each([undefined, 'missing'] as const)('preserves a manual withdrawal receipt while exact status is unresolved: %s', async status => {
		const rendered = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					oracleManagerDetails: createOracleManagerDetails({ stagedOperations: [], activeStagedOperationCount: 30n }),
					onViewStagedOperations: () => undefined,
					securityVaultResult: { action: 'queueWithdrawRep', hash: '0x01', queuedOperation: { operation: 'withdrawRep', operationId: 42n, isPendingSlot: false }, ...(status === undefined ? {} : { queuedOperationState: { status } }) },
				})}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		fireEvent.click(within(document.body).getByRole('button', { name: 'Withdraw REP' }))
		expect(within(document.body).getByText('#42')).toBeDefined()
		expect(document.body.textContent).toContain('execute it manually')
		expect(within(document.body).getByRole('button', { name: 'View in staged operations' })).toBeDefined()
		expect(within(document.body).queryByText('REP withdrawal executed')).toBeNull()
	})

	test.each([
		['executed', 'Commitment limit changed'],
		['failed', 'Commitment limit change failed'],
		['expired', 'Queued operation expired'],
		['superseded', 'Target change replaced'],
	] as const)('renders the reconciled %s state with the original queued receipt', async (status, title) => {
		const rendered = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					securityVaultResult: { action: 'setVaultUnderwritingLimit', hash: '0x01', queuedOperation: { operation: 'setVaultUnderwritingLimit', operationId: 42n, isPendingSlot: true }, queuedOperationState: { status } },
				})}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(within(document.body).getByText(title)).toBeDefined()
		expect(within(document.body).queryByText('Commitment limit change queued')).toBeNull()
	})

	test.each(['manual-queued', 'executed'] as const)('shows tracked target %s independently of the latest fee claim', async status => {
		const rendered = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					securityVaultResult: { action: 'redeemFees', hash: '0x02' },
					securityVaultQueuedOperations: [{ action: 'setVaultUnderwritingLimit', hash: '0x01', queuedOperation: { operation: 'setVaultUnderwritingLimit', operationId: 42n, isPendingSlot: false }, queuedOperationState: { status } }],
				})}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(within(document.body).getByText(status === 'executed' ? 'Commitment limit changed' : 'Commitment limit change queued')).toBeDefined()
		if (status === 'manual-queued') expect(within(document.body).getByText('#42')).toBeDefined()
	})

	test('previews a standing ETH commitment and submits its limit', async () => {
		let submitted: string | undefined
		const rendered = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n, settlementCollateralAttoEth: 0n }),
					onSetVaultUnderwritingLimit: limit => {
						submitted = limit
					},
				})}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		fireEvent.click(page.getByRole('button', { name: 'Set commitment limit' }))
		const dialog = within(page.getByRole('dialog', { name: 'Set commitment limit' }))
		const input = dialog.getByLabelText('Commitment limit')
		if (!(input instanceof HTMLInputElement)) throw new Error('Expected commitment limit input')
		expect(input.value).toBe('2')
		fireEvent.input(input, { target: { value: 'invalid' } })
		expect(input.getAttribute('aria-invalid')).toBeNull()
		expectTransactionButtonDisabled(page.getByRole('dialog'), 'Set commitment limit')
		await act(() => {
			input.dispatchEvent(new Event('blur'))
		})
		const limitError = dialog.getByText('Commitment limit (ETH) must be a decimal number.')
		expect(limitError.classList.contains('field-error')).toBe(true)
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(input.getAttribute('aria-describedby')?.split(' ')[0]).toBe(limitError.id)
		expect(dialog.getByRole('button', { name: 'Set commitment limit' }).getAttribute('aria-describedby')).toBe(limitError.id)
		fireEvent.input(input, { target: { value: '2' } })
		expect(dialog.getByText('Current commitment')).toBeDefined()
		expect(dialog.getByText('Resulting commitment')).toBeDefined()
		expect(page.getByRole('dialog', { name: 'Set commitment limit' }).textContent?.replaceAll('\u00a0', ' ')).toMatch(/2(?:\.0+)?\s+ETH/)
		fireEvent.click(dialog.getByRole('button', { name: 'Set commitment limit' }))
		expect(submitted).toBe('2')
	})

	test.each(['operational', 'ended'] as const)('closed admission keeps the commitment exit form available: %s', async lifecycleState => {
		let submitted: string | undefined
		const props = createSecurityVaultSectionProps({
			modalFirst: true,
			poolState: evaluateSecurityPoolState({ lifecycleState, universeHasForked: false, vaultAdmissionClosed: true }),
			securityVaultDetails: createSecurityVaultDetails({ underwritingLimitAttoEth: 2n * 10n ** 18n, totalUnderwritingLimitAttoEth: 2n * 10n ** 18n, settlementCollateralAttoEth: 0n, disputeStakedAttoRep: 0n }),
			onSetVaultUnderwritingLimit: limit => {
				submitted = limit
			},
		})
		cleanupRenderedComponent = (await renderIntoDocument(<SecurityVaultSection {...props} />)).cleanup
		const page = within(document.body)
		expectTransactionButtonEnabled(document.body, 'Set commitment limit')
		expect(page.getByRole('button', { name: 'Set commitment limit' }).getAttribute('aria-describedby')).toBeNull()
		fireEvent.click(page.getByRole('button', { name: 'Set commitment limit' }))
		const dialog = page.getByRole('dialog', { name: 'Set commitment limit' })
		const input = within(dialog).getByLabelText('Commitment limit')
		fireEvent.input(input, { target: { value: '3' } })
		expectTransactionButtonDisabled(dialog, 'Set commitment limit')
		const sharedReason = within(dialog).getAllByText(lifecycleState === 'ended' ? 'REP deposits are unavailable because this pool has ended. Available redemption and fee actions remain below.' : 'New vault REP backing is unavailable after this question ends. Fork-continuation child pools remain fundable.')
		expect(sharedReason).toHaveLength(1)
		const sharedReasonId = sharedReason[0]?.id
		expect(sharedReasonId).toBeTruthy()
		expect(within(dialog).getByRole('button', { name: 'Set commitment limit' }).getAttribute('aria-describedby')?.split(' ')).toContain(sharedReasonId)
		expect(within(dialog).queryByRole('button', { name: 'Confirm backing for minting' })).toBeNull()
		fireEvent.input(input, { target: { value: '0' } })
		expectTransactionButtonEnabled(dialog, 'Set commitment limit')
		fireEvent.click(within(dialog).getByRole('button', { name: 'Set commitment limit' }))
		expect(submitted).toBe('0')
	})

	test.each([
		[true, false, false, 'Executes immediately with the current oracle price.'],
		[false, false, false, 'Queues for execution after oracle settlement.'],
		[false, true, false, 'Queues; manual execution may be needed after oracle settlement.'],
		[false, true, true, 'Queues for execution after oracle settlement.'],
	] as const)('shows the expected commitment execution mode: fresh=%s, full=%s, replacing=%s', async (fresh, full, replacing, message) => {
		cleanupRenderedComponent = (
			await renderIntoDocument(
				<ChainTimestampContext.Provider value={signal(2n)}>
					<SecurityVaultSection
						{...createSecurityVaultSectionProps({
							modalFirst: true,
							oracleManagerDetails: createOracleManagerDetails({
								isPriceValid: fresh,
								pendingSettlementOperationIds: full ? [1n, 2n, 3n, 4n] : [],
								pendingOperation: full ? { operation: 'setVaultUnderwritingLimit', operationId: 1n, targetVault: replacing ? zeroAddress : '0x0000000000000000000000000000000000000001', operator: zeroAddress, amount: 1n } : undefined,
							}),
							securityVaultDetails: createSecurityVaultDetails({ settlementCollateralAttoEth: 0n }),
						})}
					/>
				</ChainTimestampContext.Provider>,
			)
		).cleanup
		const page = within(document.body)
		fireEvent.click(page.getByRole('button', { name: 'Set commitment limit' }))
		const dialog = within(page.getByRole('dialog', { name: 'Set commitment limit' }))
		expect(dialog.getByText(message)).not.toBeNull()
		if (fresh || full) expect(dialog.queryByRole('button', { name: 'Manual price' })).toBeNull()
	})

	test('accepts a manual initial price for a queued commitment change', async () => {
		let submitted: { limit: string; price: bigint | undefined } | undefined
		cleanupRenderedComponent = (
			await renderIntoDocument(
				<SecurityVaultSection
					{...createSecurityVaultSectionProps({
						modalFirst: true,
						oracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
						securityVaultDetails: createSecurityVaultDetails({ settlementCollateralAttoEth: 0n }),
						onSetVaultUnderwritingLimit: (limit, price) => {
							submitted = { limit, price }
						},
					})}
				/>,
			)
		).cleanup
		const page = within(document.body)
		fireEvent.click(page.getByRole('button', { name: 'Set commitment limit' }))
		const dialog = page.getByRole('dialog', { name: 'Set commitment limit' })
		const queries = within(dialog)
		fireEvent.click(queries.getByRole('button', { name: 'Manual price' }))
		expectTransactionButtonDisabled(dialog, 'Set commitment limit')
		const input = queries.getByLabelText('Open Oracle REP/ETH starting price')
		for (const value of ['0', '-1', '1.0000000000000000001', 'invalid', (2n ** 256n).toString()]) {
			fireEvent.input(input, { target: { value } })
			expectTransactionButtonDisabled(dialog, 'Set commitment limit')
		}
		fireEvent.input(input, { target: { value: '12.5' } })
		expectTransactionButtonEnabled(dialog, 'Set commitment limit')
		fireEvent.click(queries.getByRole('button', { name: 'Set commitment limit' }))
		expect(submitted).toEqual({ limit: '2', price: 125n * 10n ** 17n })
		fireEvent.click(queries.getByRole('button', { name: 'Uniswap quote' }))
		fireEvent.click(queries.getByRole('button', { name: 'Set commitment limit' }))
		expect(submitted).toEqual({ limit: '2', price: undefined })
	})

	test('blocks a capacity reduction below collateral even after admission closes', async () => {
		const rendered = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({ modalFirst: true, poolState: evaluateSecurityPoolState({ lifecycleState: 'operational', universeHasForked: false, vaultAdmissionClosed: true }), securityVaultDetails: createSecurityVaultDetails({ settlementCollateralAttoEth: 2n * 10n ** 18n, disputeStakedAttoRep: 0n }) })}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		fireEvent.click(page.getByRole('button', { name: 'Set commitment limit' }))
		const dialog = within(page.getByRole('dialog', { name: 'Set commitment limit' }))
		fireEvent.input(dialog.getByLabelText('Commitment limit'), { target: { value: '0' } })
		expectTransactionButtonDisabled(page.getByRole('dialog'), 'Set commitment limit')
	})

	test('does not disable limit changes solely because dispute REP is committed', async () => {
		const rendered = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps({ securityVaultDetails: createSecurityVaultDetails({ settlementCollateralAttoEth: 0n, disputeStakedAttoRep: 1n }) })} />)
		cleanupRenderedComponent = rendered.cleanup
		expectTransactionButtonEnabled(document.body, 'Set commitment limit')
	})

	test('rejects an input whose resulting capacity leaves the vault undercollateralized', async () => {
		const rendered = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					oracleManagerDetails: createOracleManagerDetails(),
					selectedPoolStatoblastSecurityMultiplierBps: 20_000n,
					repPerEthPrice: 3n * 10n ** 18n,
					securityVaultDetails: createSecurityVaultDetails({ targetBackingFactorBps: 20_000n, vaultAttoRepBacking: 12n * 10n ** 18n, underwritingLimitAttoEth: 6n * 10n ** 18n, totalUnderwritingLimitAttoEth: 6n * 10n ** 18n, settlementCollateralAttoEth: 3n * 10n ** 18n, disputeStakedAttoRep: 0n, badDebtAttoEth: 0n }),
				})}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		fireEvent.click(page.getByRole('button', { name: 'Set commitment limit' }))
		const dialog = page.getByRole('dialog', { name: 'Set commitment limit' })
		fireEvent.input(within(dialog).getByLabelText('Commitment limit'), { target: { value: '7' } })
		expectTransactionButtonDisabled(dialog, 'Set commitment limit')
		expect(within(dialog).getByText('Deposit more REP before increasing this commitment limit.')).not.toBeNull()
	})

	test.each([
		['Uniswap price is higher', 3n, 1n, 1n, false],
		['Uniswap price is lower', 1n, 3n, 1n, true],
		['coordinator price has expired', 3n, 3n, 10n, false],
	] as const)('uses only a valid coordinator price to block adjustments: %s', async (_scenario, displayPrice, coordinatorPrice, timestamp, blocked) => {
		const rendered = await renderIntoDocument(
			<ChainTimestampContext.Provider value={timestamp}>
				<SecurityVaultSection
					{...createSecurityVaultSectionProps({
						modalFirst: true,
						repPerEthPrice: displayPrice * 10n ** 18n,
						repPerEthSource: timestamp === 10n ? 'open-oracle' : 'v3',
						oracleManagerDetails: createOracleManagerDetails({ lastPrice: coordinatorPrice * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							targetBackingFactorBps: 20_000n,
							vaultAttoRepBacking: 12n * 10n ** 18n,
							underwritingLimitAttoEth: 1n * 10n ** 18n,
							totalUnderwritingLimitAttoEth: 10n * 10n ** 18n,
							settlementCollateralAttoEth: 3n * 10n ** 18n,
							disputeStakedAttoRep: 0n,
							badDebtAttoEth: 0n,
						}),
					})}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		fireEvent.click(within(document.body).getByRole('button', { name: 'Set commitment limit' }))
		const dialog = within(document.body).getByRole('dialog', { name: 'Set commitment limit' })
		fireEvent.input(within(dialog).getByLabelText('Commitment limit'), { target: { value: '3' } })
		if (blocked) expectTransactionButtonDisabled(dialog, 'Set commitment limit')
		else expectTransactionButtonEnabled(dialog, 'Set commitment limit')
	})

	test('uses a saved target as read-only context for later deposits', async () => {
		const rendered = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps({ securityVaultDetails: createSecurityVaultDetails({ targetBackingFactorBps: 20_000n }) })} />)
		cleanupRenderedComponent = rendered.cleanup
		const page = within(document.body)
		expect([...document.querySelectorAll('label')].filter(label => label.textContent?.includes('Commitment limit') && document.getElementById(label.htmlFor) instanceof HTMLInputElement)).toHaveLength(1)
		expect(page.getAllByText('Commitment limit').length).toBeGreaterThan(0)
		expect(document.body.textContent).toContain('2×')
	})

	test('shows the selected child REP symbol on vault action controls', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps({ securityVaultDetails: createSecurityVaultDetails({ repTokenSymbol: 'REP4' }) })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByRole('button', { name: 'Deposit REP4' }).length).toBeGreaterThan(0)
		expect(documentQueries.getAllByRole('button', { name: 'Withdraw REP4' }).length).toBeGreaterThan(0)
	})

	test('renders the shared selected-vault metric summary', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps({ repPerEthPrice: 3n * 10n ** 18n })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const selectedVaultHeading = documentQueries.getByRole('heading', { name: 'My vault' })
		const selectedVaultCard = selectedVaultHeading.closest('.entity-card')
		if (!(selectedVaultCard instanceof HTMLElement)) throw new Error('Expected a selected vault summary card')
		const selectedVaultQueries = within(selectedVaultCard)
		expect(selectedVaultQueries.getByText('Vault REP backing')).not.toBeNull()
		expect(selectedVaultQueries.queryByText('Approved REP')).toBeNull()
		expect(selectedVaultQueries.getByText('Dispute-staked REP')).not.toBeNull()
		expect(selectedVaultQueries.getByText('Associated backing ratio')).not.toBeNull()
		expect(selectedVaultQueries.getByText('7.5×')).not.toBeNull()
		expect(selectedVaultQueries.queryByText('Pool-held REP per committed ETH')).toBeNull()
	})

	test('colors associated REP per capacity green when the vault remains comfortably above the security multiplier', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={undefined}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				currentVaultIsHealthy
				securityVaultDetails={createSecurityVaultDetails()}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body).getByText('7.5×').closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-success')
		expect(within(document.body).getByText('Healthy')).not.toBeNull()
	})

	test('colors associated REP per capacity yellow when the vault is near the security multiplier', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={undefined}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				currentVaultIsHealthy
				securityVaultDetails={createSecurityVaultDetails({ associatedRepPerCapacityBps: 20_500n })}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body).getByText('2.05×').closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-warning')
		expect(within(document.body).getByText('Near minimum')).not.toBeNull()
	})

	test('colors associated REP per capacity red when the current vault health is underwater', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={undefined}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				currentVaultIsHealthy={false}
				securityVaultDetails={createSecurityVaultDetails()}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body).getByText('7.5×').closest('.metric-field-value')
		expect(metricValue?.className).toContain('metric-value-danger')
		expect(within(document.body).getByText('Underwater')).not.toBeNull()
	})

	test('does not infer vault health text from associated REP per capacity when current health is unavailable', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={undefined}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				currentVaultIsHealthy={undefined}
				securityVaultDetails={createSecurityVaultDetails({ associatedRepPerCapacityBps: 19_000n })}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricValue = within(document.body).getByText('1.9×').closest('.metric-field-value')
		expect(metricValue?.className).not.toContain('metric-value-danger')
		expect(within(document.body).queryByText('Healthy')).toBeNull()
		expect(within(document.body).queryByText('Near minimum')).toBeNull()
		expect(within(document.body).queryByText('Underwater')).toBeNull()
	})

	test.each(['', '0'])('shares one amount notice above approval and deposit for %s in the dialog', async amount => {
		const props = createSecurityVaultSectionProps({ modalFirst: true })
		const rendered = await renderIntoDocument(<SecurityVaultSection {...props} securityVaultForm={{ ...props.securityVaultForm, depositAmount: amount }} />)
		cleanupRenderedComponent = rendered.cleanup
		fireEvent.click(within(document.body).getByRole('button', { name: 'Deposit REP' }))
		const dialog = within(document.body).getByRole('dialog', { name: 'Deposit REP' })
		const group = dialog.querySelector('.tx-action-group')
		expect(group?.querySelectorAll('[role="note"]').length).toBe(1)
		const notice = group?.querySelector('[role="note"]')
		expect(notice?.textContent).toBe(amount === '' ? 'Enter a valid REP deposit amount.' : 'Enter an amount greater than zero.')
		for (const button of group?.querySelectorAll('.tx-action-button') ?? []) {
			expect(button.getAttribute('aria-describedby')).toBe(notice?.id)
		}
		expect(group?.firstElementChild?.className).toBe('tx-action-feedback')
	})

	for (const [dialogName, blockedAccount, fixLabel] of [
		['Deposit REP', createAccountState({ address: undefined }), 'Connect wallet'],
		['Withdraw REP', createAccountState({ chainId: '0x1' }), 'Switch to Sepolia'],
		['Set commitment limit', createAccountState({ address: undefined }), 'Connect wallet'],
	] as const)
		test(`offers the ${fixLabel} fix inside the ${dialogName} dialog when the wallet changes while it is open`, async () => {
			const { calls, walletActions } = createWalletActions()
			const accountState = signal<AccountState>(createAccountState())
			const props = createSecurityVaultSectionProps({ modalFirst: true, securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n, settlementCollateralAttoEth: 0n }) })
			const Harness = () => (
				<WalletActionsProvider walletActions={walletActions}>
					<SecurityVaultSection {...props} accountState={accountState.value} securityVaultForm={{ ...props.securityVaultForm, depositAmount: '1', repWithdrawAmount: '1' }} />
				</WalletActionsProvider>
			)
			const rendered = await renderIntoDocument(<Harness />)
			cleanupRenderedComponent = rendered.cleanup
			fireEvent.click(within(document.body).getByRole('button', { name: dialogName }))
			await act(() => {
				accountState.value = blockedAccount
			})
			const dialog = within(document.body).getByRole('dialog', { name: dialogName })
			const fix = expectWalletFixDescribesAction(dialog, dialogName, fixLabel)
			await act(() => fireEvent.click(fix))
			expect(calls).toEqual([fixLabel === 'Connect wallet' ? 'connect' : 'switch'])
		})

	test('distinguishes a wallet REP balance failure from an unloaded balance', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps({ walletRepBalanceError: 'Wallet REP balance RPC failed' })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByRole('alert').textContent).toContain('Wallet REP balance RPC failed')
	})

	test('shows wallet REP loading while the deposit balance read is pending', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps({ modalFirst: true, walletRepBalanceLoading: true })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Deposit REP' }))
		expect(within(documentQueries.getByRole('dialog', { name: 'Deposit REP' })).getByText('Loading')).not.toBeNull()
	})

	test('keeps a wallet REP balance failure accessible inside the deposit dialog', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps({ modalFirst: true, walletRepBalanceError: 'Wallet REP balance RPC failed' })} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getByRole('button', { name: 'Deposit REP' }))
		expect(within(documentQueries.getByRole('dialog', { name: 'Deposit REP' })).getByRole('alert').textContent).toContain('Wallet REP balance RPC failed')
	})

	test('keeps nonzero dispute-staked REP visible in the embedded selected-vault action summary', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={undefined}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				securityVaultDetails={createSecurityVaultDetails({ disputeStakedAttoRep: 3n * 10n ** 18n })}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
				variant='embedded'
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const escalationMetric = within(document.body).getByText('Dispute-staked REP').closest('.security-pool-browse-vault-row-kpi')
		if (!(escalationMetric instanceof HTMLElement)) throw new Error('Expected the embedded dispute-staked REP metric')
		expect(escalationMetric.textContent).toContain('3.00 REP')
	})

	test('keeps zero dispute-staked REP explicit in the embedded selected-vault action summary', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={undefined}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={2n * 10n ** 18n}
				securityVaultDetails={createSecurityVaultDetails({ disputeStakedAttoRep: 0n })}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
				variant='embedded'
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const escalationMetric = within(document.body).getByText('Dispute-staked REP').closest('.security-pool-browse-vault-row-kpi')
		if (!(escalationMetric instanceof HTMLElement)) throw new Error('Expected the embedded dispute-staked REP metric')
		expect(escalationMetric.textContent).toContain('0 REP')
	})

	test('expands the embedded selected-vault summary grid for nonzero bad debt', async () => {
		const renderedComponent = await renderIntoDocument(
			<SelectedVaultSummarySection
				repPerEthPrice={undefined}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				underwritingLimitAttoEth={0n}
				securityVaultDetails={createSecurityVaultDetails({ badDebtAttoEth: 2n })}
				selectedPoolStatoblastSecurityMultiplierBps={20_000n}
				selectedVaultIsOwnedByAccount
				variant='embedded'
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const summaryGrid = document.querySelector('.security-pool-browse-vault-row-top-compact')
		if (!(summaryGrid instanceof HTMLElement)) throw new Error('Expected the embedded selected-vault summary grid')
		expect(summaryGrid.classList.contains('with-bad-debt')).toBe(true)
	})

	test('hides stale vault details when the current pool selection no longer matches the loaded vault', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					securityVaultDetails: createSecurityVaultDetails({
						securityPoolAddress: '0x00000000000000000000000000000000000000a1',
					}),
					securityVaultForm: {
						depositAmount: '',
						repWithdrawAmount: '',
						targetHealthFactor: '',
						securityPoolAddress: '0x00000000000000000000000000000000000000a2',
						selectedVaultOwner: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Selected Vault')).toBeNull()
		expect(documentQueries.getAllByText('Selected vault details are unavailable.').length).toBeGreaterThan(0)
		expect(documentQueries.queryByText('Refresh the vault to inspect claimable fees.')).toBeNull()
		expect(documentQueries.queryByText('Refresh the vault before setting a underwriting commitments.')).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Claim fees')
	})

	test('directs a missing vault lookup to another vault owner address', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					securityVaultDetails: undefined,
					securityVaultMissing: true,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Try another vault owner address.')).not.toBeNull()
		expect(documentQueries.queryByText('Try another pool address.')).toBeNull()
	})

	test('keeps fee-claim actions available when a zeroed vault still has claimable fees', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						disputeStakedAttoRep: 0n,
						vaultAttoRepBacking: 0n,
						underwritingLimitAttoEth: 0n,
						claimableFeesAttoEth: 1n * 10n ** 18n,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('This vault does not exist. Deposit REP to create it.')).toBeNull()
		expectTransactionButtonEnabled(document.body, 'Claim fees')
	})

	test('blocks the modal-first claim fees launcher when an existing vault has no claimable fees', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					poolState: evaluateSecurityPoolState({
						lifecycleState: 'forkMigration',
						universeHasForked: true,
					}),
					securityVaultDetails: createSecurityVaultDetails({
						claimableFeesAttoEth: 0n,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const claimFeesButton = documentQueries.getByRole('button', { name: 'Claim fees' })
		const claimFeesReason = documentQueries.getByText('No fees are available to claim.')

		expectTransactionButtonDisabled(document.body, 'Claim fees', 'No fees are available to claim.')
		expect(claimFeesButton.getAttribute('aria-describedby')).toBe(claimFeesReason.id)
		fireEvent.click(claimFeesButton)
		expect(documentQueries.queryByRole('dialog', { name: 'Claim fees' })).toBeNull()
	})

	test('labels withdrawable REP with the source and staleness of the price it uses', async () => {
		const repPrice = resolveRepPrice({ now: 10n ** 6n, poolOracle: { price: 3n * 10n ** 18n, settlementTimestamp: 1n }, setting: 'open-oracle', uniswapPrice: undefined })
		const renderedComponent = await renderIntoDocument(
			<SelectedPoolRepPriceContext.Provider value={repPrice}>
				<SecurityVaultSection {...createSecurityVaultSectionProps({ modalFirst: true, repPerEthPrice: repPrice.price, selectedPoolStatoblastSecurityMultiplierBps: 20_000n })} />
			</SelectedPoolRepPriceContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		fireEvent.click(within(document.body).getByRole('button', { name: 'Withdraw REP' }))
		const label = within(document.body).getByRole('dialog', { name: 'Withdraw REP' }).querySelector('.rep-price-status')
		expect(label?.classList.contains('stale')).toBe(true)
	})

	test('uses neutral missing-state copy when a queued withdrawal succeeds before manager state is visible', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					oracleManagerDetails: createOracleManagerDetails({
						isPriceValid: false,
						pendingOperation: undefined,
					}),
					securityVaultForm: {
						depositAmount: '1',
						repWithdrawAmount: '1',
						targetHealthFactor: '2',
						securityPoolAddress: zeroAddress,
						selectedVaultOwner: zeroAddress,
					},
					securityVaultResult: {
						action: 'queueWithdrawRep',
						hash: '0x01',
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw REP' }))
		const dialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		expect(within(dialog).getByText('The transaction succeeded, but the latest manager state is not available.')).not.toBeNull()
		expect(documentQueries.queryByText('Refresh staged operations to confirm the latest manager state.')).toBeNull()
	})

	test('labels queued vault operation amounts with exact human units', async () => {
		for (const queuedCase of [{ action: 'queueWithdrawRep' as const, amountLabel: 'REP withdrawal', amountText: '5 REP', operation: 'withdrawRep' as const, openLabel: 'Withdraw REP' }]) {
			const renderedComponent = await renderIntoDocument(
				<SecurityVaultSection
					{...createSecurityVaultSectionProps({
						modalFirst: true,
						oracleManagerDetails: createOracleManagerDetails({
							pendingOperation: { amount: 5n * 10n ** 18n, operator: zeroAddress, operation: queuedCase.operation, operationId: 7n, targetVault: zeroAddress },
							pendingOperationSlotId: 7n,
							pendingSettlementOperationIds: [7n],
						}),
						securityVaultResult: { action: queuedCase.action, hash: '0x01' },
					})}
				/>,
			)
			try {
				const documentQueries = within(document.body)
				fireEvent.click(documentQueries.getByRole('button', { name: queuedCase.openLabel }))
				const dialog = documentQueries.getByRole('dialog', { name: queuedCase.openLabel })
				expect(within(dialog).getByText(queuedCase.amountLabel)).not.toBeNull()
				expect(within(dialog).getByText(queuedCase.amountText)).not.toBeNull()
			} finally {
				await renderedComponent.cleanup()
			}
		}
	})

	test('shows the shared failed badge when a queued withdrawal fails', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					securityVaultResult: {
						action: 'queueWithdrawRep',
						hash: '0x03',
						stagedExecution: {
							errorMessage: 'The transaction failed.',
							operation: 'withdrawRep',
							operationId: 7n,
							success: false,
						},
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw REP' }))
		const dialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		expect(within(dialog).getByText('Failed')).not.toBeNull()
		expect(within(dialog).getByText('The transaction failed.')).not.toBeNull()
	})

	test('keeps the modal-first claim fees launcher silently disabled when lifecycle gating blocks it', async () => {
		const endedPoolState = createEndedPoolState()
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					poolState: {
						...endedPoolState,
						actions: {
							...endedPoolState.actions,
							redeemFees: { enabled: false },
						},
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Claim fees')
	})

	test('explains fork lifecycle gating once for the complete vault action group', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					extraReadinessActions: [
						{
							actionLabel: 'Review Special Action',
							blocker: 'Complete its separate prerequisite.',
							key: 'special-action',
							readiness: 'blocked',
							title: 'Review Special Action',
						},
					],
					modalFirst: true,
					poolState: evaluateSecurityPoolState({
						lifecycleState: 'forkMigration',
						universeHasForked: true,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const lifecycleReason = documentQueries.getByText('REP-backing deposits and REP withdrawals are unavailable while this pool is in fork migration. Continue in Fork & migration. Fee claiming remains available only when this vault has accrued fees.')
		for (const actionLabel of ['Deposit REP', 'Withdraw REP']) {
			const button = documentQueries.getByRole('button', { name: actionLabel })
			expect(button.getAttribute('aria-describedby')).toBe(lifecycleReason.id)
			expectTransactionButtonDisabled(document.body, actionLabel)
		}
		expect(getTransactionButtonState(document.body, 'Review Special Action')).toEqual({ disabled: true, reason: 'Complete its separate prerequisite.' })
		const specialActionReason = documentQueries.getByText('Complete its separate prerequisite.')
		expect(documentQueries.getByRole('button', { name: 'Review Special Action' }).getAttribute('aria-describedby')).toBe(specialActionReason.id)
	})

	test('blocks closed origin-vault admission while preserving vault withdrawals', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					poolState: evaluateSecurityPoolState({
						lifecycleState: 'operational',
						universeHasForked: false,
						vaultAdmissionClosed: true,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const reason = 'New vault REP backing is unavailable after this question ends. Fork-continuation child pools remain fundable.'
		const documentQueries = within(document.body)
		const reasonElement = documentQueries.getByText(reason)
		const depositButton = documentQueries.getByRole('button', { name: 'Deposit REP' })
		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expect(depositButton.getAttribute('aria-describedby')).toBe(reasonElement.id)
		expectTransactionButtonEnabled(document.body, 'Withdraw REP')
		fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw REP' }))
		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		const withdrawAmountInput = within(withdrawDialog).getByLabelText('REP withdraw amount') as HTMLInputElement
		const timeoutInput = within(withdrawDialog).getByText('Manual execution timeout').parentElement?.querySelector('input')
		expect(withdrawAmountInput?.disabled).toBe(false)
		expect(timeoutInput?.disabled).toBe(false)
	})

	test.each(terminalOrdinaryGameCases)('prioritizes $name lifecycle recovery after vault admission has closed', async ({ expectedReason, lifecycleState, universeHasForked }) => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					poolState: evaluateSecurityPoolState({
						lifecycleState,
						universeHasForked,
						vaultAdmissionClosed: true,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const reasonElement = documentQueries.getByText(expectedReason)
		const depositButton = documentQueries.getByRole('button', { name: 'Deposit REP' })
		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expect(depositButton.getAttribute('aria-describedby')).toBe(reasonElement.id)
		expect(documentQueries.queryByText('New vault REP backing is unavailable after this question ends. Fork-continuation child pools remain fundable.')).toBeNull()
	})

	test('preserves wallet recovery for lifecycle-enabled redemption after the pool ends', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({ address: undefined }),
					modalFirst: true,
					poolState: createEndedPoolState(),
					securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n }),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionButtonState(document.body, 'Redeem REP')).toEqual({ disabled: true, reason: 'Connect a wallet before redeeming REP.' })
	})

	test('shows explicit modal-first vault blockers when the wallet is disconnected', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({ address: undefined }),
					modalFirst: true,
					securityVaultForm: {
						depositAmount: '1',
						repWithdrawAmount: '1',
						targetHealthFactor: '2',
						securityPoolAddress: zeroAddress,
						selectedVaultOwner: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionButtonState(document.body, 'Deposit REP')).toEqual({ disabled: true, reason: 'Connect a wallet before depositing REP.' })
		expect(getTransactionButtonState(document.body, 'Claim fees')).toEqual({ disabled: true, reason: 'Connect a wallet before claiming fees.' })
	})

	test('shows explicit modal-first vault blockers for a vault owned by another account', async () => {
		const otherVaultAddress = '0x00000000000000000000000000000000000000a9'
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({ address: zeroAddress }),
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						vaultAddress: otherVaultAddress,
					}),
					securityVaultForm: {
						depositAmount: '1',
						repWithdrawAmount: '1',
						targetHealthFactor: '2',
						securityPoolAddress: zeroAddress,
						selectedVaultOwner: otherVaultAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionButtonState(document.body, 'Deposit REP')).toEqual({ disabled: true, reason: 'Select your own vault to deposit REP.' })
		expect(getTransactionButtonState(document.body, 'Claim fees')).toEqual({ disabled: true, reason: 'Select your own vault to claim fees.' })
	})

	test('explains how to recover when no REP is available to create the selected vault', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						disputeStakedAttoRep: 0n,
						vaultAttoRepBacking: 0n,
						underwritingLimitAttoEth: 0n,
						claimableFeesAttoEth: 0n,
					}),
					walletRepBalanceAttoRep: 0n,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionButtonState(document.body, 'Deposit REP')).toEqual({
			disabled: true,
			reason: 'No REP is available in the active universe. Obtain or migrate REP into this universe before creating a vault.',
		})
	})

	test('keeps the deposit modal in create-vault mode for an empty selected vault', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						disputeStakedAttoRep: 0n,
						vaultAttoRepBacking: 0n,
						underwritingLimitAttoEth: 0n,
						claimableFeesAttoEth: 0n,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Deposit REP' }))

		const depositDialog = documentQueries.getByRole('dialog', { name: 'Deposit REP' })
		const depositDialogQueries = within(depositDialog)
		expect(depositDialog.querySelector('.transaction-object-context')).toBeNull()
		expect(depositDialogQueries.queryByRole('heading', { name: 'Vault summary' })).toBeNull()
		expect(depositDialogQueries.getByText('This vault does not exist. Deposit REP to create it.')).not.toBeNull()
		expect(depositDialogQueries.getByText('REP backing')).not.toBeNull()
	})

	test('deposits do not require a commitment limit in embedded and modal layouts', async () => {
		for (const modalFirst of [false, true]) {
			const renderedComponent = await renderIntoDocument(
				<SecurityVaultSection
					{...createSecurityVaultSectionProps({
						modalFirst,
						securityVaultForm: {
							depositAmount: '1',
							repWithdrawAmount: '1',
							targetHealthFactor: '',
							securityPoolAddress: zeroAddress,
							selectedVaultOwner: zeroAddress,
						},
					})}
				/>,
			)
			const documentQueries = within(document.body)
			if (modalFirst) fireEvent.click(documentQueries.getByRole('button', { name: 'Deposit REP' }))
			const scope = modalFirst ? within(documentQueries.getByRole('dialog', { name: 'Deposit REP' })) : documentQueries
			if (modalFirst) expect(scope.queryByRole('textbox', { name: 'Commitment limit' })).toBeNull()
			expect(scope.getByRole('button', { name: 'Deposit REP' }).getAttribute('disabled')).toBeNull()
			renderedComponent.cleanup()
		}
		cleanupRenderedComponent = undefined
	})

	test('uses the loaded pool minimum for a new-vault deposit', async () => {
		const configuredMinimum = 30n * 10n ** 18n
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({ ethBalanceAttoEth: 1n, wethBalanceAttoEth: 0n }),
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						disputeStakedAttoRep: 0n,
						vaultAttoRepBacking: 0n,
						underwritingLimitAttoEth: 0n,
						claimableFeesAttoEth: 0n,
						minimumVaultRepDepositAttoRep: configuredMinimum,
					}),
					securityVaultForm: {
						depositAmount: '20',
						repWithdrawAmount: '',
						targetHealthFactor: '2',
						securityPoolAddress: zeroAddress,
						selectedVaultOwner: zeroAddress,
					},
					securityVaultRepApproval: { error: undefined, loading: false, value: configuredMinimum },
					walletRepBalanceAttoRep: 100n * 10n ** 18n,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Deposit REP' }))
		expectTransactionButtonDisabled(documentQueries.getByRole('dialog', { name: 'Deposit REP' }), 'Deposit REP', 'New vaults require at least 30\u00a0REP in the first deposit.')
	})

	test('allows REP withdrawal staging when the oracle price is stale but fresh-report funding is available', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({
						ethBalanceAttoEth: 2n * 10n ** 18n,
					}),
					oracleManagerDetails: {
						...createOracleManagerDetails(),
						isPriceValid: false,
						requestPriceCostAttoEth: 1n,
					},
					securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n }),
					securityVaultForm: {
						depositAmount: '',
						repWithdrawAmount: '1',
						targetHealthFactor: '',
						securityPoolAddress: zeroAddress,
						selectedVaultOwner: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Withdraw REP')
	})

	test('withdrawal accepts a manual initial price and rejects an empty one', async () => {
		let submitted: bigint | undefined
		cleanupRenderedComponent = (
			await renderIntoDocument(
				<SecurityVaultSection
					{...createSecurityVaultSectionProps({
						oracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
						securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n }),
						onWithdrawRep: price => {
							submitted = price
						},
						securityVaultForm: { ...createSecurityVaultSectionProps().securityVaultForm, repWithdrawAmount: '1' },
					})}
				/>,
			)
		).cleanup
		const withdrawal = within(document.body).getByRole('heading', { name: 'Withdraw REP', exact: true }).closest('section')
		if (withdrawal === null) throw new Error('Expected withdrawal section')
		const page = within(withdrawal)
		fireEvent.click(page.getByRole('button', { name: 'Manual price' }))
		expectTransactionButtonDisabled(document.body, 'Withdraw REP')
		fireEvent.input(page.getByLabelText('Open Oracle REP/ETH starting price'), { target: { value: '3' } })
		expectTransactionButtonEnabled(document.body, 'Withdraw REP')
		fireEvent.click(page.getByRole('button', { name: 'Withdraw REP' }))
		expect(submitted).toBe(3n * 10n ** 18n)
		expect(page.getByText('Queues for execution after oracle settlement.')).toBeDefined()
	})

	test('keeps the switch fix ahead of a missing manual withdrawal price', async () => {
		const { walletActions } = createWalletActions()
		cleanupRenderedComponent = (
			await renderIntoDocument(
				<WalletActionsProvider walletActions={walletActions}>
					<SecurityVaultSection
						{...createSecurityVaultSectionProps({
							accountState: createAccountState({ chainId: '0x1' }),
							oracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
							securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n }),
							securityVaultForm: { ...createSecurityVaultSectionProps().securityVaultForm, repWithdrawAmount: '1' },
						})}
					/>
				</WalletActionsProvider>,
			)
		).cleanup
		const withdrawal = within(document.body).getByRole('heading', { name: 'Withdraw REP', exact: true }).closest('section')
		if (!(withdrawal instanceof HTMLElement)) throw new Error('Expected withdrawal section')
		fireEvent.click(within(withdrawal).getByRole('button', { name: 'Manual price' }))
		expectWalletFixDescribesAction(withdrawal, 'Withdraw REP', 'Switch to Sepolia')
	})

	test('blocks pool-held vault REP backing withdrawal while escalation deposits remain unsettled', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					securityVaultDetails: createSecurityVaultDetails({
						disputeStakedAttoRep: 3n * 10n ** 18n,
						vaultAttoRepBacking: 20n * 10n ** 18n,
					}),
					securityVaultForm: {
						depositAmount: '',
						repWithdrawAmount: '1',
						targetHealthFactor: '',
						securityPoolAddress: zeroAddress,
						selectedVaultOwner: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Withdraw REP', 'Settle escalation deposits before withdrawing REP.')
	})

	test('requires fresh-report funding for vault actions at the exact oracle-price expiry boundary', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={10n}>
				<SecurityVaultSection
					{...createSecurityVaultSectionProps({
						oracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							priceValidUntilTimestamp: 10n,
							requestPriceCostAttoEth: 1n * 10n ** 18n,
						}),
						securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							targetHealthFactor: '2',
							securityPoolAddress: zeroAddress,
							selectedVaultOwner: zeroAddress,
						},
					})}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Withdraw REP', 'Need 1.2\u00a0more\u00a0ETH in this wallet to queue this REP withdrawal.')
	})

	test('does not require fresh-report funding immediately before oracle-price expiry', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={9n}>
				<SecurityVaultSection
					{...createSecurityVaultSectionProps({
						oracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							priceValidUntilTimestamp: 10n,
							requestPriceCostAttoEth: 1n * 10n ** 18n,
						}),
						securityVaultDetails: createSecurityVaultDetails({
							disputeStakedAttoRep: 0n,
							vaultAttoRepBacking: 13n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							targetHealthFactor: '2',
							securityPoolAddress: zeroAddress,
							selectedVaultOwner: zeroAddress,
						},
					})}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Withdraw REP')
	})

	test('does not infer immediate withdrawal execution from an expired raw validity flag', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={10n}>
				<SecurityVaultSection
					{...createSecurityVaultSectionProps({
						modalFirst: true,
						oracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							priceValidUntilTimestamp: 10n,
						}),
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000a1',
						},
					})}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		fireEvent.click(within(document.body).getByRole('button', { name: 'Withdraw REP' }))

		expect(within(document.body).getByRole('heading', { name: 'REP withdrawal submitted' })).not.toBeNull()
		expect(within(document.body).queryByRole('heading', { name: 'REP withdrawal executed' })).toBeNull()
	})

	test('defaults queued self-service timeout copy to 5 minutes when the form has no explicit timeout', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					oracleManagerDetails: createOracleManagerDetails(),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('If queued, this operation expires 5m after the oracle settlement window completes.')).toBe(true)
	})

	test('does not render a local vault transaction status card', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					securityVaultResult: {
						action: 'depositRepToVault',
						hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(document.body.querySelector('.workflow-transaction-status')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Latest Vault Action' })).toBeNull()
	})

	test('allows REP redemption after the selected pool has ended while keeping collateral changes locked', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					oracleManagerDetails: createOracleManagerDetails(),
					poolState: createEndedPoolState(),
					securityVaultDetails: createSecurityVaultDetails({
						disputeStakedAttoRep: 0n,
					}),
					securityVaultForm: {
						depositAmount: '1',
						repWithdrawAmount: '1',
						targetHealthFactor: '2',
						securityPoolAddress: zeroAddress,
						selectedVaultOwner: zeroAddress,
					},
					walletRepBalanceAttoRep: 10n * 10n ** 18n,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expectTransactionButtonEnabled(document.body, 'Redeem REP')
		expectTransactionButtonEnabled(document.body, 'Claim fees')
	})

	test('disables REP approval after the selected pool has ended', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					poolState: createEndedPoolState(),
					securityVaultForm: {
						depositAmount: '1',
						repWithdrawAmount: '',
						targetHealthFactor: '',
						securityPoolAddress: zeroAddress,
						selectedVaultOwner: zeroAddress,
					},
					securityVaultRepApproval: {
						error: undefined,
						loading: false,
						value: 0n,
					},
					walletRepBalanceAttoRep: 10n * 10n ** 18n,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Approve 1 REP')
	})

	test('keeps REP redemption blocked until escalation deposits are settled after the pool ends', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					poolState: createEndedPoolState(),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Redeem REP', 'Settle escalation deposits before redeeming REP.')
	})

	test('disables modal-first vault launchers when a guard blocker is present', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({ address: undefined }),
					modalFirst: true,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const depositLauncher = documentQueries.getByRole('button', { name: 'Deposit REP' })
		if (!(depositLauncher instanceof HTMLButtonElement)) throw new Error('Expected a deposit launcher button')
		expect(depositLauncher.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Deposit REP').reason).toBe('Connect a wallet before depositing REP.')
	})

	test('keeps modal-first vault launchers disabled off Sepolia with recovery guidance', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({ chainId: '0x2105' }),
					modalFirst: true,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const depositLauncher = documentQueries.getByRole('button', { name: 'Deposit REP' })
		if (!(depositLauncher instanceof HTMLButtonElement)) throw new Error('Expected a deposit launcher button')
		expect(depositLauncher.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Deposit REP').reason).toBe('Switch to Sepolia.')
	})

	test('prioritizes wrong-network recovery for modal-first vault launchers owned by another account', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({ chainId: '0x2105' }),
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						vaultAddress: '0x00000000000000000000000000000000000000a1',
					}),
					securityVaultForm: {
						depositAmount: '',
						repWithdrawAmount: '',
						targetHealthFactor: '',
						securityPoolAddress: zeroAddress,
						selectedVaultOwner: '0x00000000000000000000000000000000000000a1',
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const depositLauncher = documentQueries.getByRole('button', { name: 'Deposit REP' })
		if (!(depositLauncher instanceof HTMLButtonElement)) throw new Error('Expected a deposit launcher button')
		expect(depositLauncher.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Deposit REP').reason).toBe('Switch to Sepolia.')
	})

	test('prioritizes wrong-network recovery before selected vault details load', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({ chainId: '0x2105' }),
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						securityPoolAddress: '0x00000000000000000000000000000000000000a1',
					}),
					securityVaultForm: {
						depositAmount: '',
						repWithdrawAmount: '',
						targetHealthFactor: '',
						securityPoolAddress: '0x00000000000000000000000000000000000000a2',
						selectedVaultOwner: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const depositLauncher = documentQueries.getByRole('button', { name: 'Deposit REP' })
		if (!(depositLauncher instanceof HTMLButtonElement)) throw new Error('Expected a deposit launcher button')
		expect(depositLauncher.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Deposit REP').reason).toBe('Switch to Sepolia.')
	})

	for (const action of ['queueWithdrawRep', 'redeemFees', 'redeemRepFromVault'] as const) {
		test(`closes the vault dialog for a matching ${action} success`, async () => {
			const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
			const result = signal<SecurityVaultSectionProps['securityVaultResult']>(undefined)
			function Harness() {
				return (
					<GlobalTransactionPresentationProvider transaction={presentation.value}>
						<SecurityVaultSection
							{...createSecurityVaultSectionProps({
								modalFirst: true,
								securityVaultResult: result.value,
								securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n }),
								...(action === 'redeemRepFromVault' ? { poolState: evaluateSecurityPoolState({ lifecycleState: 'ended', universeHasForked: false }) } : {}),
							})}
						/>
					</GlobalTransactionPresentationProvider>
				)
			}
			const rendered = await renderIntoDocument(<Harness />)
			try {
				const page = within(document.body)
				await act(() => fireEvent.click(page.getByRole('button', { name: { redeemFees: 'Claim fees', redeemRepFromVault: 'Redeem REP', queueWithdrawRep: 'Withdraw REP' }[action] })))
				expect(page.getByRole('dialog')).not.toBeNull()
				await act(() => {
					presentation.value = { tone: 'pending', title: 'Transaction pending', operationKey: 'vault-action', hash: '0x01' }
				})
				await act(() => {
					result.value = { action, hash: '0x01' }
					presentation.value = { tone: 'success', title: 'Transaction confirmed', operationKey: 'vault-action', hash: '0x01' }
				})
				expect(page.queryByRole('dialog')).toBeNull()
			} finally {
				await rendered.cleanup()
			}
		})
	}
})

test('deposit submits from the approval form without replacing it with another review', async () => {
	const dom = installDomEnvironment()
	const props = createSecurityVaultSectionProps({ modalFirst: true })
	let review: Promise<bigint | undefined> | undefined
	const rendered = await renderIntoDocument(
		<SecurityVaultSection
			{...props}
			securityVaultForm={{ ...props.securityVaultForm, depositAmount: '1' }}
			onDepositRepToVault={() => {
				const controller = createTransactionStepController()
				controller.setPlan([{ title: 'Deposit REP', description: undefined, contractAddress: zeroAddress, contractLabel: undefined, spender: undefined, amount: '1 REP', ethValueAttoEth: 0n }])
				review = controller.review()
			}}
		/>,
	)
	try {
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Deposit REP' })))
		const dialog = within(document.body).getByRole('dialog', { name: 'Deposit REP' })
		await act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Deposit REP' })))
		expect(dialog.querySelector('.operation-modal-steps')?.textContent).toBeUndefined()
		expect(transactionSteps.value?.steps[0]?.phase).toBe('wallet')
		expect(await review).toBeUndefined()
		expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
	} finally {
		review?.catch(() => undefined)
		transactionSteps.value?.cancel()
		await rendered.cleanup()
		dom.cleanup()
	}
})

for (const action of ['depositRepToVault', 'queueWithdrawRep', 'redeemRepFromVault', 'redeemFees'] as const) {
	test(`${action} keeps its form and review scope open when Cancel is pressed while pending`, async () => {
		const dom = installDomEnvironment()
		const active = signal<SecurityVaultSectionProps['securityVaultActiveAction']>(undefined)
		const label = { depositRepToVault: 'Deposit REP', queueWithdrawRep: 'Withdraw REP', redeemRepFromVault: 'Redeem REP', redeemFees: 'Claim fees' }[action]
		let controller: ReturnType<typeof createTransactionStepController> | undefined
		let review: Promise<bigint | undefined> | undefined
		const submit = () => {
			active.value = action
			controller = createTransactionStepController()
			controller.setPlan([{ title: label, description: undefined, contractAddress: zeroAddress, contractLabel: undefined, spender: undefined, amount: '1 REP', ethValueAttoEth: 0n }])
			review = controller.review()
		}
		function Harness() {
			const props = createSecurityVaultSectionProps({
				modalFirst: true,
				securityVaultActiveAction: active.value,
				securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n }),
				oracleManagerDetails: createOracleManagerDetails(),
				accountState: createAccountState({ ethBalanceAttoEth: 10n ** 18n }),
				...(action === 'redeemRepFromVault' ? { poolState: createEndedPoolState() } : {}),
			})
			return <SecurityVaultSection {...props} securityVaultForm={{ ...props.securityVaultForm, depositAmount: '1', repWithdrawAmount: '1' }} onDepositRepToVault={submit} onWithdrawRep={submit} onRedeemRepFromVault={submit} onRedeemFees={submit} />
		}
		const rendered = await renderIntoDocument(<Harness />)
		try {
			await act(() => fireEvent.click(within(document.body).getByRole('button', { name: label })))
			const dialog = within(document.body).getByRole('dialog', { name: action === 'redeemFees' ? 'Claim fees' : label })
			await act(() => fireEvent.click(within(dialog).getByRole('button', { name: label })))
			expect(transactionSteps.value?.steps[0]?.phase).toBe('wallet')
			await review
			const scope = transactionSteps.value?.reviewSignal
			expect(scope).toBeDefined()
			const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
			expect(cancel.hasAttribute('disabled')).toBe(true)
			if (!(cancel instanceof HTMLButtonElement)) throw new Error('Expected Cancel button')
			await act(() => cancel.click())
			expect(dialog.isConnected).toBe(true)
			expect(scope?.aborted).toBe(false)
			await act(() => {
				controller?.failed({ kind: 'rejected', message: 'Action canceled in wallet.' })
				active.value = undefined
			})
			expect(cancel.hasAttribute('disabled')).toBe(false)
			await act(() => cancel.click())
			expect(dialog.isConnected).toBe(false)
		} finally {
			review?.catch(() => undefined)
			transactionSteps.value?.cancel()
			await rendered.cleanup()
			dom.cleanup()
		}
	})
}
