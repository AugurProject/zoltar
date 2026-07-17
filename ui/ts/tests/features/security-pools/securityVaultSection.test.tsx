/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '../../testUtils/queries'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { SecurityVaultSection } from '../../../features/security-pools/components/SecurityVaultSection.js'
import { evaluateSecurityPoolState } from '../../../features/security-pools/lib/securityPoolState.js'
import type { AccountState } from '../../../types/app.js'
import type { SecurityVaultDetails } from '../../../types/contracts.js'
import type { SecurityVaultSectionProps } from '../../../features/types.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled, getTransactionButtonState } from '../../testUtils/transactionActionButton.js'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createSecurityVaultDetails(overrides: Partial<SecurityVaultDetails> = {}): SecurityVaultDetails {
	return {
		currentRetentionRate: 10n,
		escalationEscrowedRep: 3n * 10n ** 18n,
		managerAddress: zeroAddress,
		poolOwnershipDenominator: 1n,
		repDepositShare: 12n * 10n ** 18n,
		repToken: zeroAddress,
		securityBondAllowance: 2n * 10n ** 18n,
		securityPoolAddress: zeroAddress,
		totalSecurityBondAllowance: 3n * 10n ** 18n,
		unpaidEthFees: 1n * 10n ** 18n,
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
		onDepositRep: () => undefined,
		onLoadSecurityVault: () => undefined,
		onRedeemFees: () => undefined,
		onRedeemRep: () => undefined,
		onSetSecurityBondAllowance: () => undefined,
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
			securityBondAllowanceAmount: '',
			securityPoolAddress: zeroAddress,
			selectedVaultAddress: zeroAddress,
		},
		securityVaultMissing: false,
		securityVaultRepApproval: {
			error: undefined,
			loading: false,
			value: 8n * 10n ** 18n,
		},
		securityVaultRepBalance: undefined,
		securityVaultResult: undefined,
		selectedPoolSecurityMultiplier: 2n,
		showHeader: false,
		...overrides,
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
		queuedOperationEthCost: 0n,
		requestPriceEthCost: 0n,
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

