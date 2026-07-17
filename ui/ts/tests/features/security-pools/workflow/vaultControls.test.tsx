import { describe, expect, test } from 'bun:test'
import { createVaultControlsFixture, useSecurityPoolWorkflowSectionTestDom } from './fixture'

describe('SecurityPoolWorkflowSection: vault controls', () => {
	const testDom = useSecurityPoolWorkflowSectionTestDom()
	const { setCleanup } = testDom
	const fixture = createVaultControlsFixture()
	const { fireEvent, within, act, zeroAddress, SecurityPoolWorkflowSection, renderIntoDocument, expectTransactionButtonDisabled, expectTransactionButtonEnabled, createAccountState, createSecurityVaultProps, createSecurityVaultDetails, createOracleManagerDetails, createSelectedPool, createSecurityPoolWorkflowProps } =
		fixture

	test('shows an explicit vault-refresh blocker while the selected vault auto-loads', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultForm: {
							depositAmount: '10',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
							securityPoolAddress: zeroAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const depositLauncherButton = documentQueries.getByRole('button', { name: 'Deposit REP' })
		if (!(depositLauncherButton instanceof HTMLElement)) throw new Error('Expected deposit launcher button')

		expect(depositLauncherButton.hasAttribute('disabled')).toBe(true)
		expect(depositLauncherButton.getAttribute('title')).toBeNull()
		const refreshReason = documentQueries.getByText('Refresh the vault to use these actions.')
		expect(documentQueries.getAllByText('Refresh the vault to use these actions.')).toHaveLength(1)
		expect(depositLauncherButton.getAttribute('aria-describedby')).toBe(refreshReason.getAttribute('id'))
		expect(loadSecurityVaultCalls).toContain(undefined)

		await act(() => {
			fireEvent.click(depositLauncherButton)
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Deposit REP' })).toBeNull()
	})

	test('does not auto-load a vault when no vault is selected and the wallet is disconnected', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ address: undefined }),
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultForm: {
							depositAmount: '10',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
							securityPoolAddress: zeroAddress,
							selectedVaultAddress: '',
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(loadSecurityVaultCalls.every(vaultAddress => vaultAddress === undefined)).toBe(true)
		expect(within(document.body).queryByText('Enter a vault address or connect a wallet to inspect vault details.')).toBeNull()
	})

	test('keeps REP approval guidance inside the approval control in the deposit modal', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress }),
						securityVaultForm: {
							depositAmount: '10',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultRepBalance: 25n * 10n ** 18n,
						securityVaultRepApproval: {
							error: undefined,
							loading: false,
							value: 0n,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Deposit REP' })[0] as HTMLElement)
		})

		const depositDialog = documentQueries.getByRole('dialog', { name: 'Deposit REP' })
		const modalQueries = within(depositDialog)
		expect(modalQueries.queryByText('Review the selected vault, complete REP approval if needed, then deposit REP.')).toBeNull()
		expect(modalQueries.queryByText('REP approval is sufficient for the deposit amount')).toBeNull()
		expect(modalQueries.queryByText('Approve REP inside this modal before depositing.')).toBeNull()
		expect(modalQueries.getByText('Wallet REP')).not.toBeNull()
		expect(modalQueries.getByText('Required REP')).not.toBeNull()
		expect(modalQueries.getByText('REP Approval Amount')).not.toBeNull()
	})

	test('caps REP withdrawals to the oracle-backed amount in the seeded security-pool shape', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 10_000n * 10n ** 18n,
							totalSecurityBondAllowance: 2_500n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 10_000n * 10n ** 18n,
							securityBondAllowance: 2_500n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '10000',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		expectTransactionButtonDisabled(withdrawDialog as HTMLElement, 'Withdraw REP', 'Reduce the withdrawal to 2 500 REP or less.')
	})

	test('fills the set bond allowance input from the backed Max amount', async () => {
		const selectedPoolAddress = zeroAddress
		const formChanges: Array<{ securityBondAllowanceAmount?: string }> = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 9n * 10n ** 18n,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						onSecurityVaultFormChange: update => {
							formChanges.push(update)
						},
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 12n * 10n ** 18n,
							securityBondAllowance: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set Bond Allowance' })[0] as HTMLElement)
		})

		const allowanceDialog = documentQueries.getByRole('dialog', { name: 'Set Bond Allowance' })
		await act(() => {
			fireEvent.click(within(allowanceDialog).getByRole('button', { name: 'Security Bond Allowance Amount' }))
		})

		expect(formChanges.at(-1)).toEqual({ securityBondAllowanceAmount: '1.999999999999999999' })
	})

	test('allows clearing the bond allowance back to zero in the workflow modal', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalance: 2n * 10n ** 18n }),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 9n * 10n ** 18n,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ ethBalance: 2n * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 12n * 10n ** 18n,
							securityBondAllowance: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '0',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set Bond Allowance' })[0] as HTMLElement)
		})

		const allowanceDialog = documentQueries.getByRole('dialog', { name: 'Set Bond Allowance' })
		expect(within(allowanceDialog).queryByText(/^Blocked:/)).toBeNull()
		expectTransactionButtonEnabled(allowanceDialog as HTMLElement, 'Set Security Bond Allowance')
	})

	test('blocks the workflow bond-allowance modal when the wallet lacks the buffered oracle bounty ETH', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: false,
						lastPrice: 3n * 10n ** 18n,
						requestPriceEthCost: 10n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 9n * 10n ** 18n,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 12n * 10n ** 18n,
							securityBondAllowance: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '1.5',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set Bond Allowance' })[0] as HTMLElement)
		})

		const allowanceDialog = documentQueries.getByRole('dialog', { name: 'Set Bond Allowance' })
		expectTransactionButtonDisabled(allowanceDialog as HTMLElement, 'Set Security Bond Allowance', 'Need 7 more ETH in this wallet to queue this bond allowance update.')
	})

	test('blocks withdraw REP in the workflow modal when the wallet lacks the buffered oracle bounty ETH', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: false,
						lastPrice: 3n * 10n ** 18n,
						requestPriceEthCost: 10n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 9n * 10n ** 18n,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 12n * 10n ** 18n,
							securityBondAllowance: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		expectTransactionButtonDisabled(withdrawDialog as HTMLElement, 'Withdraw REP', 'Need 7 more ETH in this wallet to queue this REP withdrawal.')
	})
})
