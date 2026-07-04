/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { SecurityVaultSection } from '../components/SecurityVaultSection.js'
import { evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import type { AccountState } from '../types/app.js'
import type { SecurityVaultDetails } from '../types/contracts.js'
import type { SecurityVaultSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'

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

function createOracleManagerDetails(): NonNullable<SecurityVaultSectionProps['oracleManagerDetails']> {
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
		expect(documentQueries.getByText('Refresh the vault to inspect claimable fees.')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Claim Fees', 'No claimable fees are available for this vault.')
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
})