describe('SecurityVaultSection', () => {
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

	test('renders the shared selected-vault metric summary', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityVaultSection {...createSecurityVaultSectionProps()} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const selectedVaultHeading = documentQueries.getByRole('heading', { name: 'Selected Vault' })
		const selectedVaultCard = selectedVaultHeading.closest('.entity-card')
		if (!(selectedVaultCard instanceof HTMLElement)) throw new Error('Expected a selected vault summary card')
		const selectedVaultQueries = within(selectedVaultCard)
		expect(selectedVaultQueries.getByText('REP Collateral')).not.toBeNull()
		expect(selectedVaultQueries.queryByText('Approved REP')).toBeNull()
		expect(selectedVaultQueries.getByText('Escrowed REP')).not.toBeNull()
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
						securityBondAllowanceAmount: '',
						securityPoolAddress: '0x00000000000000000000000000000000000000a2',
						selectedVaultAddress: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Selected Vault')).toBeNull()
		expect(documentQueries.getAllByText('Selected vault details are unavailable.').length).toBeGreaterThan(0)
		expect(documentQueries.queryByText('Refresh the vault to inspect claimable fees.')).toBeNull()
		expect(documentQueries.queryByText('Refresh the vault before setting a security bond allowance.')).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Claim Fees')
	})

	test('directs a missing vault lookup to another vault address', async () => {
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
		expect(documentQueries.getByText('Try another vault address.')).not.toBeNull()
		expect(documentQueries.queryByText('Try another pool address.')).toBeNull()
	})

	test('keeps fee-claim actions available when a zeroed vault still has claimable fees', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						escalationEscrowedRep: 0n,
						repDepositShare: 0n,
						securityBondAllowance: 0n,
						unpaidEthFees: 1n * 10n ** 18n,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('This vault does not exist. Deposit REP to create it.')).toBeNull()
		expectTransactionButtonEnabled(document.body, 'Claim Fees')
	})

	test('blocks the modal-first claim fees launcher when an existing vault has no claimable fees', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						unpaidEthFees: 0n,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const claimFeesButton = documentQueries.getByRole('button', { name: 'Claim Fees' })

		expectTransactionButtonDisabled(document.body, 'Claim Fees')
		fireEvent.click(claimFeesButton)
		expect(documentQueries.queryByRole('dialog', { name: 'Claim Fees' })).toBeNull()
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
						securityBondAllowanceAmount: '1',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: zeroAddress,
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

	test('uses neutral missing-state copy when a bond allowance update succeeds before manager state is visible', async () => {
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
						securityBondAllowanceAmount: '1',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: zeroAddress,
					},
					securityVaultResult: {
						action: 'queueSetSecurityBondAllowance',
						hash: '0x02',
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Set Bond Allowance' }))
		const dialog = documentQueries.getByRole('dialog', { name: 'Set Bond Allowance' })
		expect(within(dialog).getByText('The transaction succeeded, but the latest manager state is not available.')).not.toBeNull()
		expect(documentQueries.queryByText('Refresh staged operations to confirm the latest manager state.')).toBeNull()
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

		expectTransactionButtonDisabled(document.body, 'Claim Fees')
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
						securityBondAllowanceAmount: '1',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionButtonState(document.body, 'Deposit REP')).toEqual({ disabled: true, reason: 'Connect a wallet before depositing REP.' })
		expect(getTransactionButtonState(document.body, 'Claim Fees')).toEqual({ disabled: true, reason: 'Connect a wallet before claiming fees.' })
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
						securityBondAllowanceAmount: '1',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: otherVaultAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionButtonState(document.body, 'Deposit REP')).toEqual({ disabled: true, reason: 'Select your own vault to deposit REP.' })
		expect(getTransactionButtonState(document.body, 'Claim Fees')).toEqual({ disabled: true, reason: 'Select your own vault to claim fees.' })
	})

	test('keeps the deposit modal in create-vault mode for an empty selected vault', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					modalFirst: true,
					securityVaultDetails: createSecurityVaultDetails({
						escalationEscrowedRep: 0n,
						repDepositShare: 0n,
						securityBondAllowance: 0n,
						unpaidEthFees: 0n,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Deposit REP' }))

		const depositDialog = documentQueries.getByRole('dialog', { name: 'Deposit REP' })
		const depositDialogQueries = within(depositDialog)
		const transactionContext = depositDialog.querySelector('.transaction-object-context')
		if (!(transactionContext instanceof HTMLElement)) throw new Error('Expected deposit transaction context')
		expect(depositDialogQueries.queryByRole('heading', { name: 'Vault Summary' })).toBeNull()
		expect(depositDialogQueries.getByText('This vault does not exist. Deposit REP to create it.')).not.toBeNull()
		expect(depositDialogQueries.getByText('REP Collateral Amount')).not.toBeNull()
		expect(transactionContext.textContent?.includes('Universe 1')).toBe(true)
		expect(transactionContext.textContent?.includes('Ethereum Mainnet')).toBe(true)
		expect(
			within(transactionContext)
				.getAllByRole('button', { name: `Copy address ${zeroAddress}` })
				.every(button => button.textContent === zeroAddress),
		).toBe(true)
	})

	test('fills the security bond allowance input from the backed Max amount', async () => {
		const formChanges: Partial<SecurityVaultSectionProps['securityVaultForm']>[] = []
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					onSecurityVaultFormChange: update => {
						formChanges.push(update)
					},
					oracleManagerDetails: createOracleManagerDetails(),
					securityVaultDetails: createSecurityVaultDetails({
						repDepositShare: 6n * 10n ** 18n,
						securityBondAllowance: 0n,
					}),
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)

		fireEvent.click(documentQueries.getAllByRole('button', { name: 'Security Bond Allowance Amount' })[0] as HTMLElement)

		expect(formChanges.at(-1)).toEqual({ securityBondAllowanceAmount: '1.999999999999999999' })
	})

	test('allows setting the security bond allowance to zero', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					oracleManagerDetails: createOracleManagerDetails(),
					securityVaultForm: {
						depositAmount: '',
						repWithdrawAmount: '',
						securityBondAllowanceAmount: '0',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Set Security Bond Allowance')
	})

	test('allows a non-zero bond allowance when the oracle price is stale but fresh-report funding is available', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({
						ethBalance: 2n * 10n ** 18n,
					}),
					oracleManagerDetails: {
						...createOracleManagerDetails(),
						isPriceValid: false,
						requestPriceEthCost: 1n,
					},
					securityVaultForm: {
						depositAmount: '',
						repWithdrawAmount: '',
						securityBondAllowanceAmount: '1',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Set Security Bond Allowance')
	})

	test('allows REP withdrawal staging when the oracle price is stale but fresh-report funding is available', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					accountState: createAccountState({
						ethBalance: 2n * 10n ** 18n,
					}),
					oracleManagerDetails: {
						...createOracleManagerDetails(),
						isPriceValid: false,
						requestPriceEthCost: 1n,
					},
					securityVaultForm: {
						depositAmount: '',
						repWithdrawAmount: '1',
						securityBondAllowanceAmount: '',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonEnabled(document.body, 'Withdraw REP')
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

		expect(document.body.textContent?.includes('This queued self-service operation will expire 5m after the oracle settlement window completes.')).toBe(true)
	})

	test('blocks non-zero security bond allowances below the minimum', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					oracleManagerDetails: createOracleManagerDetails(),
					securityVaultForm: {
						depositAmount: '',
						repWithdrawAmount: '',
						securityBondAllowanceAmount: '0.5',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Set Security Bond Allowance', 'Enter at least 1 ETH for a non-zero allowance.')
	})

	test('does not render a local vault transaction status card', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					securityVaultResult: {
						action: 'depositRep',
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
						escalationEscrowedRep: 0n,
					}),
					securityVaultForm: {
						depositAmount: '1',
						repWithdrawAmount: '1',
						securityBondAllowanceAmount: '1',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: zeroAddress,
					},
					securityVaultRepBalance: 10n * 10n ** 18n,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expectTransactionButtonEnabled(document.body, 'Redeem REP')
		expectTransactionButtonDisabled(document.body, 'Set Security Bond Allowance')
		expectTransactionButtonEnabled(document.body, 'Claim Fees')
	})

	test('disables REP approval after the selected pool has ended', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityVaultSection
				{...createSecurityVaultSectionProps({
					poolState: createEndedPoolState(),
					securityVaultForm: {
						depositAmount: '1',
						repWithdrawAmount: '',
						securityBondAllowanceAmount: '',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: zeroAddress,
					},
					securityVaultRepApproval: {
						error: undefined,
						loading: false,
						value: 0n,
					},
					securityVaultRepBalance: 10n * 10n ** 18n,
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
		expect(depositLauncher.title).toBe('Connect a wallet before depositing REP.')
	})

	test('keeps modal-first vault launchers disabled off mainnet with recovery guidance', async () => {
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
		expect(depositLauncher.title).toBe('Switch to Ethereum mainnet.')
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
						securityBondAllowanceAmount: '',
						securityPoolAddress: zeroAddress,
						selectedVaultAddress: '0x00000000000000000000000000000000000000a1',
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const depositLauncher = documentQueries.getByRole('button', { name: 'Deposit REP' })
		if (!(depositLauncher instanceof HTMLButtonElement)) throw new Error('Expected a deposit launcher button')
		expect(depositLauncher.disabled).toBe(true)
		expect(depositLauncher.title).toBe('Switch to Ethereum mainnet.')
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
						securityBondAllowanceAmount: '',
						securityPoolAddress: '0x00000000000000000000000000000000000000a2',
						selectedVaultAddress: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const depositLauncher = documentQueries.getByRole('button', { name: 'Deposit REP' })
		if (!(depositLauncher instanceof HTMLButtonElement)) throw new Error('Expected a deposit launcher button')
		expect(depositLauncher.disabled).toBe(true)
		expect(depositLauncher.title).toBe('Switch to Ethereum mainnet.')
	})
})
