import { createPreparedOperationFixture } from './workflow/preparedOperationFixture.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types="bun-types" />

import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within, waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument as renderWithoutTimestamp } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createWalletActions, expectWalletFixDescribesAction } from '@zoltar/ui-core-shared/tests/testUtils/walletActions.js'
import { WalletActionsProvider } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { expectTransactionButtonDisabled, getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import type { LiquidationApprovalDetails, ListedSecurityPool, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { ChainTimestampContext } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { LiquidationModal } from '@zoltar/ui-statoblast-shared/features/security-pools/components/LiquidationModal.js'
import { isVaultHealthyAtFactor, simulateLiquidation } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/liquidation.js'
import { evaluateSecurityPoolState } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolState.js'
import { deriveHasForkActivity } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/forkAuction.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { createOracleManagerDetails } from './workflow/builders.js'

const ATTO_ETH_PER_ETH = 10n ** 18n

function renderIntoDocument(component: Parameters<typeof renderWithoutTimestamp>[0]) {
	return renderWithoutTimestamp(<ChainTimestampContext.Provider value={1n}>{component}</ChainTimestampContext.Provider>)
}

function createTargetVaultSummary(overrides: Partial<SecurityPoolVaultSummary> = {}): SecurityPoolVaultSummary {
	const underwritingLimitAttoEth = overrides.underwritingLimitAttoEth ?? 2n * 10n ** 18n
	return {
		badDebtAttoEth: 0n,
		disputeStakedAttoRep: 0n,
		vaultAttoRepBacking: 5n * 10n ** 18n,
		underwritingLimitAttoEth,
		openInterestAttoEth: underwritingLimitAttoEth,
		claimableFeesAttoEth: 0n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const selectedPool: ListedSecurityPool = {
		settlementCollateralAttoEth: 4n * 10n ** 18n,
		currentRetentionRate: 10n,
		totalUnderwritingLimitAttoEth: 4n * 10n ** 18n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
		lastOraclePrice: 3n * 10n ** 18n,
		lastOracleSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 0n,
		minimumVaultRepDepositAttoRep: 10n * 10n ** 18n,
		hasForkContinuationEscalationGame: false,
		ordinaryEscalationGameStarted: false,
		parent: zeroAddress,
		questionOutcome: 'none',
		questionId: '0x01',
		statoblastSecurityMultiplierBps: 20_000n,
		securityPoolAddress: zeroAddress,
		shareTokenSupplyAttoShares: 0n,
		systemState: 'operational',
		totalPoolHeldAttoRep: 5n * 10n ** 18n,
		feeEligibleUnderwritingLimitAttoEth: 2n * 10n ** 18n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		vaultCount: 1n,
		vaults: [createTargetVaultSummary()],
		...overrides,
	}
	return {
		...selectedPool,
		hasForkActivity: overrides.hasForkActivity ?? deriveHasForkActivity(selectedPool),
	}
}

function createEndedPoolState() {
	return evaluateSecurityPoolState({
		lifecycleState: 'ended',
		universeHasForked: false,
	})
}

describe('LiquidationModal', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	const defaultCallerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
	const defaultTargetVaultAddress = getAddress('0x00000000000000000000000000000000000000a1')

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	function createLiquidationModalProps(overrides: Partial<Parameters<typeof LiquidationModal>[0]> = {}): Parameters<typeof LiquidationModal>[0] {
		const { onQueueLiquidation = () => undefined, ...otherOverrides } = overrides
		return {
			accountAddress: defaultCallerVaultAddress,
			closeLiquidationModal: () => undefined,
			currentPoolOracleManagerDetails: undefined,
			isOnActiveAppChain: true,
			liquidationDebtEthAmount: '1',
			liquidationManagerAddress: zeroAddress,
			liquidationFundingPreview: undefined,
			liquidationFundingPreviewError: undefined,
			liquidationModalOpen: true,
			liquidationSecurityPoolAddress: zeroAddress,
			liquidationTargetVault: defaultTargetVaultAddress,
			liquidationTimeoutMinutes: '5',
			loadingPoolOracleManager: false,
			loadingLiquidationFundingPreview: false,
			onLoadLiquidationFundingPreview: () => undefined,
			onLoadPoolOracleManager: () => undefined,
			onLiquidationAmountChange: () => undefined,
			onLiquidationTimeoutMinutesChange: () => undefined,
			onQueueLiquidation: createPreparedOperationFixture('Queue liquidation', onQueueLiquidation),
			onSelectedPoolViewChange: () => undefined,
			poolOracleManagerError: undefined,
			repPerEthPrice: 1n * 10n ** 18n,
			repPerEthSource: 'mock',
			repPerEthSourceUrl: undefined,
			selectedPool: createSelectedPool(),
			securityPoolOverviewActiveAction: undefined,
			securityPoolLiquidationError: undefined,
			securityPoolOverviewResult: undefined,
			callerVaultSummary: createTargetVaultSummary({ vaultAddress: defaultCallerVaultAddress }),
			targetVaultSummary: createTargetVaultSummary({ vaultAddress: defaultTargetVaultAddress }),
			...otherOverrides,
		}
	}

	function renderLiquidationModal(overrides: Partial<Parameters<typeof LiquidationModal>[0]> = {}) {
		return renderIntoDocument(<LiquidationModal {...createLiquidationModalProps(overrides)} />)
	}

	function renderLiquidationModalAt(currentTimestamp: bigint, overrides: Partial<Parameters<typeof LiquidationModal>[0]> = {}) {
		return renderIntoDocument(
			<ChainTimestampContext.Provider value={currentTimestamp}>
				<LiquidationModal {...createLiquidationModalProps(overrides)} />
			</ChainTimestampContext.Provider>,
		)
	}

	function createLiquidationApprovalDetails(receiverVault: `0x${string}`, paramsOverrides: Partial<LiquidationApprovalDetails['params']> = {}, detailsOverrides: Partial<Omit<LiquidationApprovalDetails, 'params'>> = {}): LiquidationApprovalDetails {
		return {
			registryAddress: zeroAddress,
			params: {
				securityPool: zeroAddress,
				receiverVault,
				operator: defaultCallerVaultAddress,
				targetVault: defaultTargetVaultAddress,
				maxCumulativeDebtAttoEth: 10n * ATTO_ETH_PER_ETH,
				maxDebtPerLiquidationAttoEth: 3n * ATTO_ETH_PER_ETH,
				minPostLiquidationHealthFactorBps: 12_500n,
				validAfter: 0n,
				validUntil: 2_000_000_000n,
				nonce: 7n,
				...paramsOverrides,
			},
			availableDebtAttoEth: 6n * ATTO_ETH_PER_ETH,
			reservedDebtAttoEth: 3n * ATTO_ETH_PER_ETH,
			consumedDebtAttoEth: 1n * ATTO_ETH_PER_ETH,
			minimumValidNonce: 0n,
			revoked: false,
			...detailsOverrides,
		}
	}

	test('renders target and receiver commitments in ETH separately from REP backing', async () => {
		const renderedComponent = await renderLiquidationModal()
		cleanupRenderedComponent = renderedComponent.cleanup
		const metrics = Array.from(renderedComponent.container.querySelectorAll('.metric-label'))
		for (const prefix of ['Target', 'Receiver']) {
			const label = metrics.find(element => element.textContent?.startsWith(prefix) && /underwriting commitments|commitment/i.test(element.textContent))
			expect(label?.parentElement?.querySelector('.metric-field-value')?.textContent).toMatch(/ETH/)
		}
	})

	test.each([
		['execute', true, 'Execute vault liquidation'],
		['queued', false, 'Queue liquidation'],
	] as const)('disables %s liquidation when the selected pool has ended', async (_mode, isPriceValid, actionLabel) => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid }),
			poolState: createEndedPoolState(),
			selectedPool: createSelectedPool({ questionOutcome: 'yes' }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, actionLabel, 'Liquidation is unavailable because this pool has ended.')
	})

	test('defaults queued liquidation timeout copy to 5 minutes', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('Expires 5m after oracle settlement.')).toBe(true)
	})

	test('manual initial pricing reloads liquidation funding after an automatic quote failure', async () => {
		const loadFunding = mock(() => undefined)
		cleanupRenderedComponent = (
			await renderLiquidationModal({
				currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
				liquidationFundingPreviewError: 'Automatic pricing unavailable',
				onLoadLiquidationFundingPreview: loadFunding,
			})
		).cleanup
		const page = within(document.body)
		expect(loadFunding).not.toHaveBeenCalled()
		fireEvent.input(page.getByLabelText('OpenOracle REP per ETH starting price'), { target: { value: '3' } })
		expect(loadFunding).toHaveBeenCalledWith(zeroAddress, 3n * ATTO_ETH_PER_ETH)
		fireEvent.input(page.getByLabelText('OpenOracle REP per ETH starting price'), { target: { value: '' } })
		expect(loadFunding).toHaveBeenCalledTimes(1)
	})

	test('submits the chosen manual liquidation price', async () => {
		const submit = mock(() => undefined)
		cleanupRenderedComponent = (
			await renderLiquidationModal({
				currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
				onQueueLiquidation: submit,
				liquidationFundingPreview: { currentRepBalanceAttoRep: 100n * ATTO_ETH_PER_ETH, currentWethBalanceAttoEth: 1n, initialReportRepRequiredAttoRep: 1n, initialReportWethRequiredAttoEth: 1n, queueOperationValueAttoEth: 1n, totalWalletEthRequiredAttoEth: 1n, wethShortfallAttoEth: 0n },
				walletBalanceAttoEth: ATTO_ETH_PER_ETH,
			})
		).cleanup
		const page = within(document.body)
		expectTransactionButtonDisabled(document.body, 'Queue liquidation')
		fireEvent.input(page.getByLabelText('OpenOracle REP per ETH starting price'), { target: { value: '3' } })
		await waitFor(() => expect(page.getByRole('button', { name: 'Queue liquidation' }).hasAttribute('disabled')).toBe(false))
		fireEvent.click(page.getByRole('button', { name: 'Queue liquidation' }))
		await waitFor(() => expect(submit).toHaveBeenCalledWith(zeroAddress, zeroAddress, 3n * ATTO_ETH_PER_ETH))
	})

	test('keeps queued liquidation inputs without a funding review panel', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
			liquidationFundingPreview: {
				currentRepBalanceAttoRep: 25n * ATTO_ETH_PER_ETH,
				currentWethBalanceAttoEth: 1n * ATTO_ETH_PER_ETH,
				initialReportRepRequiredAttoRep: 10n * ATTO_ETH_PER_ETH,
				initialReportWethRequiredAttoEth: 2n * ATTO_ETH_PER_ETH,
				queueOperationValueAttoEth: (12n * ATTO_ETH_PER_ETH) / 10n,
				totalWalletEthRequiredAttoEth: (22n * ATTO_ETH_PER_ETH) / 10n,
				wethShortfallAttoEth: 1n * ATTO_ETH_PER_ETH,
			},
			walletBalanceAttoEth: 5n * ATTO_ETH_PER_ETH,
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		fireEvent.input(within(document.body).getByRole('textbox', { name: 'OpenOracle REP per ETH starting price' }), { target: { value: '3' } })

		expect(within(document.body).queryByRole('heading', { name: 'Transaction review' })).toBeNull()
		expect(within(document.body).getByRole('button', { name: 'Queue liquidation' })).not.toBeNull()
	})

	test('uses neutral missing-state copy after a queued liquidation succeeds without visible manager state', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
				pendingOperation: undefined,
			}),
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x03',
				securityPoolAddress: zeroAddress,
			} satisfies SecurityPoolOverviewActionResult,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Liquidation submitted' })).not.toBeNull()
		expect(documentQueries.getByText('The transaction succeeded, but the latest manager state is not available.')).not.toBeNull()
		expect(documentQueries.queryByText('Refresh staged operations to confirm the latest manager state.')).toBeNull()
	})

	test('requires a queued liquidation timeout of 1–5 minutes', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
			}),
			liquidationTimeoutMinutes: '0',
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		fireEvent.input(within(document.body).getByRole('textbox', { name: 'OpenOracle REP per ETH starting price' }), { target: { value: '3' } })

		expectTransactionButtonDisabled(document.body, 'Queue liquidation', 'Enter a liquidation timeout of 1–5 minutes.')
	})

	test('keeps liquidation disabled off Sepolia and explains recovery', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
			}),
			isOnActiveAppChain: false,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionButtonState(document.body, 'Execute vault liquidation')).toEqual({ disabled: true, reason: 'Switch to Sepolia.' })
		expect(document.body.textContent?.includes('Switch to Sepolia.')).toBe(true)
	})

	for (const [overrides, fixLabel] of [
		[{ accountAddress: undefined }, 'Connect wallet'],
		[{ isOnActiveAppChain: false }, 'Switch to Sepolia'],
	] as const)
		test(`offers the ${fixLabel} fix on the liquidation the wallet blocks`, async () => {
			const { calls, walletActions } = createWalletActions()
			const renderedComponent = await renderIntoDocument(
				<WalletActionsProvider walletActions={walletActions}>
					<LiquidationModal {...createLiquidationModalProps({ currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true }), ...overrides })} />
				</WalletActionsProvider>,
			)
			cleanupRenderedComponent = renderedComponent.cleanup
			await act(() => fireEvent.click(expectWalletFixDescribesAction(document.body, 'Execute vault liquidation', fixLabel)))
			expect(calls).toEqual([fixLabel === 'Connect wallet' ? 'connect' : 'switch'])
		})

	for (const [overrides, fixLabel] of [
		[{ accountAddress: undefined }, 'Connect wallet'],
		[{ isOnActiveAppChain: false }, 'Switch to Sepolia'],
	] as const)
		test(`keeps the ${fixLabel} fix ahead of a missing manual initial price`, async () => {
			const { walletActions } = createWalletActions()
			const renderedComponent = await renderIntoDocument(
				<WalletActionsProvider walletActions={walletActions}>
					<LiquidationModal {...createLiquidationModalProps({ currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }), ...overrides })} />
				</WalletActionsProvider>,
			)
			cleanupRenderedComponent = renderedComponent.cleanup
			expectWalletFixDescribesAction(document.body, 'Queue liquidation', fixLabel)
		})

	test('traps focus while open and restores it when closed', async () => {
		let open = true
		const opener = document.createElement('button')
		opener.textContent = 'Open modal'
		document.body.appendChild(opener)
		opener.focus()

		const renderModal = async () =>
			await renderLiquidationModal({
				closeLiquidationModal: () => {
					open = false
				},
				currentPoolOracleManagerDetails: undefined,
				liquidationModalOpen: open,
				selectedPool: createSelectedPool({ lastOraclePrice: undefined, lastOracleSettlementTimestamp: 0n }),
				targetVaultSummary: createTargetVaultSummary(),
			})

		let renderedComponent = await renderModal()
		cleanupRenderedComponent = renderedComponent.cleanup

		const dialog = within(document.body).getByRole('dialog', { name: 'Liquidate vault' })
		const closeButton = within(dialog).getByRole('button', { name: 'Close' })
		const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"))
		const firstFocusableAfterClose = focusableElements[1]
		const lastFocusableElement = focusableElements[focusableElements.length - 1]
		if (firstFocusableAfterClose === undefined || lastFocusableElement === undefined) throw new Error('Expected multiple focusable modal controls')
		expect(document.activeElement === closeButton).toBe(true)

		await act(() => {
			fireEvent.keyDown(document, { key: 'Tab' })
		})
		expect(document.activeElement === firstFocusableAfterClose).toBe(true)

		lastFocusableElement.focus()
		await act(() => {
			fireEvent.keyDown(document, { key: 'Tab' })
		})
		expect(document.activeElement === closeButton).toBe(true)

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})

		await renderedComponent.cleanup()
		renderedComponent = await renderModal()
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(document.body.querySelector("[role='dialog']")).toBeNull()
		expect(document.activeElement).toBe(opener)
		opener.remove()
	})

	test('keeps the liquidation form open on a backdrop click while the close button still closes it', async () => {
		let closeCount = 0
		const renderedComponent = await renderLiquidationModal({
			closeLiquidationModal: () => {
				closeCount += 1
			},
			currentPoolOracleManagerDetails: undefined,
			liquidationModalOpen: true,
			selectedPool: createSelectedPool({ lastOraclePrice: undefined, lastOracleSettlementTimestamp: 0n }),
			targetVaultSummary: createTargetVaultSummary(),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const dialog = within(document.body).getByRole('dialog', { name: 'Liquidate vault' })
		expect(dialog.querySelector('input')).not.toBeNull()
		const backdrop = dialog.closest('.modal-backdrop')
		if (!(backdrop instanceof HTMLElement)) throw new Error('Expected the liquidation modal backdrop')
		await act(() => {
			fireEvent.click(backdrop)
		})
		// A stray click outside must not discard the entered liquidation amounts.
		expect(closeCount).toBe(0)

		await act(() => {
			fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
		})
		expect(closeCount).toBe(1)
	})

	test('hides sibling page content while open and restores it after close', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(
				<>
					<section aria-hidden='false' data-testid='page-content'>
						<h2>Page content</h2>
						<button type='button'>Background Action</button>
					</section>
					<LiquidationModal {...createLiquidationModalProps()} />
				</>,
				container,
			)
		})

		const pageContent = container.querySelector('[data-testid="page-content"]')
		if (!(pageContent instanceof HTMLElement)) throw new Error('Expected page content')
		expect(pageContent.getAttribute('aria-hidden')).toBe('true')
		expect(pageContent.hasAttribute('inert')).toBe(true)
		expect(within(container).getByRole('dialog', { name: 'Liquidate vault' })).not.toBeNull()

		await act(() => {
			render(
				<>
					<section aria-hidden='false' data-testid='page-content'>
						<h2>Page content</h2>
						<button type='button'>Background Action</button>
					</section>
					<LiquidationModal {...createLiquidationModalProps({ liquidationModalOpen: false })} />
				</>,
				container,
			)
		})

		const restoredPageContent = container.querySelector('[data-testid="page-content"]')
		if (!(restoredPageContent instanceof HTMLElement)) throw new Error('Expected restored page content')
		expect(restoredPageContent.getAttribute('aria-hidden')).toBe('false')
		expect(restoredPageContent.hasAttribute('inert')).toBe(false)

		render(null, container)
		container.remove()
	})

	test('lets only the top stacked liquidation modal handle Escape', async () => {
		function StackedLiquidationModalHarness() {
			const [executeOpen, setExecuteOpen] = useState(true)
			const [queueOpen, setQueueOpen] = useState(true)

			return (
				<>
					{executeOpen ? (
						<LiquidationModal
							{...createLiquidationModalProps({
								closeLiquidationModal: () => setExecuteOpen(false),
								currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true }),
							})}
						/>
					) : undefined}
					{queueOpen ? (
						<LiquidationModal
							{...createLiquidationModalProps({
								closeLiquidationModal: () => setQueueOpen(false),
								currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
							})}
						/>
					) : undefined}
				</>
			)
		}

		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<StackedLiquidationModalHarness />, container)
		})

		expect(within(container).getByRole('dialog', { name: 'Execute vault liquidation' })).not.toBeNull()
		expect(within(container).getByRole('dialog', { name: 'Queue vault liquidation' })).not.toBeNull()
		const stackedBackdrops = container.querySelectorAll('.modal-backdrop')
		const executeBackdrop = stackedBackdrops[0]
		if (!(executeBackdrop instanceof HTMLElement)) throw new Error('Expected execute modal backdrop')
		expect(executeBackdrop.getAttribute('aria-hidden')).toBe('true')
		expect(executeBackdrop.hasAttribute('inert')).toBe(true)

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})

		expect(within(container).getByRole('dialog', { name: 'Execute vault liquidation' })).not.toBeNull()
		expect(within(container).queryByRole('dialog', { name: 'Queue vault liquidation' })).toBeNull()
		const restoredExecuteBackdrop = container.querySelector('.modal-backdrop')
		if (!(restoredExecuteBackdrop instanceof HTMLElement)) throw new Error('Expected restored execute modal backdrop')
		expect(restoredExecuteBackdrop.getAttribute('aria-hidden')).toBe(null)
		expect(restoredExecuteBackdrop.hasAttribute('inert')).toBe(false)

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})
		expect(within(container).queryByRole('dialog', { name: 'Execute vault liquidation' })).toBeNull()

		render(null, container)
		container.remove()
	})

	test('cycles Tab through the top stacked liquidation modal controls', async () => {
		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(
				<>
					<LiquidationModal
						{...createLiquidationModalProps({
							currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true }),
						})}
					/>
					<LiquidationModal
						{...createLiquidationModalProps({
							currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
						})}
					/>
				</>,
				container,
			)
		})

		const executeDialog = within(container).getByRole('dialog', { name: 'Execute vault liquidation' })
		const queueDialog = within(container).getByRole('dialog', { name: 'Queue vault liquidation' })
		const executeCloseButton = within(executeDialog).getByRole('button', { name: 'Close' })
		const queueCloseButton = within(queueDialog).getByRole('button', { name: 'Close' })
		const queueFocusableElements = Array.from(queueDialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"))
		const firstQueueFocusableAfterClose = queueFocusableElements[1]
		if (firstQueueFocusableAfterClose === undefined) throw new Error('Expected multiple queue modal controls')

		expect(document.activeElement === queueCloseButton).toBe(true)

		await act(() => {
			fireEvent.keyDown(document, { key: 'Tab' })
		})

		expect(document.activeElement === firstQueueFocusableAfterClose).toBe(true)
		expect(document.activeElement === executeCloseButton).toBe(false)

		render(null, container)
		container.remove()
	})

	test('keeps focus on the edited input while the modal rerenders', async () => {
		function LiquidationHarness() {
			const [liquidationDebtEthAmount, setLiquidationAmount] = useState('1')

			return (
				<LiquidationModal
					accountAddress={zeroAddress}
					closeLiquidationModal={() => undefined}
					currentPoolOracleManagerDetails={undefined}
					isOnActiveAppChain
					liquidationDebtEthAmount={liquidationDebtEthAmount}
					liquidationManagerAddress={zeroAddress}
					liquidationModalOpen
					liquidationSecurityPoolAddress={zeroAddress}
					liquidationTimeoutMinutes='5'
					loadingPoolOracleManager={false}
					liquidationTargetVault={zeroAddress}
					onLoadPoolOracleManager={() => undefined}
					onLiquidationAmountChange={setLiquidationAmount}
					onLiquidationTimeoutMinutesChange={() => undefined}
					onQueueLiquidation={() => undefined}
					onSelectedPoolViewChange={() => undefined}
					repPerEthPrice={1n * 10n ** 18n}
					repPerEthSource='mock'
					repPerEthSourceUrl={undefined}
					selectedPool={createSelectedPool()}
					securityPoolOverviewActiveAction={undefined}
					securityPoolLiquidationError={undefined}
					securityPoolOverviewResult={undefined}
					callerVaultSummary={createTargetVaultSummary({ vaultAddress: getAddress('0x0000000000000000000000000000000000000001') })}
					targetVaultSummary={createTargetVaultSummary()}
				/>
			)
		}

		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<LiquidationHarness />, container)
		})

		const amountInput = container.querySelector("input[placeholder='0.0']") as HTMLInputElement
		amountInput.focus()
		expect(document.activeElement).toBe(amountInput)

		await act(() => {
			fireEvent.input(amountInput, { target: { value: '12' } })
		})

		const rerenderedAmountInput = container.querySelector("input[placeholder='0.0']") as HTMLInputElement
		expect(rerenderedAmountInput.value).toBe('12')
		expect(document.activeElement).toBe(rerenderedAmountInput)

		render(null, container)
		container.remove()
	})

	test('shows self-receiving queued liquidation requested debt without implying an approval reservation', async () => {
		const selectedViews: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				pendingOperation: {
					amount: 5n * 10n ** 18n,
					operator: zeroAddress,
					operation: 'liquidation',
					operationId: 9n,
					targetVault: zeroAddress,
				},
				pendingOperationSlotId: 9n,
			}),
			liquidationDebtEthAmount: '5',
			liquidationTargetVault: zeroAddress,
			onSelectedPoolViewChange: view => {
				selectedViews.push(view ?? '')
			},
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000aa',
				securityPoolAddress: zeroAddress,
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Liquidation queued' })).not.toBeNull()
		expect(documentQueries.getByText('#9')).not.toBeNull()
		expect(documentQueries.getByText('Commitment to transfer')).not.toBeNull()
		expect(documentQueries.getByText('5 ETH')).not.toBeNull()
		expect(documentQueries.queryByText('Reserved approval')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Liquidation queued' }).closest('.liquidation-modal-actions')).toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'View in staged operations' }))
		})

		expect(selectedViews).toEqual(['staged-operations'])
	})

	test('distinguishes delegated requested debt from the smaller cumulative approval reservation', async () => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const renderedComponent = await renderLiquidationModalAt(1_900_000_000n, {
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				pendingOperation: {
					amount: 5n * ATTO_ETH_PER_ETH,
					operator: defaultCallerVaultAddress,
					operation: 'liquidation',
					operationId: 10n,
					targetVault: defaultTargetVaultAddress,
				},
				pendingOperationSlotId: 10n,
			}),
			liquidationDebtEthAmount: '5',
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId: `0x${'21'.repeat(32)}`,
			liquidationApprovalDetails: createLiquidationApprovalDetails(receiverVault, {}, { reservedDebtAttoEth: 3n * ATTO_ETH_PER_ETH }),
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ab',
				securityPoolAddress: zeroAddress,
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Commitment to transfer')).not.toBeNull()
		expect(documentQueries.getByText('5 ETH')).not.toBeNull()
		const reservedApprovalLabel = documentQueries.getByText('Reserved approval')
		expect(reservedApprovalLabel.parentElement?.textContent).toContain('3.00 ETH')
	})

	test('shows manual execution guidance for overflow queued liquidations', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
				pendingOperation: {
					amount: 5n,
					operator: zeroAddress,
					operation: 'withdrawRep',
					operationId: 8n,
					targetVault: '0x0000000000000000000000000000000000000001',
				},
				pendingOperationSlotId: 8n,
			}),
			liquidationDebtEthAmount: '5',
			liquidationTargetVault: zeroAddress,
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ac',
				queuedOperation: {
					isPendingSlot: false,
					operation: 'liquidation',
					operationId: 10n,
				},
				securityPoolAddress: zeroAddress,
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Liquidation queued' })).not.toBeNull()
		expect(documentQueries.getByText('#10')).not.toBeNull()
		expect(documentQueries.getByText('The settlement auto-execute list is full. Execute this staged operation manually with its ID after a valid oracle price is available.')).not.toBeNull()
	})

	test('shows immediate execution when liquidation uses an already valid oracle price', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				pendingOperation: undefined,
				pendingOperationSlotId: 0n,
			}),
			liquidationDebtEthAmount: '5',
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000aa',
				securityPoolAddress: zeroAddress,
				stagedExecution: {
					errorMessage: undefined,
					operation: 'liquidation',
					operationId: 3n,
					success: true,
				},
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Liquidation executed' })).not.toBeNull()
		expect(documentQueries.getByText('A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Execute vault liquidation' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Queue vault liquidation' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'View in staged operations' })).toBeNull()
	})

	test('executes liquidation when the current oracle price is valid', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				pendingOperation: undefined,
				pendingOperationSlotId: 0n,
			}),
			liquidationDebtEthAmount: '5',
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Execute vault liquidation' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Execute vault liquidation' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Queue vault liquidation' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Queue liquidation' })).toBeNull()
	})

	test('disables queued liquidation when the wallet lacks the buffered oracle bounty ETH', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
				requestPriceCostAttoEth: 10n * ATTO_ETH_PER_ETH,
			}),
			liquidationFundingPreview: {
				currentRepBalanceAttoRep: 0n,
				currentWethBalanceAttoEth: 0n,
				initialReportRepRequiredAttoRep: 0n,
				initialReportWethRequiredAttoEth: 0n,
				queueOperationValueAttoEth: 12n * ATTO_ETH_PER_ETH,
				totalWalletEthRequiredAttoEth: 12n * ATTO_ETH_PER_ETH,
				wethShortfallAttoEth: 0n,
			},
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 100n * 10n ** 18n,
			}),
			walletBalanceAttoEth: 5n * ATTO_ETH_PER_ETH,
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		fireEvent.input(within(document.body).getByRole('textbox', { name: 'OpenOracle REP per ETH starting price' }), { target: { value: '3' } })

		expectTransactionButtonDisabled(document.body, 'Queue liquidation', 'Need 7\u00a0more\u00a0ETH in this wallet to queue liquidation.')
		expect(within(document.body).getByText('Need 7\u00a0more\u00a0ETH in this wallet to queue liquidation.')).not.toBeNull()
	})

	test('allows queued liquidation when the entered amount exceeds the executable cap because execution will clamp it', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
			}),
			liquidationFundingPreview: {
				currentRepBalanceAttoRep: 0n,
				currentWethBalanceAttoEth: 0n,
				initialReportRepRequiredAttoRep: 0n,
				initialReportWethRequiredAttoEth: 0n,
				queueOperationValueAttoEth: 1n,
				totalWalletEthRequiredAttoEth: 1n,
				wethShortfallAttoEth: 0n,
			},
			liquidationDebtEthAmount: '100',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 2_000n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 100n * 10n ** 18n,
			}),
			walletBalanceAttoEth: 100n * ATTO_ETH_PER_ETH,
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		fireEvent.input(within(document.body).getByRole('textbox', { name: 'OpenOracle REP per ETH starting price' }), { target: { value: '3' } })

		await waitFor(() => expect(within(document.body).getByRole('button', { name: 'Queue liquidation' }).hasAttribute('disabled')).toBe(false))
	})

	test('Max estimates the transferable commitment from the pool price while the liquidation queues', async () => {
		const amountChanges: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
				lastPrice: 10n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '1',
			onLiquidationAmountChange: value => {
				amountChanges.push(value)
			},
			selectedPool: createSelectedPool({
				lastOraclePrice: 10n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 100n * 10n ** 18n,
				vaultAddress: defaultTargetVaultAddress,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			const maxButton = document.body.querySelector('.field-inline-action')
			if (!(maxButton instanceof HTMLElement)) throw new Error('Expected liquidation Max button')
			fireEvent.click(maxButton)
		})

		expect(amountChanges).toEqual(['100'])
	})

	test('shows liquidation failure details when the staged execution event reports a rejection', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				pendingOperation: undefined,
				pendingOperationSlotId: 0n,
			}),
			liquidationDebtEthAmount: '5',
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ab',
				securityPoolAddress: zeroAddress,
				stagedExecution: {
					errorMessage: 'Local Underwriting commitments broken',
					operation: 'liquidation',
					operationId: 4n,
					success: false,
				},
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Liquidation failed' })).not.toBeNull()
		expect(documentQueries.getByText('Local Underwriting commitments broken')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'View in staged operations' })).toBeNull()
	})

	test('maps compact liquidation revert reasons back to explicit operator-facing copy', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				pendingOperation: undefined,
				pendingOperationSlotId: 0n,
			}),
			liquidationDebtEthAmount: '5',
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ac',
				securityPoolAddress: zeroAddress,
				stagedExecution: {
					errorMessage: 'Target commitment',
					operation: 'liquidation',
					operationId: 5n,
					success: false,
				},
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('The target vault would fall below the minimum commitment after liquidation.')).not.toBeNull()

		renderedComponent.cleanup()
		cleanupRenderedComponent = undefined

		const receiverDebtRenderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				pendingOperation: undefined,
				pendingOperationSlotId: 0n,
			}),
			liquidationDebtEthAmount: '5',
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ad',
				securityPoolAddress: zeroAddress,
				stagedExecution: {
					errorMessage: 'Receiver commitment below minimum',
					operation: 'liquidation',
					operationId: 6n,
					success: false,
				},
			},
		})
		cleanupRenderedComponent = receiverDebtRenderedComponent.cleanup

		expect(within(document.body).getByText('The receiver vault would remain below the minimum commitment after liquidation.')).not.toBeNull()
	})

	test('keeps the open dialog showing execution results after submit until it is closed', async () => {
		function LiquidationExecutionHarness() {
			const [liquidationModalOpen, setLiquidationModalOpen] = useState(true)
			const [securityPoolOverviewResult, setSecurityPoolOverviewResult] = useState<SecurityPoolOverviewActionResult | undefined>(undefined)

			return (
				<LiquidationModal
					accountAddress={defaultCallerVaultAddress}
					closeLiquidationModal={() => {
						setLiquidationModalOpen(false)
						setSecurityPoolOverviewResult(undefined)
					}}
					currentPoolOracleManagerDetails={createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 1n * 10n ** 18n,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
					})}
					isOnActiveAppChain
					liquidationDebtEthAmount='1'
					liquidationManagerAddress={zeroAddress}
					liquidationModalOpen={liquidationModalOpen}
					liquidationSecurityPoolAddress={zeroAddress}
					liquidationTargetVault={defaultTargetVaultAddress}
					liquidationTimeoutMinutes='5'
					loadingPoolOracleManager={false}
					onLoadPoolOracleManager={() => undefined}
					onLiquidationAmountChange={() => undefined}
					onLiquidationTimeoutMinutesChange={() => undefined}
					onQueueLiquidation={() => {
						setSecurityPoolOverviewResult({
							action: 'queueLiquidation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000cd',
							securityPoolAddress: zeroAddress,
							stagedExecution: {
								errorMessage: undefined,
								operation: 'liquidation',
								operationId: 10n,
								success: true,
							},
						})
					}}
					onSelectedPoolViewChange={() => undefined}
					repPerEthPrice={1n * 10n ** 18n}
					repPerEthSource='mock'
					repPerEthSourceUrl={undefined}
					selectedPool={createSelectedPool({
						statoblastSecurityMultiplierBps: 20_000n,
					})}
					securityPoolOverviewActiveAction={undefined}
					securityPoolLiquidationError={undefined}
					securityPoolOverviewResult={securityPoolOverviewResult}
					callerVaultSummary={createTargetVaultSummary({
						vaultAttoRepBacking: 20n * 10n ** 18n,
						underwritingLimitAttoEth: 1n * 10n ** 18n,
						vaultAddress: defaultCallerVaultAddress,
					})}
					targetVaultSummary={createTargetVaultSummary({
						vaultAttoRepBacking: 12n * 10n ** 18n,
						underwritingLimitAttoEth: 11n * 10n ** 18n,
						vaultAddress: defaultTargetVaultAddress,
					})}
				/>
			)
		}

		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<LiquidationExecutionHarness />
				</ChainTimestampContext.Provider>,
				container,
			)
		})

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Execute vault liquidation' }))
		})

		expect(documentQueries.getByRole('dialog', { name: 'Execute vault liquidation' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Liquidation executed' })).not.toBeNull()
		expect(documentQueries.getByText('A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.')).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Close' }))
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Execute vault liquidation' })).toBeNull()

		render(null, container)
		container.remove()
	})

	test('keeps the open dialog showing liquidation errors after submit', async () => {
		function LiquidationErrorHarness() {
			const [liquidationModalOpen, setLiquidationModalOpen] = useState(true)
			const [securityPoolLiquidationError, setSecurityPoolLiquidationError] = useState<string | undefined>(undefined)

			return (
				<LiquidationModal
					accountAddress={defaultCallerVaultAddress}
					closeLiquidationModal={() => {
						setLiquidationModalOpen(false)
						setSecurityPoolLiquidationError(undefined)
					}}
					currentPoolOracleManagerDetails={createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 1n * 10n ** 18n,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
					})}
					isOnActiveAppChain
					liquidationDebtEthAmount='1'
					liquidationManagerAddress={zeroAddress}
					liquidationModalOpen={liquidationModalOpen}
					liquidationSecurityPoolAddress={zeroAddress}
					liquidationTargetVault={defaultTargetVaultAddress}
					liquidationTimeoutMinutes='5'
					loadingPoolOracleManager={false}
					onLoadPoolOracleManager={() => undefined}
					onLiquidationAmountChange={() => undefined}
					onLiquidationTimeoutMinutesChange={() => undefined}
					onQueueLiquidation={() => {
						setSecurityPoolLiquidationError('Liquidation execution reverted')
					}}
					onSelectedPoolViewChange={() => undefined}
					repPerEthPrice={1n * 10n ** 18n}
					repPerEthSource='mock'
					repPerEthSourceUrl={undefined}
					selectedPool={createSelectedPool()}
					securityPoolOverviewActiveAction={undefined}
					securityPoolLiquidationError={securityPoolLiquidationError}
					securityPoolOverviewResult={undefined}
					callerVaultSummary={createTargetVaultSummary({
						vaultAttoRepBacking: 20n * 10n ** 18n,
						underwritingLimitAttoEth: 1n * 10n ** 18n,
						vaultAddress: defaultCallerVaultAddress,
					})}
					targetVaultSummary={createTargetVaultSummary({
						vaultAttoRepBacking: 12n * 10n ** 18n,
						underwritingLimitAttoEth: 11n * 10n ** 18n,
						vaultAddress: defaultTargetVaultAddress,
					})}
				/>
			)
		}

		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<LiquidationErrorHarness />
				</ChainTimestampContext.Provider>,
				container,
			)
		})

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Execute vault liquidation' }))
		})

		expect(documentQueries.getByRole('dialog', { name: 'Execute vault liquidation' })).not.toBeNull()
		expect(documentQueries.getByText('Liquidation execution reverted')).not.toBeNull()

		render(null, container)
		container.remove()
	})

	test('fills the liquidation amount from the computed liquidation Max value', async () => {
		const amountChanges: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 3n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '1',
			onLiquidationAmountChange: value => {
				amountChanges.push(value)
			},
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 73n * 10n ** 18n,
				underwritingLimitAttoEth: 50n * 10n ** 18n,
				vaultAddress: defaultTargetVaultAddress,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			const maxButton = document.body.querySelector('.field-inline-action')
			if (!(maxButton instanceof HTMLElement)) throw new Error('Expected liquidation Max button')
			fireEvent.click(maxButton)
		})

		expect(amountChanges).toEqual(['50'])
	})

	test('uses the configured Uniswap price for Max when the OpenOracle is invalid', async () => {
		const amountChanges: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, lastPrice: 10n ** 18n }),
			onLiquidationAmountChange: value => amountChanges.push(value),
			repPerEthPrice: 3n * 10n ** 18n,
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 73n * 10n ** 18n,
				underwritingLimitAttoEth: 50n * 10n ** 18n,
				vaultAddress: defaultTargetVaultAddress,
			}),
			uiPriceOracle: 'uniswap',
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			const maxButton = document.body.querySelector('.field-inline-action')
			if (!(maxButton instanceof HTMLElement)) throw new Error('Expected liquidation Max button')
			fireEvent.click(maxButton)
		})

		expect(amountChanges).toEqual(['50'])
	})

	test('disables Max when the configured Uniswap price is unavailable', async () => {
		const renderedComponent = await renderLiquidationModal({
			repPerEthPrice: undefined,
			uiPriceOracle: 'uniswap',
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxButton = document.body.querySelector('.field-inline-action')
		if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected liquidation Max button')
		expect(maxButton.disabled).toBe(true)
	})

	test('fills the liquidation amount from the dust-safe liquidation Max value', async () => {
		const amountChanges: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 1000n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '1',
			onLiquidationAmountChange: value => {
				amountChanges.push(value)
			},
			selectedPool: createSelectedPool({
				lastOraclePrice: 1000n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 1000n * 10n ** 18n,
				underwritingLimitAttoEth: 14n * 10n ** 17n,
				vaultAddress: defaultTargetVaultAddress,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			const maxButton = document.body.querySelector('.field-inline-action')
			if (!(maxButton instanceof HTMLElement)) throw new Error('Expected liquidation Max button')
			fireEvent.click(maxButton)
		})

		expect(amountChanges).toEqual(['1.4'])
	})

	test('disables direct liquidation when the current OpenOracle price does not make the vault liquidatable', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 1n * 10n ** 18n,
			}),
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(true)
		expect(documentQueries.getByText('This vault is not undercollateralized at the current OpenOracle price.')).not.toBeNull()
		expect(documentQueries.getByText(/^OpenOracle price$/)).not.toBeNull()
	})

	test('shows the pending first OpenOracle price in liquidation context', async () => {
		const renderedComponent = await renderLiquidationModalAt(100n, {
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false, lastPrice: 0n, lastSettlementTimestamp: 0n, pendingReportId: 7n, pendingReportReadyAtTimestamp: 154n }),
			selectedPool: createSelectedPool({ lastOraclePrice: undefined, lastOracleSettlementTimestamp: 0n }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		const label = Array.from(document.querySelectorAll('.metric-label')).find(element => element.textContent === 'OpenOracle price')
		expect(label?.nextElementSibling?.textContent?.trim()).toBe('Available in 54s')
	})

	test('keeps protocol liquidation enabled when the configured UI price makes the target appear safe', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 500n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 100n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '2',
			repPerEthPrice: 1n * 10n ** 18n,
			selectedPool: createSelectedPool({ minimumSecurityBondDebtAttoEth: 0n, minimumVaultRepDepositAttoRep: 0n, statoblastSecurityMultiplierBps: 20_000n }),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
			}),
			uiPriceOracle: 'uniswap',
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionButtonState(document.body, 'Execute vault liquidation')).toEqual({ disabled: false, reason: undefined })
		// Max follows the protocol price the guard checks, so it stays available alongside the enabled action.
		const maxButton = document.body.querySelector('.field-inline-action')
		if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected liquidation Max button')
		expect(maxButton.disabled).toBe(false)
	})

	test('shows target-safe before post-liquidation REP floor warnings for a safe near-floor target vault', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 1n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '1',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 11n * 10n ** 18n,
				underwritingLimitAttoEth: 1n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(true)
		expect(documentQueries.getByText('This vault is not undercollateralized at the current OpenOracle price.')).not.toBeNull()
		expect(documentQueries.queryByText('The target vault would fall below the minimum REP backing after liquidation.')).toBeNull()
	})

	test('allows full-close liquidation when the target only holds the minimum REP deposit', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 61n * 10n ** 17n,
			}),
			liquidationDebtEthAmount: '1',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				underwritingLimitAttoEth: 1n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(false)
		expect(documentQueries.queryByText('No commitment is transferable at the current target-side bounds.')).toBeNull()
		expect(documentQueries.queryByText('The target vault would fall below the minimum REP backing after liquidation.')).toBeNull()
	})

	test('rejects a funded slice that would leave an empty receiver below minimum commitment', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '0.5',
			selectedPool: createSelectedPool({
				minimumSecurityBondDebtAttoEth: ATTO_ETH_PER_ETH,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 10n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(true)
		expect(documentQueries.getByText('The selected receiver would remain below the minimum commitment after liquidation.')).not.toBeNull()
		expect(documentQueries.queryByText('No commitment is transferable at the current target-side bounds.')).toBeNull()
		expect(documentQueries.queryByText('The target vault would fall below the minimum REP backing after liquidation.')).toBeNull()
	})

	test('does not offer a positive Max or REP transfer preview for a safe target vault', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 1n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '2',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxButton = document.body.querySelector('.field-inline-action')
		if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected liquidation Max button')
		expect(maxButton.disabled).toBe(true)

		expect(document.querySelector('.transaction-review')).toBeNull()
	})

	test('allows an atomic bonus-priced liquidation', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 1n * 10n ** 18n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 4n * 10n ** 17n,
			}),
			liquidationDebtEthAmount: '0.000000000000000001',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 130n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(false)
	})

	test('previews the exact post-backingUnits-conversion REP amount after a pool donation', () => {
		const totalPoolHeldRepBalanceAttoRep = 200n * ATTO_ETH_PER_ETH + 1n
		const totalRepBackingUnits = 200n * ATTO_ETH_PER_ETH * ATTO_ETH_PER_ETH
		const targetVaultSummary = createTargetVaultSummary({
			repBackingUnits: 100n * ATTO_ETH_PER_ETH * ATTO_ETH_PER_ETH,
			totalRepBackingUnits,
			vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH,
			underwritingLimitAttoEth: 100n * ATTO_ETH_PER_ETH,
			totalPoolHeldRepBalanceAttoRep,
		})
		const simulation = simulateLiquidation({
			minimumVaultRepDepositAttoRep: 10n * ATTO_ETH_PER_ETH,
			callerVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH }),
			requestedDebtAttoEth: 1n * ATTO_ETH_PER_ETH,
			totalUnderwritingLimitAttoEth: 102n * ATTO_ETH_PER_ETH,
			repPerEthPrice: 1n * ATTO_ETH_PER_ETH,
			settlementCollateralAttoEth: 102n * ATTO_ETH_PER_ETH,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})
		const quotedRep = (105n * ATTO_ETH_PER_ETH) / 100n
		const backingUnitsMoved = (quotedRep * totalRepBackingUnits + totalPoolHeldRepBalanceAttoRep - 1n) / totalPoolHeldRepBalanceAttoRep
		const exactRepMoved = (backingUnitsMoved * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits

		expect(exactRepMoved).toBe(quotedRep)
		expect(simulation.vaultAttoRepBackingToTransfer).toBe(exactRepMoved)
	})

	test('matches the contract partial reserve when the REP backing units rate is non-integral', () => {
		const totalPoolHeldRepBalanceAttoRep = 20n * ATTO_ETH_PER_ETH
		const repBackingUnits = 20n * ATTO_ETH_PER_ETH * ATTO_ETH_PER_ETH + 1n
		const totalRepBackingUnits = repBackingUnits
		const targetVaultSummary = createTargetVaultSummary({
			repBackingUnits,
			totalRepBackingUnits,
			vaultAttoRepBacking: 20n * ATTO_ETH_PER_ETH,
			underwritingLimitAttoEth: 20n * ATTO_ETH_PER_ETH,
			totalPoolHeldRepBalanceAttoRep,
		})
		const simulation = simulateLiquidation({
			callerVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH }),
			minimumVaultRepDepositAttoRep: 10n * ATTO_ETH_PER_ETH,
			requestedDebtAttoEth: 10n * ATTO_ETH_PER_ETH,
			totalUnderwritingLimitAttoEth: 22n * ATTO_ETH_PER_ETH,
			repPerEthPrice: ATTO_ETH_PER_ETH,
			settlementCollateralAttoEth: 22n * ATTO_ETH_PER_ETH,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})
		const reserveBackingUnits = (10n * ATTO_ETH_PER_ETH * totalRepBackingUnits + totalPoolHeldRepBalanceAttoRep - 1n) / totalPoolHeldRepBalanceAttoRep
		const awardableAttoRep = ((repBackingUnits - reserveBackingUnits) * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits

		expect(awardableAttoRep).toBe(10n * ATTO_ETH_PER_ETH - 1n)
		expect(simulation.debtMovedAttoEth).toBe(10n * ATTO_ETH_PER_ETH)
		expect(simulation.vaultAttoRepBackingToTransfer).toBe(awardableAttoRep)
		expect(simulation.targetAfter.vaultAttoRepBacking).toBeGreaterThanOrEqual(10n * ATTO_ETH_PER_ETH)
		expect(simulation.badDebtAttoEth).toBe(0n)
	})

	test('transfers full commitments with a capped award and no write-off at the minimum multiplier', () => {
		const targetVaultSummary = createTargetVaultSummary({
			disputeStakedAttoRep: 900n * ATTO_ETH_PER_ETH,
			vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH,
			underwritingLimitAttoEth: 900n * ATTO_ETH_PER_ETH,
		})
		const simulation = simulateLiquidation({
			minimumVaultRepDepositAttoRep: 10n * ATTO_ETH_PER_ETH,
			callerVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 3000n * ATTO_ETH_PER_ETH }),
			requestedDebtAttoEth: 900n * ATTO_ETH_PER_ETH,
			totalUnderwritingLimitAttoEth: 902n * ATTO_ETH_PER_ETH,
			repPerEthPrice: 2n * ATTO_ETH_PER_ETH,
			settlementCollateralAttoEth: 902n * ATTO_ETH_PER_ETH,
			statoblastSecurityMultiplierBps: 10_002n,
			targetVaultSummary,
		})
		const expectedDebtMovedAttoEth = 900n * ATTO_ETH_PER_ETH

		expect(simulation.debtMovedAttoEth).toBe(expectedDebtMovedAttoEth)
		expect(simulation.vaultAttoRepBackingToTransfer).toBe(100n * ATTO_ETH_PER_ETH)
		expect(simulation.badDebtAttoEth).toBe(900n * ATTO_ETH_PER_ETH - expectedDebtMovedAttoEth)
		expect(simulation.targetAfter.disputeStakedAttoRep).toBe(900n * ATTO_ETH_PER_ETH)
		expect(simulation.targetAfter.underwritingLimitAttoEth).toBe(900n * ATTO_ETH_PER_ETH - expectedDebtMovedAttoEth)
	})

	test('transfers exact atomic commitments independently of rounded obligations', () => {
		const targetVaultSummary = createTargetVaultSummary({
			vaultAttoRepBacking: 3n,
			underwritingLimitAttoEth: 1n,
			openInterestAttoEth: 2n,
			repBackingUnits: 3n,
			totalRepBackingUnits: 13n,
			totalPoolHeldRepBalanceAttoRep: 13n,
		})
		const receiverVaultSummary = createTargetVaultSummary({
			vaultAttoRepBacking: 10n,
			underwritingLimitAttoEth: 1n,
			openInterestAttoEth: 2n,
			repBackingUnits: 10n,
			totalRepBackingUnits: 13n,
			totalPoolHeldRepBalanceAttoRep: 13n,
		})
		const simulation = simulateLiquidation({
			callerVaultSummary: receiverVaultSummary,
			requestedDebtAttoEth: 2n,
			totalUnderwritingLimitAttoEth: 3n,
			minimumVaultRepDepositAttoRep: 1n,
			repPerEthPrice: 2n * ATTO_ETH_PER_ETH,
			settlementCollateralAttoEth: 2n,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})

		expect(simulation.debtMovedAttoEth).toBe(1n)
		expect(simulation.underwritingLimitMovedAttoEth).toBe(1n)
		expect(simulation.badDebtAttoEth).toBe(0n)
		expect(simulation.grossRepAwardAttoRep).toBe(3n)
		expect(simulation.callerAfter.underwritingLimitAttoEth).toBe(2n)
		expect(simulation.targetAfter.underwritingLimitAttoEth).toBe(0n)
	})

	test('uses exact receiver bad debt when it exceeds current gross open interest', () => {
		const simulation = simulateLiquidation({
			callerVaultSummary: createTargetVaultSummary({
				badDebtAttoEth: 2n,
				underwritingLimitAttoEth: 1n,
				openInterestAttoEth: 0n,
				vaultAttoRepBacking: 10n,
			}),
			requestedDebtAttoEth: 2n,
			totalUnderwritingLimitAttoEth: 4n,
			minimumVaultRepDepositAttoRep: 1n,
			repPerEthPrice: ATTO_ETH_PER_ETH,
			settlementCollateralAttoEth: 4n,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary: createTargetVaultSummary({
				underwritingLimitAttoEth: 2n,
				openInterestAttoEth: 2n,
				vaultAttoRepBacking: 10n,
			}),
		})

		expect(simulation.debtMovedAttoEth).toBe(0n)
		expect(simulation.underwritingLimitMovedAttoEth).toBe(0n)
	})

	test('uses ETH commitments when current proportional obligation is unavailable', () => {
		const targetVaultSummary = createTargetVaultSummary()
		delete targetVaultSummary.openInterestAttoEth
		expect(() =>
			simulateLiquidation({
				minimumVaultRepDepositAttoRep: 10n * ATTO_ETH_PER_ETH,
				callerVaultSummary: createTargetVaultSummary(),
				requestedDebtAttoEth: 1n,
				totalUnderwritingLimitAttoEth: 4n * ATTO_ETH_PER_ETH,
				repPerEthPrice: ATTO_ETH_PER_ETH,
				settlementCollateralAttoEth: 4n * ATTO_ETH_PER_ETH,
				statoblastSecurityMultiplierBps: 20_000n,
				targetVaultSummary,
			}),
		).not.toThrow()
	})

	test('partial liquidation retains residual commitments and full takeover caps only the REP award', () => {
		const targetVaultSummary = createTargetVaultSummary({
			vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH,
			underwritingLimitAttoEth: ATTO_ETH_PER_ETH / 2n,
		})
		const callerVaultSummary = createTargetVaultSummary({ vaultAttoRepBacking: 400n * ATTO_ETH_PER_ETH, underwritingLimitAttoEth: 0n })
		const partial = simulateLiquidation({
			minimumVaultRepDepositAttoRep: 10n * ATTO_ETH_PER_ETH,
			callerVaultSummary,
			requestedDebtAttoEth: ATTO_ETH_PER_ETH / 4n,
			totalUnderwritingLimitAttoEth: ATTO_ETH_PER_ETH / 2n,
			repPerEthPrice: 300n * ATTO_ETH_PER_ETH,
			settlementCollateralAttoEth: ATTO_ETH_PER_ETH / 2n,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})
		const maximum = simulateLiquidation({
			minimumVaultRepDepositAttoRep: 10n * ATTO_ETH_PER_ETH,
			callerVaultSummary,
			requestedDebtAttoEth: ATTO_ETH_PER_ETH / 2n,
			totalUnderwritingLimitAttoEth: ATTO_ETH_PER_ETH / 2n,
			repPerEthPrice: 300n * ATTO_ETH_PER_ETH,
			settlementCollateralAttoEth: ATTO_ETH_PER_ETH / 2n,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})

		expect(partial.debtMovedAttoEth).toBe(ATTO_ETH_PER_ETH / 4n)
		expect(partial.badDebtAttoEth).toBe(0n)
		expect(partial.targetAfter.underwritingLimitAttoEth).toBe(ATTO_ETH_PER_ETH / 4n)
		expect(maximum.debtMovedAttoEth).toBe(ATTO_ETH_PER_ETH / 2n)
		expect(maximum.badDebtAttoEth).toBe(ATTO_ETH_PER_ETH / 2n - maximum.debtMovedAttoEth)
		expect(maximum.targetAfter.underwritingLimitAttoEth).toBe(ATTO_ETH_PER_ETH / 2n - maximum.underwritingLimitMovedAttoEth)
	})

	test('leaves dispute-staked REP with the target during liquidation', () => {
		const targetVaultSummary = createTargetVaultSummary({
			disputeStakedAttoRep: 11n * ATTO_ETH_PER_ETH,
			vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH,
			underwritingLimitAttoEth: 100n * ATTO_ETH_PER_ETH,
		})
		const simulation = simulateLiquidation({
			minimumVaultRepDepositAttoRep: 10n * ATTO_ETH_PER_ETH,
			callerVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH }),
			requestedDebtAttoEth: 50n * ATTO_ETH_PER_ETH,
			totalUnderwritingLimitAttoEth: 102n * ATTO_ETH_PER_ETH,
			repPerEthPrice: ATTO_ETH_PER_ETH,
			settlementCollateralAttoEth: 102n * ATTO_ETH_PER_ETH,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})

		expect(simulation.vaultAttoRepBackingToTransfer).toBe((105n * ATTO_ETH_PER_ETH) / 2n)
		expect(simulation.targetAfter.disputeStakedAttoRep).toBe(11n * ATTO_ETH_PER_ETH)
		expect(simulation.callerAfter.disputeStakedAttoRep).toBe(0n)
	})

	test('does not offer liquidation when live pool-held and dispute REP keep the target healthy', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH, vaultAddress: defaultCallerVaultAddress }),
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: 2n * ATTO_ETH_PER_ETH }),
			liquidationDebtEthAmount: '50',
			selectedPool: createSelectedPool({ statoblastSecurityMultiplierBps: 20_000n }),
			targetVaultSummary: createTargetVaultSummary({
				disputeStakedAttoRep: 300n * ATTO_ETH_PER_ETH,
				vaultAttoRepBacking: 300n * ATTO_ETH_PER_ETH,
				underwritingLimitAttoEth: 100n * ATTO_ETH_PER_ETH,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		expectTransactionButtonDisabled(document.body, 'Execute vault liquidation')
	})

	test('uses the shared chain timestamp context for oracle expiry text', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n + 60n * 60n + 60n}>
				<LiquidationModal
					accountAddress={defaultCallerVaultAddress}
					closeLiquidationModal={() => undefined}
					currentPoolOracleManagerDetails={undefined}
					isOnActiveAppChain
					liquidationDebtEthAmount='1'
					liquidationManagerAddress={zeroAddress}
					liquidationModalOpen
					liquidationSecurityPoolAddress={zeroAddress}
					liquidationTargetVault={defaultTargetVaultAddress}
					liquidationTimeoutMinutes='5'
					loadingPoolOracleManager={false}
					onLoadPoolOracleManager={() => undefined}
					onLiquidationAmountChange={() => undefined}
					onLiquidationTimeoutMinutesChange={() => undefined}
					onQueueLiquidation={() => undefined}
					onSelectedPoolViewChange={() => undefined}
					repPerEthPrice={1n * 10n ** 18n}
					repPerEthSource='mock'
					repPerEthSourceUrl={undefined}
					selectedPool={createSelectedPool({
						lastOraclePrice: 3n * 10n ** 18n,
						lastOracleSettlementTimestamp: 1n,
					})}
					securityPoolOverviewActiveAction={undefined}
					securityPoolLiquidationError={undefined}
					securityPoolOverviewResult={undefined}
					callerVaultSummary={createTargetVaultSummary({ vaultAddress: defaultCallerVaultAddress })}
					targetVaultSummary={createTargetVaultSummary({ vaultAddress: defaultTargetVaultAddress })}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('(expired 1m ago)')).toBe(true)
	})

	test('blocks direct liquidation when a usable price has only 30 seconds left', async () => {
		const onQueueLiquidation = mock(() => undefined)
		const renderedComponent = await renderLiquidationModalAt(970n, {
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: 3n * ATTO_ETH_PER_ETH, priceValidUntilTimestamp: 1000n }),
			callerVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH, vaultAddress: defaultCallerVaultAddress }),
			onQueueLiquidation,
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		const button = within(document.body).getByRole('button', { name: 'Execute vault liquidation' })
		expect(button.hasAttribute('disabled')).toBe(true)
		expect(document.body.textContent).toContain('The oracle price expires in 30 seconds, before this transaction could confirm.')
		fireEvent.click(button)
		expect(onQueueLiquidation).not.toHaveBeenCalled()
	})

	test('queues liquidation when the loaded validity flag reaches its shared expiry boundary', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1000n}>
				<LiquidationModal
					{...createLiquidationModalProps({
						currentPoolOracleManagerDetails: createOracleManagerDetails({
							isPriceValid: true,
							priceValidUntilTimestamp: 1000n,
						}),
					})}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Queue vault liquidation' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Queue liquidation' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Execute vault liquidation' })).toBeNull()
	})

	test('uses the shared action row when execute liquidation shows a disabled reason', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '2',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 20n * 10n ** 18n,
				underwritingLimitAttoEth: 1n * 10n ** 18n,
				vaultAddress: getAddress('0x0000000000000000000000000000000000000001'),
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 30n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		const cancelButton = documentQueries.getByRole('button', { name: 'Cancel' })
		const actionContainer = cancelButton.closest('.transaction-step-actions')

		expect(executeButton.disabled).toBe(true)
		expect(documentQueries.getByText('The receiver vault would become liquidatable after this liquidation.')).not.toBeNull()
		expect(actionContainer).not.toBeNull()
		expect(actionContainer?.className).toContain('actions')
		expect(actionContainer?.className).toContain('transaction-step-actions')
	})

	test('distinguishes receiver vaults that remain liquidatable after the simulated liquidation', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '1',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 20n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
				vaultAddress: getAddress('0x0000000000000000000000000000000000000001'),
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 30n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement

		expect(executeButton.disabled).toBe(true)
		expect(documentQueries.getByText('The receiver vault would remain liquidatable after this liquidation.')).not.toBeNull()
	})

	test('does not use target dispute-staked REP to make the caller appear healthy', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				disputeStakedAttoRep: 0n,
				vaultAttoRepBacking: 23n * ATTO_ETH_PER_ETH,
				underwritingLimitAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: ATTO_ETH_PER_ETH }),
			liquidationDebtEthAmount: '50',
			selectedPool: createSelectedPool({ statoblastSecurityMultiplierBps: 20_000n }),
			targetVaultSummary: createTargetVaultSummary({
				disputeStakedAttoRep: 100n * ATTO_ETH_PER_ETH,
				vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH,
				underwritingLimitAttoEth: 100n * ATTO_ETH_PER_ETH,
				vaultAddress: defaultTargetVaultAddress,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement

		expect(executeButton.disabled).toBe(true)
		expect(documentQueries.getByText('The receiver vault would become liquidatable after this liquidation.')).not.toBeNull()
	})

	test('renders the target vault with the shared address value component', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const targetVaultAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			liquidationTargetVault: targetVaultAddress,
			callerVaultSummary: createTargetVaultSummary({
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAddress: targetVaultAddress,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: `Copy address ${callerVaultAddress}` })).not.toBeNull()
		const targetVaultButton = documentQueries.getByRole('button', { name: `Copy address ${targetVaultAddress}` })
		expect(targetVaultButton).not.toBeNull()
		expect(targetVaultButton.textContent).toContain(targetVaultAddress)
	})

	test('names partial receiver input as invalid in the header instead of clipping it as an address', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const targetVaultAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			liquidationReceiverVault: '0x1234',
			liquidationTargetVault: targetVaultAddress,
			targetVaultSummary: createTargetVaultSummary({ vaultAddress: targetVaultAddress }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const receiverHeading = document.body.querySelectorAll('.liquidation-party .decision-heading')[1]
		if (!(receiverHeading instanceof HTMLElement)) throw new Error('Expected the receiver vault heading')
		expect(receiverHeading.textContent).toBe('Invalid address')
		expect(receiverHeading.querySelector('.address-value')).toBeNull()
		expect(within(document.body).getAllByText('Enter a valid receiver vault address.').length).toBeGreaterThan(0)
	})

	test('shows a warning and disables liquidation when receiver and target vaults are the same', async () => {
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: vaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '1',
			liquidationTargetVault: vaultAddress,
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
				vaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 5n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
				vaultAddress,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(executeButton.disabled).toBe(true)
		expect(documentQueries.getByRole('heading', { name: 'Invalid liquidation pair' })).not.toBeNull()
		expect(document.body.querySelector('.warning-surface')).not.toBeNull()
		expect(document.body.querySelector('.badge.warn')).toBeNull()
		expect(documentQueries.getAllByText('Select a target vault that is different from the receiver vault.')).toHaveLength(2)
	})

	test('shows the receiver vault without a post-liquidation review panel', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '2',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 5n * 10n ** 18n,
				underwritingLimitAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Receiver vault REP backing')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: `Copy address ${callerVaultAddress}` })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Caller Vault After Liquidation' })).toBeNull()
	})

	test('clamps a delegated request above the approval limits and explains the clamp instead of blocking', async () => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const renderedComponent = await renderLiquidationModalAt(1_900_000_000n, {
			liquidationDebtEthAmount: '5',
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: ATTO_ETH_PER_ETH, lastSettlementTimestamp: 1_900_000_000n, priceValidUntilTimestamp: 1_900_001_000n }),
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId: `0x${'12'.repeat(32)}`,
			liquidationApprovalDetails: createLiquidationApprovalDetails(receiverVault),
			liquidationReceiverVaultSummaryResolved: true,
			receiverVaultSummary: createTargetVaultSummary({ vaultAddress: receiverVault }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('The approval limits this liquidation to 3 ETH; the registry reserves at most that amount.')).not.toBeNull()
		expect(getTransactionButtonState(document.body, 'Execute vault liquidation').reason).not.toBe('Available or per-liquidation approval quota is below the requested commitment.')
	})

	test('blocks an unhealthy target until the price moves the minimum distance past its liquidation threshold', async () => {
		const targetVaultSummary = createTargetVaultSummary({ vaultAddress: defaultTargetVaultAddress, vaultAttoRepBacking: 100n * ATTO_ETH_PER_ETH, underwritingLimitAttoEth: 10n * ATTO_ETH_PER_ETH })
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: 5_555_555_555_555_555_555n, minLiquidationPriceDistanceBps: 1_000n }),
			targetVaultSummary,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Execute vault liquidation', 'The price must move at least 10% past this vault’s liquidation threshold before it can be liquidated.')
	})

	test('blocks liquidating a target vault that has bad debt', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: 3n * ATTO_ETH_PER_ETH }),
			targetVaultSummary: createTargetVaultSummary({ badDebtAttoEth: 1n, vaultAddress: defaultTargetVaultAddress }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Execute vault liquidation', 'The target vault has bad debt, so it cannot be liquidated.')
	})

	test('shows delegated receiver approval quota, reservation, expiry, and health limits', async () => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const renderedComponent = await renderLiquidationModalAt(1_900_000_000n, {
			liquidationDebtEthAmount: '2',
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: ATTO_ETH_PER_ETH }),
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId: `0x${'11'.repeat(32)}`,
			liquidationApprovalDetails: createLiquidationApprovalDetails(receiverVault),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Available approval')).not.toBeNull()
		expect(documentQueries.getByText('Reserved approval')).not.toBeNull()
		expect(documentQueries.getByText('Consumed approval')).not.toBeNull()
		expect(documentQueries.getByText('Per-liquidation limit')).not.toBeNull()
		expect(documentQueries.getByText('Total approval limit')).not.toBeNull()
		expect(documentQueries.getByText('Approval valid after')).not.toBeNull()
		expect(documentQueries.getByText('Approval expiration')).not.toBeNull()
		expect(documentQueries.getByText('1.25× protocol minimum')).not.toBeNull()
		expect(documentQueries.getByText('Active')).not.toBeNull()
		expect(documentQueries.getByText('The operator pays gas and oracle costs; the receiver receives REP backing units and commitments.')).not.toBeNull()
		expect(
			documentQueries.getByText(
				'The staged commitment transfer is reserved against the approval’s cumulative ETH quota and cannot exceed its per-liquidation limit. Existing reservations survive revocation. The receiver’s live balances, minimum commitment, and signed minimum health factor are checked again at execution, so a queue-time estimate does not guarantee execution.',
			),
		).not.toBeNull()
	})

	test('blocks a delegated receiver that passes protocol health but fails the approved minimum factor', async () => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const receiverAfter = {
			disputeStakedAttoRep: 0n,
			healthFactorBps: 10_000n,
			underwritingLimitAttoEth: 3n * ATTO_ETH_PER_ETH,
			poolHeldVaultRepBackingAttoRep: 6_050_000_000_000_000_000n,
			poolSecurityMultiplierBps: 20_000n,
			repPerEthPrice: ATTO_ETH_PER_ETH,
		}
		expect(isVaultHealthyAtFactor(receiverAfter)).toBe(true)
		expect(isVaultHealthyAtFactor({ ...receiverAfter, healthFactorBps: 12_500n })).toBe(false)

		const renderedComponent = await renderLiquidationModalAt(1_900_000_000n, {
			liquidationDebtEthAmount: '1',
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: ATTO_ETH_PER_ETH, lastSettlementTimestamp: 1_900_000_000n, priceValidUntilTimestamp: 1_900_001_000n }),
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId: `0x${'31'.repeat(32)}`,
			liquidationApprovalDetails: createLiquidationApprovalDetails(receiverVault, { minPostLiquidationHealthFactorBps: 12_500n }),
			liquidationReceiverVaultSummaryResolved: true,
			receiverVaultSummary: createTargetVaultSummary({ vaultAddress: receiverVault }),
			selectedPool: createSelectedPool({ minimumSecurityBondDebtAttoEth: ATTO_ETH_PER_ETH, minimumVaultRepDepositAttoRep: 1n }),
			targetVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 3n * ATTO_ETH_PER_ETH, vaultAddress: defaultTargetVaultAddress }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Execute vault liquidation', 'The receiver vault would fall below the approved minimum post-liquidation health factor.')
	})

	test('shows an invalidated approval nonce as unavailable and disables delegated submission', async () => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const renderedComponent = await renderLiquidationModalAt(1_900_000_000n, {
			liquidationDebtEthAmount: '2',
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: ATTO_ETH_PER_ETH, lastSettlementTimestamp: 1_900_000_000n }),
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId: `0x${'14'.repeat(32)}`,
			liquidationApprovalDetails: createLiquidationApprovalDetails(receiverVault, { nonce: 7n }, { minimumValidNonce: 8n }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Nonce invalidated')).not.toBeNull()
		const submissionButton = document.body.querySelector('.tx-action-button')
		if (!(submissionButton instanceof HTMLButtonElement)) throw new Error('Expected liquidation submission button')
		expect(submissionButton.disabled).toBe(true)
	})

	test('shows pending approval timing and formats maximum supported timestamps and large health factors without numeric loss', async () => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const renderedComponent = await renderLiquidationModalAt(2n, {
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId: `0x${'12'.repeat(32)}`,
			liquidationApprovalDetails: createLiquidationApprovalDetails(receiverVault, {
				minPostLiquidationHealthFactorBps: 123_456_789_012_345_678_901_234n,
				validAfter: 200n,
				validUntil: 8_640_000_000_000n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Pending')).not.toBeNull()
		expect(documentQueries.getByText('275760-09-13 00:00:00 UTC')).not.toBeNull()
		expect(documentQueries.getByText('12 345 678 901 234 567 890.1234× protocol minimum')).not.toBeNull()
	})

	test('shows expired approval status from the shared chain timestamp', async () => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const renderedComponent = await renderLiquidationModalAt(300n, {
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId: `0x${'13'.repeat(32)}`,
			liquidationApprovalDetails: createLiquidationApprovalDetails(receiverVault, { validUntil: 300n }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('Expired')).not.toBeNull()
	})

	test('automatically resolves delegated approval and receiver state without showing operator balances while unresolved', async () => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const onLoadLiquidationApproval = mock(() => undefined)
		const onLoadLiquidationReceiverVaultSummary = mock(() => undefined)
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true }),
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId: `0x${'22'.repeat(32)}`,
			liquidationReceiverVaultSummaryResolved: false,
			onLoadLiquidationApproval,
			onLoadLiquidationReceiverVaultSummary,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(onLoadLiquidationApproval).toHaveBeenCalledTimes(1)
		expect(onLoadLiquidationReceiverVaultSummary).toHaveBeenCalledTimes(1)
		const receiverBackingLabel = within(document.body).getByText('Receiver vault REP backing')
		expect(receiverBackingLabel.parentElement?.textContent).not.toContain('5.00 REP')
		expectTransactionButtonDisabled(document.body, 'Execute vault liquidation', 'Approval limits are not available yet.')
		expect(within(document.body).queryByRole('button', { name: 'Load approval limits' })).toBeNull()
	})

	test.each([
		['shows an accessible receiver loading status and disables queued submission', false, 'Queue liquidation', `0x${'24'.repeat(32)}`],
		['shows receiver loading once and associates it with disabled execute submission', true, 'Execute vault liquidation', `0x${'25'.repeat(32)}`],
	] as const)('%s', async (_name, isPriceValid, actionLabel, liquidationApprovalId) => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid }),
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId,
			loadingLiquidationReceiverVaultSummary: true,
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		if (!isPriceValid) fireEvent.input(within(document.body).getByRole('textbox', { name: 'OpenOracle REP per ETH starting price' }), { target: { value: '3' } })

		const documentQueries = within(document.body)
		const status = documentQueries.getByRole('status')
		expect(status.textContent).toBe('Loading receiver vault…')
		expect(documentQueries.getAllByText('Loading receiver vault…')).toHaveLength(1)
		expect(documentQueries.getByRole('button', { name: actionLabel }).getAttribute('aria-describedby')).toBe(status.id)
		expectTransactionButtonDisabled(document.body, actionLabel)
	})

	test('uses configured pool minimums in liquidation validation', async () => {
		const renderedComponent = await renderLiquidationModal({
			liquidationDebtEthAmount: '2',
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: ATTO_ETH_PER_ETH }),
			selectedPool: createSelectedPool({
				minimumSecurityBondDebtAttoEth: 2n * ATTO_ETH_PER_ETH,
				minimumVaultRepDepositAttoRep: 25n * ATTO_ETH_PER_ETH,
			}),
			callerVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 20n * ATTO_ETH_PER_ETH }),
			targetVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 19n * 10n ** 17n }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Execute vault liquidation', 'The receiver vault would remain below the minimum REP backing after liquidation.')
	})

	test('keeps delegated submission disabled while approval loading fails and offers retry', async () => {
		const receiverVault = getAddress('0x0000000000000000000000000000000000000002')
		const onLoadLiquidationApproval = mock(() => undefined)
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true }),
			liquidationReceiverVault: receiverVault,
			liquidationApprovalId: `0x${'33'.repeat(32)}`,
			liquidationApprovalError: 'Approval read failed.',
			liquidationReceiverVaultSummaryResolved: true,
			receiverVaultSummary: createTargetVaultSummary({ vaultAddress: receiverVault }),
			onLoadLiquidationApproval,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Execute vault liquidation', 'Approval read failed.')
		const retryButton = within(document.body).getByRole('button', { name: 'Retry approval limits' })
		await act(() => retryButton.click())
		expect(onLoadLiquidationApproval).toHaveBeenCalledTimes(1)
	})

	test('allows execution when the entered amount exceeds the executable cap because execution will clamp it', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '100',
			selectedPool: createSelectedPool({
				settlementCollateralAttoEth: 100n * ATTO_ETH_PER_ETH,
				totalUnderwritingLimitAttoEth: 100n * ATTO_ETH_PER_ETH,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 2_000n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 100n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const executeButton = within(document.body).getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(executeButton.disabled).toBe(false)
	})

	test('rejects a partial commitment transfer that leaves target commitment dust', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			liquidationDebtEthAmount: '99.6',
			selectedPool: createSelectedPool({
				minimumVaultRepDepositAttoRep: 10n * 10n ** 18n,
				minimumSecurityBondDebtAttoEth: ATTO_ETH_PER_ETH,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 2_000n * 10n ** 18n,
				underwritingLimitAttoEth: 0n,
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultAttoRepBacking: 100n * 10n ** 18n,
				underwritingLimitAttoEth: 100n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const executeButton = within(document.body).getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(executeButton.disabled).toBe(true)
		expect(document.body.textContent?.includes('The target vault would fall below the minimum underwriting commitments after liquidation.')).toBe(false)
		expect(within(document.body).getByText('The target vault would fall below the minimum commitment after liquidation.')).not.toBeNull()
		expect(document.querySelector('.transaction-review')).toBeNull()
	})

	test('uses simulation labels and permits amounts above the executable cap', async () => {
		function LiquidationSimulationHarness() {
			const [liquidationDebtEthAmount, setLiquidationAmount] = useState('5000')

			return (
				<LiquidationModal
					accountAddress={defaultCallerVaultAddress}
					closeLiquidationModal={() => undefined}
					currentPoolOracleManagerDetails={createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					})}
					isOnActiveAppChain
					liquidationDebtEthAmount={liquidationDebtEthAmount}
					liquidationManagerAddress={zeroAddress}
					liquidationModalOpen
					liquidationSecurityPoolAddress={zeroAddress}
					liquidationTargetVault={defaultTargetVaultAddress}
					liquidationTimeoutMinutes='5'
					loadingPoolOracleManager={false}
					onLoadPoolOracleManager={() => undefined}
					onLiquidationAmountChange={setLiquidationAmount}
					onLiquidationTimeoutMinutesChange={() => undefined}
					onQueueLiquidation={() => undefined}
					onSelectedPoolViewChange={() => undefined}
					repPerEthPrice={3n * 10n ** 18n}
					repPerEthSource='mock'
					repPerEthSourceUrl={undefined}
					selectedPool={createSelectedPool({
						settlementCollateralAttoEth: 3_500n * ATTO_ETH_PER_ETH,
						totalUnderwritingLimitAttoEth: 3_500n * ATTO_ETH_PER_ETH,
						lastOraclePrice: 3n * 10n ** 18n,
						statoblastSecurityMultiplierBps: 20_000n,
					})}
					securityPoolOverviewActiveAction={undefined}
					securityPoolLiquidationError={undefined}
					securityPoolOverviewResult={undefined}
					callerVaultSummary={createTargetVaultSummary({
						vaultAttoRepBacking: 30_000n * 10n ** 18n,
						underwritingLimitAttoEth: 1_000n * 10n ** 18n,
						vaultAddress: defaultCallerVaultAddress,
					})}
					targetVaultSummary={createTargetVaultSummary({
						vaultAttoRepBacking: 1840n * 10n ** 18n,
						underwritingLimitAttoEth: 2_500n * 10n ** 18n,
						vaultAddress: defaultTargetVaultAddress,
					})}
				/>
			)
		}

		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<LiquidationSimulationHarness />
				</ChainTimestampContext.Provider>,
				container,
			)
		})

		const documentQueries = within(document.body)
		const amountInput = container.querySelector("input[placeholder='0.0']")
		if (!(amountInput instanceof HTMLInputElement)) throw new Error('Expected liquidation amount input')

		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(executeButton.disabled).toBe(false)
		expect(documentQueries.getByText(/Simulation REP per ETH/)).not.toBeNull()

		await act(() => {
			fireEvent.input(amountInput, { target: { value: '2500' } })
		})

		expect(executeButton.disabled).toBe(false)
		expect(document.querySelector('.transaction-review')).toBeNull()

		render(null, container)
		container.remove()
	})

	test('labels quoted liquidation prices with the specific Uniswap version', async () => {
		const renderedV4Component = await renderLiquidationModal({
			repPerEthSource: 'v4',
			repPerEthSourceUrl: 'https://example.com/uniswap-v4',
		})
		cleanupRenderedComponent = renderedV4Component.cleanup

		let documentQueries = within(document.body)
		expect(documentQueries.getByText(/Uniswap V4 REP per ETH/)).not.toBeNull()

		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const renderedV3Component = await renderLiquidationModal({
			repPerEthSource: 'v3',
			repPerEthSourceUrl: 'https://example.com/uniswap-v3',
		})
		cleanupRenderedComponent = renderedV3Component.cleanup

		documentQueries = within(document.body)
		expect(documentQueries.getByText(/Uniswap V3 REP per ETH/)).not.toBeNull()
	})

	test('healthy vault details distinguish commitments, REP backing, and dispute stake', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 1n * 10n ** 18n,
			}),
			selectedPool: createSelectedPool({
				lastOraclePrice: 1n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				disputeStakedAttoRep: 4n * 10n ** 18n,
				vaultAttoRepBacking: 16n * 10n ** 18n,
				underwritingLimitAttoEth: 10n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement).disabled).toBe(true)
		expect(documentQueries.getByText('This vault is not undercollateralized at the current OpenOracle price.')).not.toBeNull()
		expect(documentQueries.getByText('Target commitment')).not.toBeNull()
		expect(documentQueries.getByText('Target vault REP backing')).not.toBeNull()
		expect(documentQueries.getByText('Target dispute-staked REP')).not.toBeNull()
		expect(documentQueries.queryByText(/Collateralization/)).toBeNull()
		expect(documentQueries.queryByText('Below target')).toBeNull()
	})

	test('shows refreshing status while the modal is loading OpenOracle validity', async () => {
		const loadRequests: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: undefined,
			liquidationManagerAddress: '0x00000000000000000000000000000000000000aa',
			loadingPoolOracleManager: true,
			selectedPool: createSelectedPool({
				lastOracleSettlementTimestamp: 1n,
			}),
			onLoadPoolOracleManager: managerAddress => {
				loadRequests.push(managerAddress)
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('dialog', { name: 'Liquidate vault' })).not.toBeNull()
		expect(documentQueries.getByText('Refreshing price validity.')).not.toBeNull()
		expect((documentQueries.getByRole('button', { name: 'Liquidate vault' }) as HTMLButtonElement).disabled).toBe(true)
		expect(loadRequests).toEqual([])
	})

	test('stops automatic price-status retries after an error and retries only on request', async () => {
		const loadRequests: string[] = []
		const managerAddress = '0x00000000000000000000000000000000000000aa'
		const initialProps = createLiquidationModalProps({
			currentPoolOracleManagerDetails: undefined,
			liquidationManagerAddress: managerAddress,
			onLoadPoolOracleManager: address => {
				loadRequests.push(address)
			},
		})
		const renderedComponent = await renderIntoDocument(<LiquidationModal {...initialProps} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(loadRequests).toEqual([managerAddress])

		await act(() => {
			render(<LiquidationModal {...initialProps} poolOracleManagerError='Failed to load price oracle details. Reason: RPC unavailable' />, renderedComponent.container)
		})
		await act(async () => {
			await Promise.resolve()
		})
		expect(loadRequests).toEqual([managerAddress])

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Failed to load price oracle details. Reason: RPC unavailable')).not.toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry price status' }))
		expect(loadRequests).toEqual([managerAddress, managerAddress])
	})

	test('hides the dialog when it is closed while the liquidation is pending', async () => {
		let closeCount = 0
		const props = createLiquidationModalProps({
			closeLiquidationModal: () => {
				closeCount += 1
			},
			securityPoolOverviewActiveAction: 'queueLiquidation',
		})
		const renderedComponent = await renderIntoDocument(<LiquidationModal {...props} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const dialog = within(document.body).getByRole('dialog', { name: 'Liquidate vault' })
		const closeButton = within(dialog).getByRole('button', { name: 'Close' }) as HTMLButtonElement
		expect(closeButton.disabled).toBe(false)
		await act(() => {
			fireEvent.click(closeButton)
		})
		expect(closeCount).toBe(1)

		// The parent closed the dialog; the running transaction keeps the dialog hidden and reports through the transaction toast.
		await act(() => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<LiquidationModal {...props} liquidationModalOpen={false} />
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})
		expect(document.body.querySelector("[role='dialog']")).toBeNull()

		await act(() => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<LiquidationModal {...props} liquidationModalOpen={false} securityPoolOverviewActiveAction={undefined} securityPoolOverviewResult={{ action: 'queueLiquidation', hash: '0x00000000000000000000000000000000000000000000000000000000000000cd', securityPoolAddress: zeroAddress }} />
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})
		expect(document.body.querySelector("[role='dialog']")).toBeNull()
	})

	test('keeps the shared Cancel action disabled while the liquidation is pending', async () => {
		const renderedComponent = await renderLiquidationModal({ securityPoolOverviewActiveAction: 'queueLiquidation' })
		cleanupRenderedComponent = renderedComponent.cleanup
		const dialog = within(document.body).getByRole('dialog', { name: 'Liquidate vault' })
		expect(within(dialog).getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
		expect(within(dialog).getAllByRole('button', { name: 'Close' })).toHaveLength(1)
	})

	test('shows an inline address error for a malformed receiver vault instead of a receiver-state reason', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: 10n * 10n ** 18n }),
			liquidationReceiverVault: '0x1234',
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		const receiverInput = within(document.body).getByRole('textbox', { name: /^Receiver vault/ })
		expect(receiverInput.getAttribute('placeholder')).toBe('0x...')
		expect(receiverInput.getAttribute('aria-invalid')).toBe('true')
		expect(within(document.body).getAllByText('Enter a valid receiver vault address.').length).toBeGreaterThan(0)
		expect(document.body.textContent).not.toContain('Receiver vault state must be loaded')
		expect(getTransactionButtonState(document.body, 'Execute vault liquidation').disabled).toBe(true)
		// Invalid text is not another receiver yet, so the delegated-receiver warning and approval field stay hidden.
		expect(document.body.textContent).not.toContain('Receiver accepts liquidation liabilities')
		expect(within(document.body).queryByRole('textbox', { name: /^Bounded approval ID/ })).toBeNull()
	})

	test('shows an unset bounded approval ID as an empty field with a short placeholder', async () => {
		const approvalIdChanges: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true }),
			liquidationReceiverVault: getAddress('0x0000000000000000000000000000000000000002'),
			onLiquidationApprovalIdChange: value => {
				approvalIdChanges.push(value)
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(document.body.textContent).toContain('Receiver accepts liquidation liabilities')
		const approvalIdInput = within(document.body).getByRole('textbox', { name: /^Bounded approval ID/ })
		if (!(approvalIdInput instanceof HTMLInputElement)) throw new Error('Expected the approval ID input')
		expect(approvalIdInput.value).toBe('')
		expect(approvalIdInput.getAttribute('placeholder')).toBe('0x...')
		fireEvent.input(approvalIdInput, { target: { value: `0x${'22'.repeat(32)}` } })
		fireEvent.input(approvalIdInput, { target: { value: ' ' } })
		// Clearing the field restores the unset zero ID rather than submitting blank text.
		expect(approvalIdChanges).toEqual([`0x${'22'.repeat(32)}`, `0x${'00'.repeat(32)}`])
	})

	test('explains in visible text why Max is unavailable while a liquidation queues without a price', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
			repPerEthPrice: undefined,
			uiPriceOracle: 'uniswap',
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		const maxButton = within(document.body).getByRole('button', { name: 'Max' })
		if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected liquidation Max button')
		expect(maxButton.disabled).toBe(true)
		const hint = within(document.body).getByText(/^Max needs a REP price to estimate the transferable commitment\./)
		expect(hint.classList.contains('field-hint')).toBe(true)
	})

	test('states the 1–5 minute timeout range and flags an out-of-range timeout inline', async () => {
		const renderedComponent = await renderLiquidationModal({ currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }), liquidationTimeoutMinutes: '30' })
		cleanupRenderedComponent = renderedComponent.cleanup
		const timeoutInput = within(document.body).getByRole('textbox', { name: /^Manual execution timeout/ })
		expect(timeoutInput.getAttribute('max')).toBe('5')
		expect(timeoutInput.getAttribute('aria-invalid')).toBe('true')
		expect(document.body.textContent).toContain('Enter 1–5 whole minutes.')
		expect(document.body.textContent).toContain('1–5 whole minutes after oracle settlement.')
	})

	test('bases Max on the pool oracle price that the guard uses and shows the transferable maximum', async () => {
		const amountChanges: string[] = []
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 500n * 10n ** 18n, underwritingLimitAttoEth: 0n, vaultAddress: defaultCallerVaultAddress }),
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: 100n * 10n ** 18n }),
			liquidationDebtEthAmount: '',
			onLiquidationAmountChange: value => amountChanges.push(value),
			// The UI price makes the target look safe, but the pool oracle price the protocol checks makes it liquidatable.
			repPerEthPrice: 1n * 10n ** 18n,
			selectedPool: createSelectedPool({ minimumSecurityBondDebtAttoEth: 0n, minimumVaultRepDepositAttoRep: 0n, statoblastSecurityMultiplierBps: 20_000n }),
			targetVaultSummary: createTargetVaultSummary({ vaultAttoRepBacking: 100n * 10n ** 18n, underwritingLimitAttoEth: 2n * 10n ** 18n, vaultAddress: defaultTargetVaultAddress }),
			uiPriceOracle: 'uniswap',
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(document.body.textContent).toContain('Max transferable: 2')
		const maxButton = document.body.querySelector('.field-inline-action')
		if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected liquidation Max button')
		expect(maxButton.disabled).toBe(false)
		await act(() => {
			fireEvent.click(maxButton)
		})
		expect(amountChanges).toEqual(['2'])
	})

	test('does not fall back to the whole commitment for Max when no price is available', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: undefined,
			selectedPool: createSelectedPool({ lastOraclePrice: undefined, lastOracleSettlementTimestamp: 0n }),
		})
		cleanupRenderedComponent = renderedComponent.cleanup
		const maxButton = document.body.querySelector('.field-inline-action')
		if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected liquidation Max button')
		expect(maxButton.disabled).toBe(true)
	})
})

test('liquidation estimates value the receiver complete backing-unit position after transfer', () => {
	const conversion = { totalRepBackingUnits: 3n, totalPoolHeldRepBalanceAttoRep: 2n }
	const target = createTargetVaultSummary({ ...conversion, underwritingLimitAttoEth: 1n, vaultAttoRepBacking: 1n, repBackingUnits: 2n })
	const receiver = createTargetVaultSummary({ ...conversion, underwritingLimitAttoEth: 0n, vaultAttoRepBacking: 0n, repBackingUnits: 1n })
	const quote = simulateLiquidation({ callerVaultSummary: receiver, requestedDebtAttoEth: 1n, totalUnderwritingLimitAttoEth: 1n, minimumVaultRepDepositAttoRep: 0n, repPerEthPrice: ATTO_ETH_PER_ETH, settlementCollateralAttoEth: 0n, statoblastSecurityMultiplierBps: 20_000n, targetVaultSummary: target })
	expect(quote.callerAfter.vaultAttoRepBacking).toBe(2n)
	expect(quote.targetAfter.vaultAttoRepBacking).toBe(0n)
	expect(quote.callerAfter.underwritingLimitAttoEth).toBe(1n)
})
