/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { zeroAddress } from 'viem'
import { SecurityVaultSection } from '../components/SecurityVaultSection.js'
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
		lockedRepInEscalationGame: 3n * 10n ** 18n,
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
		pendingReportId: 0n,
		priceValidUntilTimestamp: 10n,
		requestPriceEthCost: 0n,
		token1: undefined,
		token2: undefined,
	}
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
		expect(documentQueries.getByText('Selected Vault')).not.toBeNull()
		expect(documentQueries.getAllByText('Approved REP').length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('Locked REP').length).toBeGreaterThan(0)
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
})
