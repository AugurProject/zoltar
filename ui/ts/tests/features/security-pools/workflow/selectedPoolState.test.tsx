import { describe, expect, test } from 'bun:test'
import { createSelectedPoolStateFixture, useSecurityPoolWorkflowSectionTestDom } from './fixture'
import { getTransactionButtonState } from '../../../testUtils/transactionActionButton.js'

describe('SecurityPoolWorkflowSection: selected pool state', () => {
	const testDom = useSecurityPoolWorkflowSectionTestDom()
	const { renderLoadedPool, renderWorkflow, setCleanup } = testDom
	const fixture = createSelectedPoolStateFixture()
	const {
		fireEvent,
		within,
		act,
		getAddress,
		zeroAddress,
		SecurityPoolWorkflowSection,
		renderIntoDocument,
		expectTransactionButtonDisabled,
		expectTransactionButtonEnabled,
		createAccountState,
		createTradingProps,
		createSecurityVaultProps,
		createSecurityVaultDetails,
		createOracleManagerDetails,
		createSecurityPoolVaultSummary,
		createForkAuctionProps,
		createForkAuctionDetails,
		createSelectedPool,
		createSecurityPoolWorkflowProps,
	} = fixture
	const getClosestSectionBlock = (headingName: string) => {
		const heading = Array.from(document.body.querySelectorAll('h2, h3, h4')).find(element => element.textContent?.trim() === headingName)
		if (!(heading instanceof HTMLElement)) throw new Error(`Expected ${headingName} heading`)
		const section = heading.closest('.section-block')
		if (!(section instanceof HTMLElement)) throw new Error(`Expected ${headingName} to be inside a section block`)
		return section
	}
	const expectSectionVariant = (headingName: string, variant: 'embedded' | 'plain') => {
		const section = getClosestSectionBlock(headingName)
		expect(section.classList.contains(variant)).toBe(true)
		expect(section.classList.contains('default')).toBe(false)
	}

	test('uses one selected-pool surface with unframed direct structural sections', async () => {
		await renderLoadedPool()

		const routeSurface = document.body.querySelector('.route-workflow-stack')?.closest('.section-block')
		if (!(routeSurface instanceof HTMLElement)) throw new Error('Expected selected pool route surface')
		expect(routeSurface.classList.contains('surface')).toBe(true)
		expect(routeSurface.classList.contains('default')).toBe(false)
		expect(document.body.querySelector('.sticky-object-context.context-strip')).not.toBeNull()
		const persistentContext = document.body.querySelector('.sticky-object-context.context-strip')
		if (!(persistentContext instanceof HTMLElement)) throw new Error('Expected persistent selected-pool context')
		expect(within(persistentContext).getByRole('heading', { name: 'Will this resolve?' })).not.toBeNull()
		expect(within(persistentContext).getAllByText('Security Pool Address')).toHaveLength(1)
		const readOnlyContextItems = persistentContext.querySelector('.sticky-object-context-items')
		if (!(readOnlyContextItems instanceof HTMLElement)) throw new Error('Expected read-only selected-pool context items')
		expect(within(readOnlyContextItems).queryByText('Security Pool Address')).toBeNull()
		expect(within(persistentContext).getByText('Universe')).not.toBeNull()
		const contextDetails = document.body.querySelector('.selected-pool-context-details')
		if (!(contextDetails instanceof HTMLElement) || contextDetails.tagName !== 'DETAILS') throw new Error('Expected collapsible selected-pool context')
		expect(contextDetails.hasAttribute('open')).toBe(false)
		expect(contextDetails.querySelector('summary')?.textContent).toBe('Pool context and metrics')
		expect(document.body.querySelectorAll('.selected-pool-workflow-content > .section-block.default')).toHaveLength(0)
		expect(routeSurface.querySelectorAll('.section-block.default')).toHaveLength(0)
		expectSectionVariant('Vault Operations', 'plain')
		expectSectionVariant('Vault Actions', 'plain')

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Directory' }))
		})
		expectSectionVariant('Vault Directory', 'embedded')
		expect(document.body.querySelector('.vault-position-strip .entity-card')).toBeNull()
	})

	test('renders staged operations as an unframed selected-pool workflow section', async () => {
		await renderLoadedPool({ selectedPoolView: 'staged-operations' })

		expectSectionVariant('Staged Operations', 'plain')
		expect(document.body.querySelector('.section-block.embedded')).not.toBeNull()
	})

	test('renders open oracle as an unframed selected-pool workflow section', async () => {
		await renderLoadedPool({ selectedPoolView: 'price-oracle' })

		expectSectionVariant('Open Oracle', 'plain')
	})

	test('keeps oracle actions disabled off mainnet and explains recovery', async () => {
		const renderOffMainnetOracleView = async (selectedPoolView: 'price-oracle' | 'staged-operations') =>
			renderIntoDocument(
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						accountState: createAccountState({ address: zeroAddress, chainId: '0xaa36a7' }),
						checkedSecurityPoolAddress: zeroAddress,
						poolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
						}),
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: zeroAddress })],
						selectedPoolView,
					})}
					showHeader={false}
				/>,
			)

		const priceOracleRender = await renderOffMainnetOracleView('price-oracle')
		setCleanup(priceOracleRender.cleanup)

		expect(getTransactionButtonState(document.body, 'Request New Price')).toEqual({ disabled: true, reason: 'Switch to Ethereum mainnet.' })

		await priceOracleRender.cleanup()

		const stagedOperationsRender = await renderOffMainnetOracleView('staged-operations')
		setCleanup(stagedOperationsRender.cleanup)

		expect(getTransactionButtonState(document.body, 'Execute Staged Operation')).toEqual({ disabled: true, reason: 'Switch to Ethereum mainnet.' })
	})

	test('keeps the workflow rail visible with disabled items before a pool loads', async () => {
		let browseCalls = 0
		let createCalls = 0
		await renderWorkflow({
			...createSecurityPoolWorkflowProps(),
			onBrowsePools: () => {
				browseCalls += 1
			},
			onCreatePool: () => {
				createCalls += 1
			},
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('group', { name: 'Selected pool views' })).not.toBeNull()
		const secondaryGroup = documentQueries.getByRole('group', { name: 'Additional pool actions' })
		expect(within(secondaryGroup).getByRole('button', { name: 'Staged Operations' })).not.toBeNull()
		expect(within(secondaryGroup).getByRole('button', { name: 'Open Oracle' })).not.toBeNull()

		for (const label of ['Vaults', 'Shares', 'Reporting', 'Fork & Migration', 'Staged Operations', 'Open Oracle']) {
			const button = documentQueries.getByRole('button', { name: label }) as HTMLButtonElement
			expect(button.disabled).toBe(true)
			expect(button.title).toBe('Select a pool before using pool actions.')
		}
		expect(documentQueries.queryByRole('tab', { name: 'Migration' })).toBeNull()
		expect(documentQueries.queryByRole('tab', { name: 'Truth Auction' })).toBeNull()
		expect(documentQueries.queryByRole('tab', { name: 'Settlement' })).toBeNull()

		expect(documentQueries.getByRole('heading', { name: 'Manage Pool' })).not.toBeNull()
		expect(documentQueries.getByText('No pool selected.')).not.toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Browse Pools' }))
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create Pool' }))
		})
		expect(browseCalls).toBe(1)
		expect(createCalls).toBe(1)
		expect(documentQueries.queryByText('Paste a security pool address or browse pools.')).toBeNull()
		expect(documentQueries.queryByText('Locked')).toBeNull()
	})

	test('shows a pool not found warning while an entered address is still unresolved', async () => {
		const unresolvedAddress = '0x00000000000000000000000000000000000000ab'
		await renderWorkflow(
			createSecurityPoolWorkflowProps({
				securityPoolAddress: unresolvedAddress,
			}),
		)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Manage Pool' })).not.toBeNull()
		expect(documentQueries.getByText('Pool not found.')).not.toBeNull()
		expect(documentQueries.queryByText('Refresh this address after the pool is deployed.')).toBeNull()
	})

	test('shows a pool not found card when the selected address does not resolve', async () => {
		const missingAddress = '0x00000000000000000000000000000000000000ab'
		await renderWorkflow(
			createSecurityPoolWorkflowProps({
				checkedSecurityPoolAddress: missingAddress,
				securityPoolAddress: missingAddress,
			}),
		)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Pool not found' })).not.toBeNull()
		expect(documentQueries.getByText('This security pool address was not found.')).not.toBeNull()
	})

	test('keeps selected-pool load errors inline instead of opening liquidation', async () => {
		await renderLoadedPool({
			securityPoolOverviewError: 'Failed to load security pools',
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('alert').textContent).toContain('Failed to load security pools')
		expect(documentQueries.queryByRole('dialog', { name: 'Liquidate Vault' })).toBeNull()
	})

	test('shows only the primary universe-mismatch message with hex universe ids', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					activeUniverseId: 2n,
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress, universeId: 1n })],
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect(document.body.textContent?.includes('This pool belongs to')).toBe(true)
		expect(document.body.textContent?.includes('Pool actions are locked until the app uses the same universe.')).toBe(true)
		expect(documentQueries.getByRole('link', { name: '0x1' })).not.toBeNull()
		expect(document.body.textContent?.includes('0x2')).toBe(true)
		expect(documentQueries.getByRole('button', { name: 'Switch to Pool Universe' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Return to Current Universe' })).not.toBeNull()
		for (const tabLabel of ['Vaults', 'Shares', 'Reporting', 'Fork & Migration', 'Staged Operations', 'Open Oracle']) {
			const tab = documentQueries.getByRole('button', { name: tabLabel })
			expect(tab.getAttribute('title')).toBeNull()
		}
		expect(documentQueries.queryByText('Switch to the same universe before using vault, share, reporting, and fork actions.')).toBeNull()
		expect(documentQueries.queryByText('Switch to the same universe before using this pool.')).toBeNull()
		expect(documentQueries.queryByText('Switch to the matching universe first.')).toBeNull()
	})

	test('renders a vault workspace header and local mode switch for a loaded pool', async () => {
		const poolVault = createSecurityPoolVaultSummary()
		await renderLoadedPool({
			securityPools: [
				createSelectedPool({
					vaultCount: 1n,
					vaults: [poolVault],
				}),
			],
			securityVault: createSecurityVaultProps({
				selectedPoolSecurityMultiplier: 2n,
				securityVaultDetails: createSecurityVaultDetails({ vaultAddress: poolVault.vaultAddress }),
				securityVaultForm: {
					depositAmount: '',
					repWithdrawAmount: '',
					securityBondAllowanceAmount: '',
					securityPoolAddress: zeroAddress,
					selectedVaultAddress: zeroAddress,
				},
			}),
		})

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Security pools' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Pool Summary' })).toBeNull()
		expect(documentQueries.queryByText('Action Readiness')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Open Oracle' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Selected Pool Summary' })).toBeNull()
		expect(documentQueries.queryByText('Workflow')).toBeNull()
		expect(documentQueries.getByText('Question description')).not.toBeNull()
		expect(documentQueries.getByText('Question description')).not.toBeNull()
		expect(documentQueries.getByText('Open Interest Minted')).not.toBeNull()
		expect(documentQueries.getByText('Total REP Backing')).not.toBeNull()
		expect(documentQueries.queryByText('Total Security Bond Allowance')).toBeNull()
		expect(documentQueries.getByText('Current Oracle Price')).not.toBeNull()
		expect(documentQueries.queryByText('Oracle Expires In')).toBeNull()
		const selectedPoolContext = document.body.querySelector('.sticky-object-context.static')
		if (!(selectedPoolContext instanceof HTMLElement)) throw new Error('Expected a non-sticky selected pool context card')
		const lookupLabel = within(selectedPoolContext).getByText('Security Pool Address')
		const firstSummaryMetric = within(selectedPoolContext).getByText('Total REP Backing')
		const lookupPosition = selectedPoolContext.textContent?.indexOf(lookupLabel.textContent ?? '') ?? -1
		const summaryPosition = selectedPoolContext.textContent?.indexOf(firstSummaryMetric.textContent ?? '') ?? -1
		expect(lookupPosition).toBeGreaterThanOrEqual(0)
		expect(summaryPosition).toBeGreaterThanOrEqual(0)
		expect(lookupPosition < summaryPosition).toBe(true)
		expect(documentQueries.getByRole('heading', { name: 'Vault Operations' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Vault Lookup' })).toBeNull()
		const vaultSummaryHeading = documentQueries.getByRole('heading', { name: /Vault Summary/ })
		expect(vaultSummaryHeading).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Selected Vault' })).toBeNull()
		expect(documentQueries.getByText('Selected Vault Address')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Vault Actions' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Staged Operations' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Open Oracle' })).not.toBeNull()
		expect(documentQueries.getAllByRole('button', { name: 'Claim Fees' }).length).toBeGreaterThan(0)
		const vaultSummarySection = vaultSummaryHeading.closest('section')
		if (!(vaultSummarySection instanceof HTMLElement)) throw new Error('Expected a vault summary section')
		expect(within(vaultSummarySection).queryByText('Approved REP')).toBeNull()
		expect(documentQueries.queryByText('Enter a deposit amount greater than zero.')).toBeNull()
		expect(documentQueries.queryByText('Fork Flow')).toBeNull()
		expect(documentQueries.queryByText(/^Blocked:/)).toBeNull()
		expect(documentQueries.queryByText('Oracle Status')).toBeNull()
		expect(documentQueries.queryByText('After market end')).toBeNull()
		expect(documentQueries.queryByText('Manager')).toBeNull()
		expect(documentQueries.getAllByText('Operational').length).toBeGreaterThan(0)
		expect(documentQueries.getByText('Security Multiplier')).not.toBeNull()
		const directoryButton = documentQueries.getByRole('button', { name: 'Directory' })
		expect(documentQueries.getByRole('button', { name: 'Selected' })).not.toBeNull()

		await act(() => {
			fireEvent.click(directoryButton)
		})

		expect(documentQueries.getByRole('heading', { name: 'Vault Directory' })).not.toBeNull()
		expect(documentQueries.getAllByText('Escrowed REP').length).toBeGreaterThan(0)
	})

	test('keeps directory liquidation review available when the oracle price is stale', async () => {
		const liquidationRequests: Array<{ managerAddress: string; securityPoolAddress: string; vaultAddress: string }> = []
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000a4')
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000a5')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					onOpenLiquidationModal: (managerAddress, securityPoolAddress, nextVaultAddress) => {
						liquidationRequests.push({ managerAddress, securityPoolAddress, vaultAddress: nextVaultAddress })
					},
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: false,
						managerAddress: zeroAddress,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							vaults: [createSecurityPoolVaultSummary({ vaultAddress })],
						}),
					],
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Directory' }))
		})
		const reviewLiquidationButton = documentQueries.getByRole('button', { name: 'Review Liquidation' })
		if (!(reviewLiquidationButton instanceof HTMLButtonElement)) throw new Error('Expected Review Liquidation button')
		expect(reviewLiquidationButton.disabled).toBe(false)

		await act(() => {
			fireEvent.click(reviewLiquidationButton)
		})

		expect(liquidationRequests).toEqual([{ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress, vaultAddress }])
	})

	test('shows a parent-pool metric for child pools in the selected summary', async () => {
		const parentPoolAddress = getAddress('0x0000000000000000000000000000000000000200')
		const parentPool = createSelectedPool({
			parent: zeroAddress,
			securityPoolAddress: parentPoolAddress,
			universeId: 1n,
		})
		const selectedPool = createSelectedPool({
			parent: parentPoolAddress,
			securityPoolAddress: getAddress('0x0000000000000000000000000000000000000201'),
			universeId: 11n,
		})
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					securityPoolAddress: selectedPool.securityPoolAddress,
					securityPools: [parentPool, selectedPool],
					selectedPoolView: 'fork-workflow',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const parentPoolLink = documentQueries.getByRole('link', { name: parentPoolAddress })
		expect(parentPoolLink).not.toBeNull()
		expect(document.body.textContent?.includes('Parent Pool')).toBe(true)
		expect(parentPoolLink.getAttribute('title')).toBe(parentPoolAddress)
	})

	test('does not show a parent-pool metric for root pools', async () => {
		const selectedPool = createSelectedPool({
			parent: zeroAddress,
			securityPoolAddress: getAddress('0x0000000000000000000000000000000000000202'),
		})
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					securityPoolAddress: selectedPool.securityPoolAddress,
					securityPools: [selectedPool],
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Parent Pool')).toBeNull()
	})

	test('marks selected-pool collateralization as success when it is above the multiplier threshold', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					repPerEthPrice: 10n ** 18n,
					repPerEthSource: 'mock',
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							securityMultiplier: 2n,
							totalRepDeposit: 10_000n * 10n ** 18n,
							totalSecurityBondAllowance: 2_500n * 10n ** 18n,
						}),
					],
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const collateralizationMetric = document.querySelector('.security-pool-collateralization-display.tone-success, .security-pool-hero-collateralization.tone-success, .security-pool-card-title-collateralization.tone-success')
		expect(collateralizationMetric).not.toBeNull()
		expect(collateralizationMetric?.textContent?.includes('400')).toBe(true)
	})

	test('renders the claim-fees modal vault with the shared address value component', async () => {
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const poolVault = createSecurityPoolVaultSummary({ vaultAddress })
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							vaultCount: 1n,
							vaults: [poolVault],
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ address: vaultAddress }),
						selectedPoolSecurityMultiplier: 2n,
						securityVaultDetails: createSecurityVaultDetails({ vaultAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: zeroAddress,
							selectedVaultAddress: vaultAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const claimFeesButton = documentQueries.getAllByRole('button', { name: 'Claim Fees' })[0]
		if (!(claimFeesButton instanceof HTMLElement)) throw new Error('Expected claim fees launcher button')

		await act(() => {
			fireEvent.click(claimFeesButton)
		})

		const dialog = documentQueries.getByRole('dialog')
		expect(within(dialog).getByRole('button', { name: `Copy address ${vaultAddress}` })).not.toBeNull()
	})

	test('auto-loads the selected vault when a routed pool opens in the vault view', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: selectedPoolAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('does not auto-load the selected vault until the vault form has the selected pool address', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: '',
							selectedVaultAddress: selectedPoolAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(loadSecurityVaultCalls).toEqual([])
	})

	test('treats stale loaded vault details from a different pool as unloaded', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const stalePoolAddress = getAddress('0x00000000000000000000000000000000000000b2')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							securityPoolAddress: stalePoolAddress,
							vaultAddress: zeroAddress,
						}),
						securityVaultForm: {
							depositAmount: '10',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
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
		expect(documentQueries.queryByRole('heading', { name: 'Vault Summary' })).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expectTransactionButtonDisabled(document.body, 'Withdraw REP')
		expectTransactionButtonDisabled(document.body, 'Set Bond Allowance')
		expectTransactionButtonDisabled(document.body, 'Claim Fees')
		const refreshReason = documentQueries.getByText('Refresh the vault to use these actions.')
		const refreshReasonId = refreshReason.getAttribute('id')
		expect(refreshReasonId).not.toBeNull()
		expect(documentQueries.getAllByText('Refresh the vault to use these actions.')).toHaveLength(1)
		expect((documentQueries.getByRole('button', { name: 'Deposit REP' }) as HTMLButtonElement).title).toBe('')
		expect((documentQueries.getByRole('button', { name: 'Deposit REP' }) as HTMLButtonElement).getAttribute('aria-describedby')).toBe(refreshReasonId)
		expect((documentQueries.getByRole('button', { name: 'Withdraw REP' }) as HTMLButtonElement).title).toBe('')
		expect((documentQueries.getByRole('button', { name: 'Withdraw REP' }) as HTMLButtonElement).getAttribute('aria-describedby')).toBe(refreshReasonId)
		expect((documentQueries.getByRole('button', { name: 'Set Bond Allowance' }) as HTMLButtonElement).title).toBe('')
		expect((documentQueries.getByRole('button', { name: 'Set Bond Allowance' }) as HTMLButtonElement).getAttribute('aria-describedby')).toBe(refreshReasonId)
		expect((documentQueries.getByRole('button', { name: 'Claim Fees' }) as HTMLButtonElement).title).toBe('')
		expect((documentQueries.getByRole('button', { name: 'Claim Fees' }) as HTMLButtonElement).getAttribute('aria-describedby')).toBe(refreshReasonId)
		expect((documentQueries.getByRole('button', { name: 'Review Liquidation' }) as HTMLButtonElement).title).toBe('')
	})

	test('shows an Ended badge, allows REP redemption, and blocks ended-pool collateral actions in the vault workflow', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							questionOutcome: 'yes',
							securityPoolAddress: selectedPoolAddress,
						}),
					],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							escalationEscrowedRep: 0n,
							securityPoolAddress: selectedPoolAddress,
						}),
						securityVaultForm: {
							depositAmount: '1',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultRepBalance: 10n * 10n ** 18n,
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Finalized as Yes')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expectTransactionButtonEnabled(document.body, 'Redeem REP')
		expectTransactionButtonDisabled(document.body, 'Set Bond Allowance')
		expectTransactionButtonEnabled(document.body, 'Claim Fees')
		expectTransactionButtonDisabled(document.body, 'Review Liquidation')
		expect(documentQueries.getByRole('button', { name: 'Deposit REP' }).title).toBe('')
		expect(documentQueries.getByRole('button', { name: 'Review Liquidation' }).title).toBe('')
	})

	test('shows a vault-missing notice and hides the embedded summary for an empty selected vault', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b3')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							escalationEscrowedRep: 0n,
							repDepositShare: 0n,
							securityBondAllowance: 0n,
							securityPoolAddress: selectedPoolAddress,
							unpaidEthFees: 0n,
						}),
						securityVaultForm: {
							depositAmount: '1',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
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
		expect(documentQueries.getByText('This vault does not exist. Deposit REP to create it.')).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Vault Summary' })).toBeNull()
		for (const actionLabel of ['Withdraw REP', 'Set Bond Allowance', 'Claim Fees', 'Review Liquidation']) {
			const actionButton = documentQueries.getByRole('button', { name: actionLabel }) as HTMLButtonElement
			expect(actionButton.title).toBe('This vault does not exist.')
		}
		expectTransactionButtonDisabled(document.body, 'Review Liquidation')
		const reviewLiquidationButton = documentQueries.getByRole('button', { name: 'Review Liquidation' }) as HTMLButtonElement

		await act(() => {
			fireEvent.click(reviewLiquidationButton)
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Liquidate Vault' })).toBeNull()
	})

	test('keeps Review Liquidation silently disabled when the wallet is disconnected', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b6')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ address: undefined }),
					checkedSecurityPoolAddress: selectedPoolAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							securityPoolAddress: selectedPoolAddress,
							vaultAddress: zeroAddress,
						}),
						securityVaultForm: {
							depositAmount: '1',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
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
		const reviewLiquidationButton = documentQueries.getByRole('button', { name: 'Review Liquidation' }) as HTMLButtonElement
		expect(reviewLiquidationButton.disabled).toBe(true)
		expect(reviewLiquidationButton.title).toBe('')

		await act(() => {
			fireEvent.click(reviewLiquidationButton)
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Liquidate Vault' })).toBeNull()
	})

	test('keeps Review Liquidation silently disabled for a vault owned by another account', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b7')
		const otherVaultAddress = getAddress('0x00000000000000000000000000000000000000b8')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ address: zeroAddress }),
					checkedSecurityPoolAddress: selectedPoolAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							securityPoolAddress: selectedPoolAddress,
							vaultAddress: otherVaultAddress,
						}),
						securityVaultForm: {
							depositAmount: '1',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: otherVaultAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const reviewLiquidationButton = documentQueries.getByRole('button', { name: 'Review Liquidation' }) as HTMLButtonElement
		expect(reviewLiquidationButton.disabled).toBe(true)
		expect(reviewLiquidationButton.title).toBe('')

		await act(() => {
			fireEvent.click(reviewLiquidationButton)
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Liquidate Vault' })).toBeNull()
	})

	test('treats an escrowed-only vault as existing', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b4')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							escalationEscrowedRep: 1n,
							repDepositShare: 0n,
							securityBondAllowance: 0n,
							securityPoolAddress: selectedPoolAddress,
							unpaidEthFees: 0n,
						}),
						securityVaultForm: {
							depositAmount: '1',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
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
		expect(documentQueries.queryByText('This vault does not exist. Deposit REP to create it.')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Vault Summary' })).not.toBeNull()
		expectTransactionButtonEnabled(document.body, 'Review Liquidation')
	})

	test('shows Fork Migration in the selected-pool badge once fork migration has started', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ forkOutcome: 'yes', migratedRep: 1n, securityPoolAddress: selectedPoolAddress, systemState: 'poolForked' })],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expect(within(document.body).getByText('Fork Migration')).not.toBeNull()
	})

	test('disables minting in trading when the workflow state shows the selected pool has ended', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const selectedPool = createSelectedPool({
			questionOutcome: 'none',
			securityPoolAddress: selectedPoolAddress,
		})
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							questionOutcome: 'yes',
							securityPoolAddress: selectedPoolAddress,
						}),
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [selectedPool],
					selectedPoolView: 'trading',
					trading: createTradingProps({
						selectedPool,
					}),
				})}
				showHeader={false}
			/>,
		)
		setCleanup(renderedComponent.cleanup)

		expectTransactionButtonDisabled(document.body, 'Mint complete sets')
	})

	test('allows selecting a vault from the directory within the current pool', async () => {
		const formChanges: Array<{ selectedVaultAddress?: string }> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							securityPoolAddress: selectedPoolAddress,
							vaultCount: 1n,
							vaults: [createSecurityPoolVaultSummary({ vaultAddress })],
						}),
					],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: nextVaultAddress => {
							loadSecurityVaultCalls.push(nextVaultAddress)
						},
						onSecurityVaultFormChange: update => {
							formChanges.push(update)
						},
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
			fireEvent.click(documentQueries.getByRole('button', { name: 'Directory' }))
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Select Vault' }))
		})

		expect(formChanges).toContainEqual({ selectedVaultAddress: vaultAddress })
		expect(loadSecurityVaultCalls).toContain(vaultAddress)
	})
})
