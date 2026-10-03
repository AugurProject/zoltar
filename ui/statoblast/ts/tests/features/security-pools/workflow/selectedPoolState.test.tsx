import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled, getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { SecurityPoolWorkflowRouteContentProps } from '@zoltar/ui-zoltar-shared/features/types.js'
import {
	createAccountState,
	createForkAuctionDetails,
	createForkAuctionProps,
	createLoadedPoolProps,
	createOracleManagerDetails,
	createSecurityPoolVaultSummary,
	createSecurityPoolWorkflowProps,
	createSecurityVaultDetails,
	createSecurityVaultForm,
	createSecurityVaultProps,
	createSelectedPool,
	createTradingProps,
} from './builders.js'
import { useSecurityPoolWorkflowSectionTestDom } from './testDom.js'

installTestRouting()
describe('SecurityPoolWorkflowSection: selected pool state', () => {
	const { renderLoadedPool, renderWorkflow } = useSecurityPoolWorkflowSectionTestDom()
	// Renders the workflow with one loaded pool at the given address selected and checked.
	const renderPoolAt = async (securityPoolAddress: Address, pool: Partial<ListedSecurityPool> = {}, overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}) =>
		await renderWorkflow(createLoadedPoolProps({ checkedSecurityPoolAddress: securityPoolAddress, securityPoolAddress, securityPools: [createSelectedPool({ securityPoolAddress, ...pool })], ...overrides }))
	const filledVaultForm = (securityPoolAddress: Address, selectedVaultOwner: Address = zeroAddress) => createSecurityVaultForm({ depositAmount: '1', repWithdrawAmount: '1', targetHealthFactor: '2', securityPoolAddress, selectedVaultOwner })
	const validOracle = () => createOracleManagerDetails({ isPriceValid: true })
	const vaultOperationsParameters = { accountAddress: zeroAddress, refreshState: async () => undefined, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined }
	const openMyVault = async () => {
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: /^(My vault|Vault details)$/ })))
	}
	const openAllVaults = async () => {
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' }))
		})
	}
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

	test('shows vault operations directly in My vault without a separate tab or launcher', async () => {
		await renderLoadedPool({
			vaultOperationsParameters,
			securityVault: createSecurityVaultProps({ securityVaultDetails: createSecurityVaultDetails(), securityVaultForm: createSecurityVaultForm() }),
		})
		const page = within(document.body)
		expect(page.queryByRole('tab', { name: 'Vault operations' })).toBeNull()
		expect(page.queryByRole('button', { name: /^Vault operations$/ })).toBeNull()
		for (const label of ['Deposit REP', 'Set commitment limit', 'Withdraw REP', 'Open price oracle']) expect(page.queryByRole('button', { name: label })).toBeNull()
		expect(page.queryByRole('heading', { name: 'Vault actions' })).toBeNull()
		expect(document.body.textContent).not.toContain('A valid OpenOracle price is required for commitment changes')
		expect(page.getByRole('heading', { name: 'My vault' })).not.toBeNull()
		expect(page.getByRole('textbox', { name: 'Deposit REP (optional)' })).not.toBeNull()
		expect(page.getByRole('button', { name: 'Review vault operations' })).not.toBeNull()
		expect(page.queryByText('Current commitment')).toBeNull()
		expect(page.queryByText('Current REP backing')).toBeNull()
		expect(page.getByText('Wallet REP balance')).not.toBeNull()
		await openAllVaults()
		expect(page.queryByRole('textbox', { name: 'Deposit REP (optional)' })).toBeNull()
		const readinessLink = page.getAllByRole('button', { name: 'Open vaults' })[0]
		if (readinessLink === undefined) throw new Error('Expected vault readiness link')
		await act(() => fireEvent.click(readinessLink))
		expect(page.getByRole('textbox', { name: 'Deposit REP (optional)' })).not.toBeNull()
	})

	test('uses one selected-pool surface with unframed direct structural sections', async () => {
		await renderLoadedPool()

		const routeSurface = document.body.querySelector('.route-workflow-stack')?.closest('.section-block')
		if (!(routeSurface instanceof HTMLElement)) throw new Error('Expected selected pool route surface')
		expect(routeSurface.classList.contains('surface')).toBe(true)
		expect(routeSurface.classList.contains('default')).toBe(false)
		expect(document.body.querySelector('.selected-pool-context-details')).toBeNull()
		expect(document.body.querySelector('.selected-pool-workspace-grid')).toBeNull()
		const objectHeader = document.body.querySelector('.selected-pool-object-header')
		if (!(objectHeader instanceof HTMLElement)) throw new Error('Expected the selected-pool object header')
		expect(within(document.body).queryByRole('button', { name: 'Change pool' }) === null).toBe(true)
		expect(within(document.body).getByRole('button', { name: 'Refresh pool' })).not.toBeNull()
		expect(within(objectHeader).getByRole('heading', { name: 'Will this resolve?' })).not.toBeNull()
		expect(objectHeader.querySelector('.pool-object-meta .badge')?.textContent).toBe('Operational')
		expect(within(objectHeader).queryByText('Known vaults')).toBeNull()
		expect(within(objectHeader).queryByText('Security multiplier')).toBeNull()
		expect(within(objectHeader).queryByText('Initial report priority fee')).toBeNull()
		const details = document.body.querySelector('.pool-reference-details details')
		expect(details?.hasAttribute('open')).toBe(false)
		expect(details?.textContent).toContain('Initial report priority fee')
		expect(details?.textContent).toContain('Question description')
		expect(details?.querySelectorAll('button[aria-label^="Copy identifier"]')).toHaveLength(1)
		expect(within(document.body).getByText('Open interest / commitment')).not.toBeNull()
		const tabList = within(document.body).getByRole('tablist', { name: 'Selected pool views' })
		expect(tabList.getAttribute('data-orientation')).toBe('horizontal')
		expect(tabList.getAttribute('data-size')).toBe('compact')
		expect(tabList.compareDocumentPosition(objectHeader) & Node.DOCUMENT_POSITION_PRECEDING).not.toBe(0)
		const tabs = within(tabList).getAllByRole('tab')
		expect(tabs.map(tab => tab.textContent)).toEqual(['Vaults', 'Shares', 'Reporting'])
		const workflowPanel = document.body.querySelector('.selected-pool-workflow-content')
		if (!(workflowPanel instanceof HTMLElement)) throw new Error('Expected the selected-pool workflow panel')
		expect(workflowPanel.getAttribute('role')).toBe('tabpanel')
		expect(workflowPanel.getAttribute('aria-labelledby')).toBe('selected-pool-view-vaults')
		for (const tab of tabs) expect(tab.getAttribute('aria-controls')).toBe(workflowPanel.id)
		expect(within(tabList).getByRole('tab', { name: 'Vaults' }).getAttribute('aria-selected')).toBe('true')
		expect(document.body.querySelectorAll('.selected-pool-workflow-content > .section-block.default')).toHaveLength(0)
		expect(routeSurface.querySelectorAll('.section-block.default')).toHaveLength(0)
		expectSectionVariant('Vault actions', 'plain')

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' }))
		})
		expect(within(document.body).queryByRole('heading', { name: 'Vault Directory' })).toBeNull()
		expect(document.body.querySelector('.vault-position-strip .entity-card')).toBeNull()
	})

	test('renders staged operations as an unframed selected-pool workflow section', async () => {
		await renderLoadedPool({ selectedPoolView: 'staged-operations' })

		expectSectionVariant('Staged operations', 'plain')
		expect(document.body.querySelector('.section-block.embedded')).not.toBeNull()
	})

	test('renders price oracle as an unframed selected-pool workflow section', async () => {
		await renderLoadedPool({ selectedPoolView: 'price-oracle' })

		expectSectionVariant('Price oracle', 'plain')
	})

	test('displays standing commitments independently of the pool oracle and market quote', async () => {
		await renderWorkflow(
			createSecurityPoolWorkflowProps({
				securityPoolAddress: zeroAddress,
				repPerEthPrice: 10n ** 18n,
				securityPools: [createSelectedPool({ lastOraclePrice: 5n * 10n ** 18n, lastOracleSettlementTimestamp: 1n, statoblastSecurityMultiplierBps: 20000n, totalUnderwritingLimitAttoEth: 100n * 10n ** 18n })],
			}),
			{ chainTimestamp: 2n, showHeader: true },
		)

		const pageText = (document.body.textContent ?? '').replace(/\s+/g, ' ')
		expect(pageText).toContain('100.00 ETH')
		expect(pageText).not.toContain('10.00 ETH')
	})

	test('displays standing commitments independently of the configured UI price', async () => {
		await renderLoadedPool({
			repPerEthPrice: 1n * 10n ** 18n,
			uiPriceOracle: 'uniswap',
			securityPools: [createSelectedPool({ lastOraclePrice: 5n * 10n ** 18n, statoblastSecurityMultiplierBps: 20_000n, totalUnderwritingLimitAttoEth: 100n * 10n ** 18n })],
		})

		const pageText = (document.body.textContent ?? '').replace(/\s+/g, ' ')
		expect(pageText).toContain('100.00 ETH')
		expect(pageText).not.toContain('10.00 ETH')
	})

	test.each([
		['price-oracle', 'Request new price…'],
		['staged-operations', 'Execute staged operation'],
	] as const)('keeps oracle actions disabled off Sepolia and explains recovery in %s', async (selectedPoolView, actionLabel) => {
		await renderLoadedPool({ accountState: createAccountState({ address: zeroAddress, chainId: '0x1' }), poolOracleManagerDetails: validOracle(), selectedPoolView })

		expect(getTransactionButtonState(document.body, actionLabel)).toEqual({ disabled: true, reason: 'Switch to Sepolia.' })
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
		expect(documentQueries.queryByRole('tablist')).toBeNull()
		expect(document.body.querySelectorAll('[role="tab"]')).toHaveLength(0)
		for (const label of ['Vaults', 'Shares', 'Reporting']) {
			expect(documentQueries.queryByText(label)).toBeNull()
		}
		expect(document.body.querySelector('.selected-pool-object-header')).toBeNull()
		expect(document.body.querySelector('.selected-pool-workspace')).toBeNull()
		expect(documentQueries.getByRole('textbox', { name: 'Security pool address' })).not.toBeNull()

		expect(documentQueries.queryByRole('heading', { name: 'Manage Pool' })).toBeNull()
		const emptyState = document.body.querySelector('.empty-state')
		if (!(emptyState instanceof HTMLElement)) throw new Error('Expected the no-pool empty state')
		expect(emptyState.querySelector('.empty-state-title')?.textContent).toBe('No pool selected')
		expect(emptyState.querySelector('.empty-state-detail')?.textContent).toBe('Enter a pool address above or browse pools.')
		expect(within(emptyState).getByRole('button', { name: 'Browse pools' })).not.toBeNull()
		expect(within(emptyState).getByRole('button', { name: 'Create pool' })).not.toBeNull()
		expect(documentQueries.queryByText('No pool selected.')).toBeNull()
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Browse pools' }))
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create pool' }))
		})
		expect(browseCalls).toBe(1)
		expect(createCalls).toBe(1)
		expect(documentQueries.queryByText('Paste a security pool address or browse pools.')).toBeNull()
		expect(documentQueries.queryByText('Locked')).toBeNull()
	})

	test.each([undefined, zeroAddress])('shows loading while an entered address is unresolved (previous lookup: %s)', async checkedSecurityPoolAddress => {
		const unresolvedAddress = '0x00000000000000000000000000000000000000ab'
		const props = createSecurityPoolWorkflowProps({ securityPoolAddress: unresolvedAddress, checkedSecurityPoolAddress })
		const { rerender } = await renderWorkflow(props)

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Manage Pool' })).toBeNull()
		expect(documentQueries.getByText('Loading…')).not.toBeNull()
		expect(document.body.textContent).not.toContain('not found')
		expect(document.body.textContent).not.toContain('does not exist')
		expect(documentQueries.queryByText('Refresh this address after the pool is deployed.')).toBeNull()

		await rerender({ ...props, loadingSecurityPools: true })
		expect(documentQueries.getByText('Loading…')).not.toBeNull()
		expect(document.body.textContent).not.toContain('not found')

		await rerender(createLoadedPoolProps({ securityPoolAddress: unresolvedAddress, checkedSecurityPoolAddress: unresolvedAddress, securityPools: [createSelectedPool({ securityPoolAddress: getAddress(unresolvedAddress) })] }))
		expect(documentQueries.getByRole('tablist', { name: 'Selected pool views' })).not.toBeNull()
		expect(documentQueries.queryByText('Loading…')).toBeNull()
		expect(document.body.textContent).not.toContain('not found')
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

	test('offers retry after a timed-out initial read without claiming the pool is missing', async () => {
		await renderWorkflow(createSecurityPoolWorkflowProps({ securityPoolAddress: '0x00000000000000000000000000000000000000ab', securityPoolOverviewError: 'RPC read timed out. Retry loading data.' }))
		const queries = within(document.body)
		expect(queries.getByRole('alert').textContent).toContain('RPC read timed out. Retry loading data.')
		expect(queries.getByRole('button', { name: 'Refresh pool' }).hasAttribute('disabled')).toBe(false)
		expect(queries.queryByText('Pool not found.') === null).toBe(true)
	})

	test('keeps selected-pool load errors inline instead of opening liquidation', async () => {
		await renderLoadedPool({
			securityPoolOverviewError: 'Failed to load security pools',
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('alert').textContent).toContain('Failed to load security pools')
		expect(documentQueries.queryByRole('dialog', { name: 'Liquidate vault' })).toBeNull()
	})

	test('shows only the primary universe-mismatch message with universe names', async () => {
		await renderLoadedPool({ activeUniverseId: 2n, securityPools: [createSelectedPool({ universeId: 1n })] })

		const documentQueries = within(document.body)
		expect(document.body.textContent?.includes('This pool belongs to')).toBe(true)
		expect(document.body.textContent?.includes('Pool actions are locked until the app uses the same universe.')).toBe(true)
		expect(documentQueries.getByRole('link', { name: 'Universe 0x1' })).not.toBeNull()
		expect(document.body.textContent?.includes('Universe 0x2')).toBe(true)
		expect(documentQueries.getByRole('button', { name: 'Switch to pool universe' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Return to current universe' })).not.toBeNull()
		expect(documentQueries.queryByRole('tablist')).toBeNull()
		expect(document.body.querySelector('.selected-pool-object-header')).not.toBeNull()
		expect(document.body.querySelector('.selected-pool-workflow-content')).toBeNull()
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
				selectedPoolStatoblastSecurityMultiplierBps: 20_000n,
				securityVaultDetails: createSecurityVaultDetails({ vaultAddress: poolVault.vaultAddress }),
				securityVaultForm: createSecurityVaultForm(),
			}),
		})

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Security pools' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Pool Summary' })).toBeNull()
		expect(documentQueries.queryByText('Action Readiness')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Price oracle' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Selected pool Summary' })).toBeNull()
		expect(documentQueries.queryByText('Workflow')).toBeNull()
		expect(documentQueries.getByText('Question description')).not.toBeNull()
		expect(documentQueries.getByText('Open interest / commitment')).not.toBeNull()
		expect(documentQueries.getByText('Pool-held REP')).not.toBeNull()
		expect(documentQueries.queryByText('Total Underwriting commitments')).toBeNull()
		expect(documentQueries.getByText('OpenOracle price')).not.toBeNull()
		expect(documentQueries.queryByText('Current oracle price')).toBeNull()
		expect(documentQueries.queryByText('Oracle Expires In')).toBeNull()
		expect(document.body.querySelectorAll('.selected-pool-object-header')).toHaveLength(1)
		expect(documentQueries.queryByRole('button', { name: 'Change pool' }) === null).toBe(true)
		expect(documentQueries.queryByRole('textbox', { name: 'Security pool address' })).toBeNull()
		expect(document.body.querySelector('.pool-address-display')).not.toBeNull()
		expect(document.body.querySelector('.selected-pool-context-details')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Vault Operations' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Vault lookup' })).toBeNull()
		const vaultSummaryHeading = documentQueries.getByRole('heading', { name: 'My vault' })
		expect(vaultSummaryHeading).not.toBeNull()
		expect(documentQueries.queryByRole('textbox', { name: 'Vault owner address' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Vault actions' })).not.toBeNull()
		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'More tools' })))
		expect(documentQueries.getByRole('button', { name: 'Staged operations' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Price oracle' })).not.toBeNull()
		expect(documentQueries.getAllByRole('button', { name: 'Claim fees' }).length).toBeGreaterThan(0)
		const vaultSummarySection = vaultSummaryHeading.closest('.entity-card')
		if (!(vaultSummarySection instanceof HTMLElement)) throw new Error('Expected a selected vault summary card')
		expect(within(vaultSummarySection).queryByText('Approved REP')).toBeNull()
		expect(documentQueries.queryByText('Enter a deposit amount greater than zero.')).toBeNull()
		expect(documentQueries.queryByText('Fork Flow')).toBeNull()
		expect(documentQueries.queryByText(/^Blocked:/)).toBeNull()
		expect(documentQueries.queryByText('Oracle Status')).toBeNull()
		expect(documentQueries.queryByText('After market end')).toBeNull()
		expect(documentQueries.queryByText('Manager')).toBeNull()
		expect(documentQueries.getByText('Security multiplier')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'All vaults' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'My vault' })).not.toBeNull()

		await openAllVaults()

		expect(documentQueries.queryByRole('heading', { name: 'Vault Directory' })).toBeNull()
		expect(documentQueries.getAllByText('Dispute-staked REP').length).toBeGreaterThan(0)
	})

	test('distinguishes filtered current positions from an empty known-vault registry', async () => {
		await renderLoadedPool({
			securityPools: [createSelectedPool({ vaultCount: 2n, vaults: [] })],
		})

		await openAllVaults()

		expect(within(document.body).getByText('No current positions among 2 known vaults.')).not.toBeNull()
		expect(within(document.body).queryByText('No known vaults in this pool.')).toBeNull()
	})

	test('warns when the current-position directory reaches its registry scan limit', async () => {
		await renderLoadedPool({
			securityPools: [createSelectedPool({ vaultCount: 600n, vaultScanCapped: true, vaults: [] })],
		})

		await openAllVaults()

		expect(within(document.body).getByText('Registry scan limit reached. Some current positions may not be shown.')).not.toBeNull()
		expect(within(document.body).getByText('No current positions found within the scan limit.')).not.toBeNull()
		expect(within(document.body).queryByText('Showing 0 current positions from 600 known vaults, newest-registered first.')).toBeNull()
		expect(within(document.body).queryByText('No current positions among 600 known vaults.')).toBeNull()
	})

	test('renders a selected bad-debt-only known vault as an existing position', async () => {
		await renderLoadedPool({
			securityVault: createSecurityVaultProps({
				securityVaultDetails: createSecurityVaultDetails({
					badDebtAttoEth: 2n,
					underwritingLimitAttoEth: 0n,
					claimableFeesAttoEth: 0n,
					disputeStakedAttoRep: 0n,
					vaultAttoRepBacking: 0n,
				}),
				securityVaultForm: filledVaultForm(zeroAddress),
			}),
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'My vault' })).not.toBeNull()
		expect(documentQueries.getByText('Bad debt')).not.toBeNull()
		expect(documentQueries.queryByText('This vault does not exist.')).toBeNull()
	})

	test('keeps directory liquidation review available when the oracle price is stale', async () => {
		const liquidationRequests: Array<{ managerAddress: string; securityPoolAddress: string; vaultAddress: string }> = []
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000a4')
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000a5')
		await renderPoolAt(
			selectedPoolAddress,
			{ managerAddress: zeroAddress, vaults: [createSecurityPoolVaultSummary({ vaultAddress })] },
			{
				onOpenLiquidationModal: (managerAddress, securityPoolAddress, nextVaultAddress) => {
					liquidationRequests.push({ managerAddress, securityPoolAddress, vaultAddress: nextVaultAddress })
				},
				poolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, managerAddress: zeroAddress }),
				selectedPoolView: 'vaults',
			},
		)

		await openAllVaults()
		const reviewLiquidationButton = within(document.body).getByRole('button', { name: 'Liquidate vault' })
		if (!(reviewLiquidationButton instanceof HTMLButtonElement)) throw new Error('Expected Liquidate vault button')
		expect(reviewLiquidationButton.disabled).toBe(false)

		await act(() => {
			fireEvent.click(reviewLiquidationButton)
		})

		expect(liquidationRequests).toEqual([{ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress, vaultAddress }])
	})

	test('shows a parent-pool metric for child pools in the selected summary', async () => {
		const parentPoolAddress = getAddress('0x0000000000000000000000000000000000000200')
		const parentPool = createSelectedPool({ parent: zeroAddress, securityPoolAddress: parentPoolAddress, universeId: 1n })
		const selectedPool = createSelectedPool({ parent: parentPoolAddress, securityPoolAddress: getAddress('0x0000000000000000000000000000000000000201'), universeId: 11n })
		await renderWorkflow(createSecurityPoolWorkflowProps({ securityPoolAddress: selectedPool.securityPoolAddress, securityPools: [parentPool, selectedPool], selectedPoolView: 'fork-workflow' }))

		const parentPoolLink = within(document.body).getByRole('link', { name: parentPoolAddress })
		expect(parentPoolLink).not.toBeNull()
		expect(document.body.textContent?.includes('Parent pool')).toBe(true)
		expect(parentPoolLink.getAttribute('title')).toBe(parentPoolAddress)
	})

	test('does not show a parent-pool metric for root pools', async () => {
		const selectedPool = createSelectedPool({ parent: zeroAddress, securityPoolAddress: getAddress('0x0000000000000000000000000000000000000202') })
		await renderWorkflow(createSecurityPoolWorkflowProps({ securityPoolAddress: selectedPool.securityPoolAddress, securityPools: [selectedPool] }))

		expect(within(document.body).queryByText('Parent pool')).toBeNull()
	})

	test('does not present pool-held vault REP backing alone as selected-pool collateralization health', async () => {
		await renderLoadedPool({
			repPerEthPrice: 10n ** 18n,
			repPerEthSource: 'mock',
			securityPools: [createSelectedPool({ statoblastSecurityMultiplierBps: 20_000n, totalPoolHeldAttoRep: 10_000n * 10n ** 18n, totalUnderwritingLimitAttoEth: 2_500n * 10n ** 18n })],
		})

		const collateralizationMetric = document.querySelector('.security-pool-collateralization-display.tone-success, .security-pool-hero-collateralization.tone-success, .security-pool-card-title-collateralization.tone-success')
		expect(collateralizationMetric).toBeNull()
		expect(within(document.body).getByText('Pool-held REP')).not.toBeNull()
	})

	test('claims fees directly from the selected vault', async () => {
		let claims = 0
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000a1')
		await renderLoadedPool({
			securityPools: [createSelectedPool({ vaultCount: 1n, vaults: [createSecurityPoolVaultSummary({ vaultAddress })] })],
			securityVault: createSecurityVaultProps({
				onRedeemFees: () => {
					claims += 1
				},
				accountState: createAccountState({ address: vaultAddress }),
				selectedPoolStatoblastSecurityMultiplierBps: 20_000n,
				securityVaultDetails: createSecurityVaultDetails({ vaultAddress }),
				securityVaultForm: createSecurityVaultForm({ selectedVaultOwner: vaultAddress }),
			}),
		})

		const documentQueries = within(document.body)
		await openMyVault()
		const claimFeesButton = documentQueries.getAllByRole('button', { name: 'Claim fees' })[0]
		if (!(claimFeesButton instanceof HTMLElement)) throw new Error('Expected claim fees launcher button')

		await act(() => {
			fireEvent.click(claimFeesButton)
		})

		expect(documentQueries.queryByRole('dialog')).toBeNull()
		expect(claims).toBe(1)
	})

	test.each([
		['auto-loads the selected vault when a routed pool opens in the vault view', zeroAddress, [undefined]],
		['does not auto-load the selected vault until the vault form has the selected pool address', '', []],
	] as const)('%s', async (_name, formPoolAddress, expectedLoads) => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		await renderLoadedPool({
			securityVault: createSecurityVaultProps({
				onLoadSecurityVault: vaultAddress => {
					loadSecurityVaultCalls.push(vaultAddress)
				},
				securityVaultForm: createSecurityVaultForm({ securityPoolAddress: formPoolAddress }),
			}),
		})

		expect(loadSecurityVaultCalls).toEqual([...expectedLoads])
	})

	test('treats stale loaded vault details from a different pool as unloaded', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const stalePoolAddress = getAddress('0x00000000000000000000000000000000000000b2')
		await renderPoolAt(
			selectedPoolAddress,
			{},
			{
				securityVault: createSecurityVaultProps({
					securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: stalePoolAddress }),
					securityVaultForm: createSecurityVaultForm({ depositAmount: '10', repWithdrawAmount: '1', targetHealthFactor: '2', securityPoolAddress: selectedPoolAddress }),
				}),
				selectedPoolView: 'vaults',
			},
		)

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Vault summary' })).toBeNull()
		expect(documentQueries.queryByText('Refresh the vault to use these actions.')).toBeNull()
		for (const actionLabel of ['Deposit REP', 'Withdraw REP', 'Claim fees']) {
			expectTransactionButtonDisabled(document.body, actionLabel)
			expect(getTransactionButtonState(document.body, actionLabel).reason).toBeUndefined()
			expect(documentQueries.getByRole('button', { name: actionLabel }).getAttribute('aria-describedby')).toBeNull()
		}
		// The wallet's own vault never offers liquidation, so it has no launcher to block.
		expect(documentQueries.queryByRole('button', { name: 'Liquidate vault' })).toBeNull()
	})

	test('shows an Ended badge, allows REP redemption, and blocks ended-pool settlement-collateral actions in the vault workflow', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		await renderPoolAt(
			selectedPoolAddress,
			{ questionOutcome: 'yes' },
			{
				poolOracleManagerDetails: validOracle(),
				securityVault: createSecurityVaultProps({
					// Redemption requires the commitment to be exited first.
					securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n, securityPoolAddress: selectedPoolAddress, underwritingLimitAttoEth: 0n }),
					securityVaultForm: filledVaultForm(selectedPoolAddress),
					walletRepBalanceAttoRep: 10n * 10n ** 18n,
				}),
				selectedPoolView: 'vaults',
			},
		)

		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expectTransactionButtonEnabled(document.body, 'Redeem REP')
		expectTransactionButtonEnabled(document.body, 'Claim fees')
		expect(getTransactionButtonState(document.body, 'Deposit REP').reason).toBe('REP deposits are unavailable because this pool has ended. Available redemption and fee actions remain below.')
		expect(within(document.body).queryByRole('button', { name: 'Liquidate vault' })).toBeNull()
	})

	test('shows a vault-missing notice and hides the embedded summary for an empty selected vault', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b3')
		await renderPoolAt(
			selectedPoolAddress,
			{},
			{
				securityVault: createSecurityVaultProps({
					securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 0n, vaultAttoRepBacking: 0n, underwritingLimitAttoEth: 0n, securityPoolAddress: selectedPoolAddress, claimableFeesAttoEth: 0n }),
					securityVaultForm: filledVaultForm(selectedPoolAddress),
				}),
				selectedPoolView: 'vaults',
			},
		)

		const documentQueries = within(document.body)
		await openMyVault()
		expect(documentQueries.getByText('This vault does not exist. Deposit REP to create it.')).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Vault summary' })).toBeNull()
		for (const actionLabel of ['Withdraw REP', 'Claim fees']) {
			expect(getTransactionButtonState(document.body, actionLabel).reason).toBe('This vault does not exist.')
		}
		expect(documentQueries.queryByRole('button', { name: 'Liquidate vault' })).toBeNull()
		expect(documentQueries.queryByRole('dialog', { name: 'Liquidate vault' })).toBeNull()
	})

	test.each([false, true])('explains why liquidation requires a connected wallet (vault operations: %s)', async bundled => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b6')
		await renderPoolAt(
			selectedPoolAddress,
			{},
			{
				accountState: createAccountState({ address: undefined }),
				...(bundled ? { vaultOperationsParameters: { ...vaultOperationsParameters, accountAddress: undefined } } : {}),
				poolOracleManagerDetails: validOracle(),
				securityVault: createSecurityVaultProps({
					securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress }),
					securityVaultForm: filledVaultForm(selectedPoolAddress),
				}),
				selectedPoolView: 'vaults',
			},
		)

		const documentQueries = within(document.body)
		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'By address' })))
		const reviewLiquidationButton = documentQueries.getByRole('button', { name: 'Liquidate vault' }) as HTMLButtonElement
		expect(reviewLiquidationButton.disabled).toBe(true)
		expect(getTransactionButtonState(document.body, 'Liquidate vault').reason).toBe('Connect a wallet to liquidate a vault.')

		await act(() => {
			fireEvent.click(reviewLiquidationButton)
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Liquidate vault' })).toBeNull()
	})

	test.each([false, true])('enables liquidation of another account’s vault by address (vault operations: %s)', async bundled => {
		let openedTarget: string | undefined
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b7')
		const otherVaultAddress = getAddress('0x00000000000000000000000000000000000000b8')
		await renderPoolAt(
			selectedPoolAddress,
			{},
			{
				accountState: createAccountState({ address: zeroAddress }),
				...(bundled ? { vaultOperationsParameters } : {}),
				onOpenLiquidationModal: (_manager, _pool, target) => {
					openedTarget = target
				},
				poolOracleManagerDetails: validOracle(),
				securityVault: createSecurityVaultProps({
					securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: otherVaultAddress }),
					securityVaultForm: filledVaultForm(selectedPoolAddress, otherVaultAddress),
				}),
				selectedPoolView: 'vaults',
			},
		)

		const documentQueries = within(document.body)
		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'By address' })))
		const reviewLiquidationButton = documentQueries.getByRole('button', { name: 'Liquidate vault' }) as HTMLButtonElement
		expect(reviewLiquidationButton.disabled).toBe(false)
		expect(getTransactionButtonState(document.body, 'Liquidate vault').reason).toBeUndefined()

		await act(() => {
			fireEvent.click(reviewLiquidationButton)
		})

		expect(openedTarget).toBe(otherVaultAddress)
	})

	test('treats an escrowed-only vault as existing', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b4')
		await renderPoolAt(
			selectedPoolAddress,
			{},
			{
				securityVault: createSecurityVaultProps({
					securityVaultDetails: createSecurityVaultDetails({ disputeStakedAttoRep: 1n, vaultAttoRepBacking: 0n, underwritingLimitAttoEth: 0n, securityPoolAddress: selectedPoolAddress, claimableFeesAttoEth: 0n }),
					securityVaultForm: filledVaultForm(selectedPoolAddress),
				}),
				selectedPoolView: 'vaults',
			},
		)

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('This vault does not exist. Deposit REP to create it.')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'My vault' })).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Liquidate vault' })).toBeNull()
		expect(document.body.textContent).not.toContain('Choose another vault to liquidate.')
	})

	test('keeps the duplicate summary absent after fork migration starts', async () => {
		await renderLoadedPool({ securityPools: [createSelectedPool({ forkOutcome: 'yes', migratedAttoRep: 1n, systemState: 'poolForked' })], selectedPoolView: 'reporting' })

		expect(document.body.querySelectorAll('.selected-pool-object-header')).toHaveLength(1)
		expect(document.body.querySelector('.pool-object-meta .badge')?.textContent).toBe('Fork migration')
	})

	test('disables minting in trading when the workflow state shows the selected pool has ended', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const selectedPool = createSelectedPool({ questionOutcome: 'none', securityPoolAddress: selectedPoolAddress })
		await renderPoolAt(
			selectedPoolAddress,
			{ questionOutcome: 'none' },
			{
				forkAuction: createForkAuctionProps({ forkAuctionDetails: createForkAuctionDetails({ questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress }) }),
				selectedPoolView: 'trading',
				trading: createTradingProps({ selectedPool }),
			},
		)

		expectTransactionButtonDisabled(document.body, 'Mint complete sets')
	})

	test('allows selecting a vault from the directory within the current pool', async () => {
		const formChanges: Array<{ selectedVaultOwner?: string }> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
		await renderPoolAt(
			selectedPoolAddress,
			{ vaultCount: 1n, vaults: [createSecurityPoolVaultSummary({ vaultAddress })] },
			{
				securityVault: createSecurityVaultProps({
					onLoadSecurityVault: nextVaultAddress => {
						loadSecurityVaultCalls.push(nextVaultAddress)
					},
					onSecurityVaultFormChange: update => {
						formChanges.push(update)
					},
					securityVaultForm: createSecurityVaultForm({ securityPoolAddress: selectedPoolAddress }),
				}),
				selectedPoolView: 'vaults',
			},
		)

		await openAllVaults()
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Select vault' }))
		})

		expect(formChanges).toContainEqual({ selectedVaultOwner: vaultAddress })
		expect(loadSecurityVaultCalls).toContain(vaultAddress)
	})
})
