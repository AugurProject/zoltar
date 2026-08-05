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
							coverageCommitmentEthAmount: '1',
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
							coverageCommitmentEthAmount: '1',
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
							coverageCommitmentEthAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						walletRepBalanceAttoRep: 25n * 10n ** 18n,
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

	test('caps REP withdrawals to the multiplier-adjusted oracle-backed amount', async () => {
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
							totalPoolHeldRepAttoRep: 20_000n * 10n ** 18n,
							totalCoverageCommitmentAttoEth: 2_500n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						selectedPoolStatoblastSecurityMultiplierBps: 20_000n,
						securityVaultDetails: createSecurityVaultDetails({
							vaultRepBackingAttoRep: 20_000n * 10n ** 18n,
							coverageCommitmentAttoEth: 2_500n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '10000',
							coverageCommitmentEthAmount: '',
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
		expectTransactionButtonDisabled(withdrawDialog as HTMLElement, 'Withdraw REP', 'Reduce the withdrawal to 5 000 REP or less.')
	})

	test('fills the set coverage commitment input from the backed Max amount', async () => {
		const selectedPoolAddress = zeroAddress
		const formChanges: Array<{ coverageCommitmentEthAmount?: string }> = []
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
							totalPoolHeldRepAttoRep: 9n * 10n ** 18n,
							totalCoverageCommitmentAttoEth: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						onSecurityVaultFormChange: update => {
							formChanges.push(update)
						},
						selectedPoolStatoblastSecurityMultiplierBps: 20_000n,
						securityVaultDetails: createSecurityVaultDetails({
							vaultRepBackingAttoRep: 12n * 10n ** 18n,
							coverageCommitmentAttoEth: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalCoverageCommitmentAttoEth: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							coverageCommitmentEthAmount: '',
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
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set coverage commitment' })[0] as HTMLElement)
		})

		const coverageCommitmentDialog = documentQueries.getByRole('dialog', { name: 'Set coverage commitment' })
		await act(() => {
			fireEvent.click(within(coverageCommitmentDialog).getByRole('button', { name: 'Coverage commitment amount Max' }))
		})

		expect(formChanges.at(-1)).toEqual({ coverageCommitmentEthAmount: '0.5' })
	})

	test('allows clearing the coverage commitment back to zero in the workflow modal', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalanceAttoEth: 2n * 10n ** 18n }),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalPoolHeldRepAttoRep: 9n * 10n ** 18n,
							totalCoverageCommitmentAttoEth: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ ethBalanceAttoEth: 2n * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							vaultRepBackingAttoRep: 12n * 10n ** 18n,
							coverageCommitmentAttoEth: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalCoverageCommitmentAttoEth: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							coverageCommitmentEthAmount: '0',
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
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set coverage commitment' })[0] as HTMLElement)
		})

		const coverageCommitmentDialog = documentQueries.getByRole('dialog', { name: 'Set coverage commitment' })
		expect(within(coverageCommitmentDialog).queryByText(/^Blocked:/)).toBeNull()
		expectTransactionButtonEnabled(coverageCommitmentDialog as HTMLElement, 'Set coverage commitment')
	})

	test('blocks the coverage-commitment modal when the wallet lacks the buffered oracle bounty ETH', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalanceAttoEth: 5n * 10n ** 18n }),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: false,
						lastPrice: 3n * 10n ** 18n,
						requestPriceCostAttoEth: 10n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalPoolHeldRepAttoRep: 9n * 10n ** 18n,
							totalCoverageCommitmentAttoEth: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ ethBalanceAttoEth: 5n * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							vaultRepBackingAttoRep: 12n * 10n ** 18n,
							coverageCommitmentAttoEth: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalCoverageCommitmentAttoEth: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							coverageCommitmentEthAmount: '1.5',
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
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set coverage commitment' })[0] as HTMLElement)
		})

		const coverageCommitmentDialog = documentQueries.getByRole('dialog', { name: 'Set coverage commitment' })
		expectTransactionButtonDisabled(coverageCommitmentDialog as HTMLElement, 'Set coverage commitment', 'Need 7 more ETH in this wallet to queue this coverage commitment update.')
	})

	test('blocks withdraw REP in the workflow modal when the wallet lacks the buffered oracle bounty ETH', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalanceAttoEth: 5n * 10n ** 18n }),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: false,
						lastPrice: 3n * 10n ** 18n,
						requestPriceCostAttoEth: 10n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalPoolHeldRepAttoRep: 9n * 10n ** 18n,
							totalCoverageCommitmentAttoEth: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ ethBalanceAttoEth: 5n * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							vaultRepBackingAttoRep: 12n * 10n ** 18n,
							coverageCommitmentAttoEth: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalCoverageCommitmentAttoEth: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							coverageCommitmentEthAmount: '',
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
