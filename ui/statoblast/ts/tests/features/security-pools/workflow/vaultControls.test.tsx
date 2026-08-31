import { describe, expect, test } from 'bun:test'
import { createVaultControlsFixture, useSecurityPoolWorkflowSectionTestDom } from './fixture'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { ChainTimestampContext } from '@zoltar/ui-core-shared/lib/chainTimestamp.js'
import { createMarketDetails } from './builders.js'
import { render } from 'preact'

installTestRouting()
describe('SecurityPoolWorkflowSection: vault controls', () => {
	const testDom = useSecurityPoolWorkflowSectionTestDom()
	const { setCleanup } = testDom
	const fixture = createVaultControlsFixture()
	const { fireEvent, within, act, zeroAddress, SecurityPoolWorkflowSection, renderIntoDocument, expectTransactionButtonDisabled, expectTransactionButtonEnabled, createAccountState, createSecurityVaultProps, createSecurityVaultDetails, createOracleManagerDetails, createSelectedPool, createSecurityPoolWorkflowProps } =
		fixture

	test('blocks origin vault deposits after the question ends before ordinary escalation starts', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={3n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 2n }), securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress }),
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		const depositButton = within(document.body).getByRole('button', { name: 'Deposit REP' })
		const disabledReason = document.getElementById(depositButton.getAttribute('aria-describedby') ?? '')
		expect(disabledReason?.textContent).toBe('New vault REP backing is unavailable after this question ends. Fork-continuation child pools remain fundable.')
	})

	test('blocks origin vault deposits at the exact question end timestamp', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={2n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 2n }), securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress }),
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expect(within(document.body).getByText('New vault REP backing is unavailable after this question ends. Fork-continuation child pools remain fundable.')).toBeTruthy()
	})

	test('disables an open deposit approval flow when origin vault admission closes', async () => {
		const selectedPoolAddress = zeroAddress
		const renderWorkflow = (chainTimestamp: bigint) => (
			<ChainTimestampContext.Provider value={chainTimestamp}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 2n }), securityPoolAddress: selectedPoolAddress })],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress }),
							securityVaultForm: {
								depositAmount: '1',
								repWithdrawAmount: '1',
								targetHealthFactor: '1',
								securityPoolAddress: selectedPoolAddress,
								selectedVaultOwner: zeroAddress,
							},
							securityVaultRepApproval: {
								error: undefined,
								loading: false,
								value: 0n,
							},
							walletRepBalanceAttoRep: 10n * 10n ** 18n,
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>
		)
		const renderedComponent = await renderIntoDocument(renderWorkflow(1n))
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Deposit REP' })[0] as HTMLElement)
		})
		expectTransactionButtonEnabled(document.body, 'Approve 1 REP')

		await act(() => {
			render(renderWorkflow(2n), renderedComponent.container)
		})

		const depositDialog = documentQueries.getByRole('dialog', { name: 'Deposit REP' })
		const depositQueries = within(depositDialog)
		const depositAmountInput = depositQueries.getByText('REP backing').parentElement?.querySelector('input')
		const approvalAmountInput = depositQueries.getByText('REP Approval Amount').parentElement?.querySelector('input')
		const approvalMaxButton = depositQueries.getByText('REP Approval Amount').parentElement?.querySelector('button')
		expect(depositAmountInput?.disabled).toBe(true)
		expect(approvalAmountInput?.disabled).toBe(true)
		expect(approvalMaxButton?.disabled).toBe(true)
		expectTransactionButtonDisabled(depositDialog, 'Approve 1 REP')

		await act(() => {
			fireEvent.click(depositQueries.getByRole('button', { name: 'Cancel' }))
		})
		expectTransactionButtonEnabled(document.body, 'Withdraw REP')
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Withdraw REP' }))
		})
		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		expect(within(withdrawDialog).getByText('REP Withdraw Amount').parentElement?.querySelector('input')?.disabled).toBe(false)
	})

	test('keeps continuation-child vault deposits available after the question ends', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={3n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						securityPoolAddress: selectedPoolAddress,
						securityPools: [
							createSelectedPool({
								hasForkContinuationEscalationGame: true,
								marketDetails: createMarketDetails({ endTime: 2n }),
								securityPoolAddress: selectedPoolAddress,
							}),
						],
						securityVault: createSecurityVaultProps({
							securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress }),
						}),
						selectedPoolView: 'vaults',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(within(document.body).queryByText('New vault REP backing is unavailable after this question ends. Fork-continuation child pools remain fundable.')).toBeNull()
	})

	test('auto-loads the selected vault without presenting manual refresh guidance', async () => {
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
							targetHealthFactor: '1',
							securityPoolAddress: zeroAddress,
							selectedVaultOwner: zeroAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const depositLauncherButton = documentQueries.getByRole('button', {
			name: 'Deposit REP',
		})
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
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					securityVault: createSecurityVaultProps({
						loadingSecurityVault: true,
						securityVaultDetails: undefined,
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('status').textContent).toContain('Loading vault details…')
		expect(documentQueries.queryByText('Refresh the vault to use these actions.')).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expectTransactionButtonDisabled(document.body, 'Withdraw REP')
		expectTransactionButtonDisabled(document.body, 'Claim fees')
	})

	test('offers an explicit retry after automatic vault loading fails', async () => {
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
						securityVaultDetails: undefined,
						securityVaultError: 'Failed to load security vault',
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const retryReason = documentQueries.getByText('Retry loading the vault to use these actions.')
		expect(documentQueries.getAllByText('Retry loading the vault to use these actions.')).toHaveLength(1)
		expect(documentQueries.getByText('Failed to load security vault')).toBeTruthy()
		expect(documentQueries.queryByText('Refresh the vault to use these actions.')).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Deposit REP' }).getAttribute('aria-describedby')).toBe(retryReason.id)

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
		})

		expect(loadSecurityVaultCalls).toEqual([undefined])
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
							targetHealthFactor: '1',
							securityPoolAddress: zeroAddress,
							selectedVaultOwner: '',
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(loadSecurityVaultCalls.every(vaultAddress => vaultAddress === undefined)).toBe(true)
		expect(within(document.body).queryByText('Enter a vault owner address or connect a wallet to inspect vault details.')).toBeNull()
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
						securityVaultDetails: createSecurityVaultDetails({
							securityPoolAddress: selectedPoolAddress,
						}),
						securityVaultForm: {
							depositAmount: '10',
							repWithdrawAmount: '',
							targetHealthFactor: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultOwner: zeroAddress,
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
			fireEvent.click(
				documentQueries.getAllByRole('button', {
					name: 'Deposit REP',
				})[0] as HTMLElement,
			)
		})

		const depositDialog = documentQueries.getByRole('dialog', {
			name: 'Deposit REP',
		})
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
							totalPoolHeldAttoRep: 20_000n * 10n ** 18n,
							totalCapacityOwnershipAttoRep: 2_500n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						selectedPoolStatoblastSecurityMultiplierBps: 20_000n,
						securityVaultDetails: createSecurityVaultDetails({
							vaultAttoRepBacking: 20_000n * 10n ** 18n,
							capacityOwnershipAttoRep: 2_500n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '10000',
							targetHealthFactor: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultOwner: zeroAddress,
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
			fireEvent.click(
				documentQueries.getAllByRole('button', {
					name: 'Withdraw REP',
				})[0] as HTMLElement,
			)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', {
			name: 'Withdraw REP',
		})
		expectTransactionButtonDisabled(withdrawDialog as HTMLElement, 'Withdraw REP', 'Reduce the withdrawal to 5 000\u00a0REP or less.')
	})

	test('blocks withdraw REP in the workflow modal when the wallet lacks the buffered oracle bounty ETH', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({
						ethBalanceAttoEth: 5n * 10n ** 18n,
					}),
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
							totalPoolHeldAttoRep: 9n * 10n ** 18n,
							totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({
							ethBalanceAttoEth: 5n * 10n ** 18n,
						}),
						securityVaultDetails: createSecurityVaultDetails({
							vaultAttoRepBacking: 12n * 10n ** 18n,
							capacityOwnershipAttoRep: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							targetHealthFactor: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultOwner: zeroAddress,
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
			fireEvent.click(
				documentQueries.getAllByRole('button', {
					name: 'Withdraw REP',
				})[0] as HTMLElement,
			)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', {
			name: 'Withdraw REP',
		})
		expectTransactionButtonDisabled(withdrawDialog as HTMLElement, 'Withdraw REP', 'Need 7\u00a0more\u00a0ETH in this wallet to queue this REP withdrawal.')
	})
})
