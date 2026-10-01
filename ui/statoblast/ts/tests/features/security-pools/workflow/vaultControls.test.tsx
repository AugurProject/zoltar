import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps } from '@zoltar/ui-zoltar-shared/features/types.js'
import { createAccountState, createMarketDetails, createOracleManagerDetails, createSecurityPoolWorkflowProps, createSecurityVaultDetails, createSecurityVaultForm, createSecurityVaultProps, createSelectedPool } from './builders.js'
import { useSecurityPoolWorkflowSectionTestDom } from './testDom.js'

installTestRouting()
describe('SecurityPoolWorkflowSection: vault controls', () => {
	const { renderLoadedPool, renderWorkflow } = useSecurityPoolWorkflowSectionTestDom()
	const admissionClosedReason = 'New vault REP backing is unavailable after this question ends. Fork-continuation child pools remain fundable.'
	const endedAtTwo = () => createMarketDetails({ endTime: 2n })

	type VaultsViewOptions = Partial<Omit<SecurityPoolWorkflowRouteContentProps, 'securityVault'>> & { pool?: Partial<ListedSecurityPool>; vault?: Partial<SecurityVaultRouteContentProps> }
	const createVaultsViewProps = ({ pool = {}, vault = {}, ...overrides }: VaultsViewOptions) =>
		createSecurityPoolWorkflowProps({
			securityPoolAddress: zeroAddress,
			securityPools: [createSelectedPool(pool)],
			securityVault: createSecurityVaultProps({ securityVaultDetails: createSecurityVaultDetails(), ...vault }),
			selectedPoolView: 'vaults',
			...overrides,
		})
	const renderVaultsView = async ({ chainTimestamp, ...options }: VaultsViewOptions & { chainTimestamp?: bigint }) => await renderWorkflow(createVaultsViewProps(options), chainTimestamp === undefined ? {} : { chainTimestamp })

	const openDialog = async (name: string) => {
		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name })[0] as HTMLElement)
		})
		return documentQueries.getByRole('dialog', { name })
	}

	test.each([
		['blocks origin vault deposits after the question ends before ordinary escalation starts', 3n],
		['blocks origin vault deposits at the exact question end timestamp', 2n],
	])('%s', async (_name, chainTimestamp) => {
		await renderVaultsView({ chainTimestamp, pool: { marketDetails: endedAtTwo() } })
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: /^(My vault|Vault details)$/ })))

		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		const depositButton = within(document.body).getByRole('button', { name: 'Deposit REP' })
		const disabledReason = document.getElementById(depositButton.getAttribute('aria-describedby') ?? '')
		expect(disabledReason?.textContent).toBe(admissionClosedReason)
		expect(within(document.body).getByText(admissionClosedReason)).toBeTruthy()
	})

	test('disables an open deposit approval flow when origin vault admission closes', async () => {
		const openAdmissionProps = {
			pool: { marketDetails: endedAtTwo() },
			vault: {
				securityVaultForm: createSecurityVaultForm({ depositAmount: '5', repWithdrawAmount: '1', targetHealthFactor: '2' }),
				walletRepBalanceAttoRep: 10n * 10n ** 18n,
			},
		}
		const { rerender } = await renderVaultsView({ ...openAdmissionProps, chainTimestamp: 1n })

		const documentQueries = within(document.body)
		await openDialog('Deposit REP')
		expectTransactionButtonEnabled(document.body, 'Approve 5 REP')

		await rerender(createVaultsViewProps(openAdmissionProps), { chainTimestamp: 2n })

		const depositDialog = documentQueries.getByRole('dialog', { name: 'Deposit REP' })
		const depositQueries = within(depositDialog)
		const depositAmountInput = depositQueries.getByLabelText('REP backing') as HTMLInputElement
		const approvalAmountInput = depositQueries.getByText('REP approval amount').parentElement?.querySelector('input')
		expect(depositAmountInput?.disabled).toBe(true)
		expect(approvalAmountInput?.disabled).toBe(true)
		expect(depositQueries.getByText('REP approval amount').parentElement?.querySelector('button')).toBeNull()
		expectTransactionButtonDisabled(depositDialog, 'Approve 5 REP')

		await act(() => {
			fireEvent.click(depositQueries.getByRole('button', { name: 'Cancel' }))
		})
		expectTransactionButtonEnabled(document.body, 'Withdraw REP')
		const withdrawDialog = await openDialog('Withdraw REP')
		expect((within(withdrawDialog).getByLabelText('REP withdraw amount') as HTMLInputElement).disabled).toBe(false)
	})

	test('vault dialogs keep a single primary transaction action and end with Cancel', async () => {
		await renderVaultsView({
			chainTimestamp: 1n,
			pool: { marketDetails: endedAtTwo() },
			vault: {
				securityVaultForm: createSecurityVaultForm({ depositAmount: '5', repWithdrawAmount: '1', targetHealthFactor: '2' }),
				walletRepBalanceAttoRep: 10n * 10n ** 18n,
			},
		})
		const expectDialogActions = (dialog: HTMLElement, expectedLabels: string[]) => {
			const actionRow = within(dialog).getByRole('button', { name: 'Cancel' }).closest('.actions')
			if (actionRow === null) throw new Error('Dialog action row is missing')
			const buttons = [...actionRow.querySelectorAll('button')]
			expect(buttons.map(button => button.textContent?.trim())).toEqual(expectedLabels)
			expect(buttons.map(button => button.classList.contains('primary'))).toEqual(expectedLabels.map(label => label === expectedLabels[expectedLabels.length - 2]))
		}

		const depositDialog = await openDialog('Deposit REP')
		expectDialogActions(depositDialog, ['Approve 5\u00a0REP', 'Deposit REP', 'Cancel'])
		await act(() => {
			fireEvent.click(within(depositDialog).getByRole('button', { name: 'Cancel' }))
		})

		expectDialogActions(await openDialog('Withdraw REP'), ['Withdraw REP', 'Cancel'])
	})

	test('keeps continuation-child vault deposits available after the question ends', async () => {
		await renderVaultsView({ chainTimestamp: 3n, pool: { hasForkContinuationEscalationGame: true, marketDetails: endedAtTwo() } })

		expect(within(document.body).queryByText(admissionClosedReason)).toBeNull()
	})

	test('auto-loads the selected vault without presenting manual refresh guidance', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		await renderLoadedPool({
			securityVault: createSecurityVaultProps({
				onLoadSecurityVault: vaultAddress => {
					loadSecurityVaultCalls.push(vaultAddress)
				},
				securityVaultForm: createSecurityVaultForm({ depositAmount: '10', repWithdrawAmount: '1', targetHealthFactor: '2' }),
			}),
		})

		const documentQueries = within(document.body)
		const depositLauncherButton = documentQueries.getByRole('button', { name: 'Deposit REP' })
		if (!(depositLauncherButton instanceof HTMLElement)) throw new Error('Expected deposit launcher button')

		expect(depositLauncherButton.hasAttribute('disabled')).toBe(true)
		expect(depositLauncherButton.getAttribute('title')).toBeNull()
		expect(documentQueries.queryByText('Refresh the vault to use these actions.')).toBeNull()
		expect(depositLauncherButton.getAttribute('aria-describedby')).toBeNull()
		expect(loadSecurityVaultCalls).toContain(undefined)

		await act(() => {
			fireEvent.click(depositLauncherButton)
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Deposit REP' })).toBeNull()
	})

	test('announces automatic vault loading once without rendering manual refresh blockers', async () => {
		await renderLoadedPool({ securityVault: createSecurityVaultProps({ loadingSecurityVault: true, securityVaultDetails: undefined }) })

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('status').textContent).toContain('Loading vault details…')
		expect(documentQueries.queryByText('Refresh the vault to use these actions.')).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expectTransactionButtonDisabled(document.body, 'Withdraw REP')
		expectTransactionButtonDisabled(document.body, 'Claim fees')
	})

	test('offers an explicit retry after automatic vault loading fails', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		await renderLoadedPool({
			securityVault: createSecurityVaultProps({
				onLoadSecurityVault: vaultAddress => {
					loadSecurityVaultCalls.push(vaultAddress)
				},
				securityVaultDetails: undefined,
				securityVaultError: 'Failed to load security vault',
			}),
		})

		const documentQueries = within(document.body)
		const retryReason = documentQueries.getByText('Retry loading the vault to use these actions.')
		expect(documentQueries.getAllByText('Retry loading the vault to use these actions.')).toHaveLength(1)
		expect(documentQueries.getByText('Failed to load security vault')).toBeTruthy()
		expect(documentQueries.queryByText('Refresh the vault to use these actions.')).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Deposit REP' }).getAttribute('aria-describedby')).toBe(retryReason.id)
		expect(documentQueries.getByRole('button', { name: 'Set commitment limit' }).getAttribute('aria-describedby')).toBe(retryReason.id)
		expectTransactionButtonDisabled(document.body, 'Set commitment limit')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
		})

		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('does not auto-load a vault when no vault is selected and the wallet is disconnected', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		await renderLoadedPool({
			accountState: createAccountState({ address: undefined }),
			securityVault: createSecurityVaultProps({
				onLoadSecurityVault: vaultAddress => {
					loadSecurityVaultCalls.push(vaultAddress)
				},
				securityVaultForm: createSecurityVaultForm({ depositAmount: '10', repWithdrawAmount: '1', targetHealthFactor: '2', selectedVaultOwner: '' }),
			}),
		})

		expect(loadSecurityVaultCalls.every(vaultAddress => vaultAddress === undefined)).toBe(true)
		expect(within(document.body).queryByText('Enter a vault owner address or connect a wallet to inspect vault details.')).toBeNull()
	})

	test('keeps REP approval guidance inside the approval control in the deposit modal', async () => {
		await renderVaultsView({ vault: { securityVaultForm: createSecurityVaultForm({ depositAmount: '10' }), walletRepBalanceAttoRep: 25n * 10n ** 18n } })

		const modalQueries = within(await openDialog('Deposit REP'))
		expect(modalQueries.queryByText('Review the selected vault, complete REP approval if needed, then deposit REP.')).toBeNull()
		expect(modalQueries.queryByText('REP approval is sufficient for the deposit amount')).toBeNull()
		expect(modalQueries.queryByText('Approve REP inside this modal before depositing.')).toBeNull()
		expect(modalQueries.getByText(/^Balance: /, { selector: 'p.field-hint' })).not.toBeNull()
		expect(modalQueries.getByText('Required REP')).not.toBeNull()
		expect(modalQueries.getByText('REP approval amount')).not.toBeNull()
	})

	test('states an over-balance deposit once, in the approval control', async () => {
		await renderVaultsView({ vault: { securityVaultForm: createSecurityVaultForm({ depositAmount: '30' }), walletRepBalanceAttoRep: 25n * 10n ** 18n } })

		const depositDialog = await openDialog('Deposit REP')
		const modalQueries = within(depositDialog)
		const depositInput = modalQueries.getByLabelText('REP backing')
		await act(() => {
			depositInput.dispatchEvent(new Event('blur'))
		})
		expect(depositDialog.querySelector('.field-error')).toBeNull()
		expect(depositInput.getAttribute('aria-invalid')).toBeNull()
		expect(modalQueries.getByText(/^Balance: 25/, { selector: 'p.field-hint' })).not.toBeNull()
		expect(depositDialog.textContent?.match(/exceeds your wallet balance/gi)).toHaveLength(1)
	})

	test('caps REP withdrawals to the multiplier-adjusted oracle-backed amount', async () => {
		await renderVaultsView({
			chainTimestamp: 1n,
			poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: 3n * 10n ** 18n }),
			pool: { managerAddress: zeroAddress, totalPoolHeldAttoRep: 20_000n * 10n ** 18n, totalUnderwritingLimitAttoEth: 2_500n * 10n ** 18n },
			vault: {
				repPerEthPrice: 3n * 10n ** 18n,
				selectedPoolStatoblastSecurityMultiplierBps: 20_000n,
				securityVaultDetails: createSecurityVaultDetails({ vaultAttoRepBacking: 20_000n * 10n ** 18n, underwritingLimitAttoEth: 2_500n * 10n ** 18n }),
				securityVaultForm: createSecurityVaultForm({ repWithdrawAmount: '10000' }),
			},
		})

		const withdrawDialog = await openDialog('Withdraw REP')
		expectTransactionButtonDisabled(withdrawDialog, 'Withdraw REP', 'Reduce the withdrawal to 5 000\u00a0REP or less.')
		const withdrawInput = within(withdrawDialog).getByLabelText('REP withdraw amount')
		await act(() => {
			withdrawInput.dispatchEvent(new Event('blur'))
		})
		// The field flags the over-maximum amount inline; the disabled action keeps its own reason once.
		expect(withdrawInput.getAttribute('aria-invalid')).toBe('true')
		expect(withdrawDialog.textContent?.match(/Reduce the withdrawal/g)).toHaveLength(1)
	})

	test('blocks withdraw REP in the workflow modal when the wallet lacks the buffered oracle bounty ETH', async () => {
		const underfundedAccount = createAccountState({ ethBalanceAttoEth: 5n * 10n ** 18n })
		await renderVaultsView({
			accountState: underfundedAccount,
			poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, lastPrice: 3n * 10n ** 18n, requestPriceCostAttoEth: 10n * 10n ** 18n }),
			pool: { managerAddress: zeroAddress, totalPoolHeldAttoRep: 9n * 10n ** 18n, totalUnderwritingLimitAttoEth: 0n },
			vault: {
				accountState: underfundedAccount,
				// Without a usable price only an uncommitted pool has a known withdrawal maximum.
				securityVaultDetails: createSecurityVaultDetails({ vaultAttoRepBacking: 12n * 10n ** 18n, underwritingLimitAttoEth: 0n, totalUnderwritingLimitAttoEth: 0n }),
				securityVaultForm: createSecurityVaultForm({ repWithdrawAmount: '1' }),
			},
		})

		expectTransactionButtonDisabled(await openDialog('Withdraw REP'), 'Withdraw REP', 'Need 7\u00a0more\u00a0ETH in this wallet to queue this REP withdrawal.')
	})
})
