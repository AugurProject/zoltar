/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '../../testUtils/queries'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { LiquidationModal } from '../../../features/security-pools/components/LiquidationModal.js'
import { simulateLiquidation } from '../../../features/security-pools/lib/liquidation.js'
import { ChainTimestampContext } from '../../../lib/chainTimestamp.js'
import { deriveHasForkActivity } from '../../../features/truth-auctions/lib/forkAuction.js'
import { evaluateSecurityPoolState } from '../../../features/security-pools/lib/securityPoolState.js'
import type { ListedSecurityPool, MarketDetails, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, getTransactionButtonState } from '../../testUtils/transactionActionButton.js'

const ETH = 10n ** 18n

function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Will this resolve?',
		...overrides,
	}
}

function createOracleManagerDetails(overrides: Partial<OracleManagerDetails> = {}): OracleManagerDetails {
	const details = {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: true,
		lastPrice: 1n,
		lastSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		openOracleAddress: zeroAddress,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingSettlementOperationIds: [],
		pendingSettlementQueueCapacity: 4n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: 1000n,
		queuedOperationCostAttoEth: 1n,
		requestPriceCostAttoEth: 1n,
		token1: zeroAddress,
		token2: zeroAddress,
		...overrides,
	}
	return details
}

function createTargetVaultSummary(overrides: Partial<SecurityPoolVaultSummary> = {}): SecurityPoolVaultSummary {
	return {
		disputeStakedRepAttoRep: 0n,
		vaultRepBackingAttoRep: 5n * 10n ** 18n,
		coverageCommitmentAttoEth: 2n * 10n ** 18n,
		claimableFeesAttoEth: 0n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const selectedPool: ListedSecurityPool = {
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 10n,
		feeEligibleCoverageCommitmentAttoEth: 2n * 10n ** 18n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
		lastOraclePrice: 3n * 10n ** 18n,
		lastOracleSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRepAttoRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'none',
		questionId: '0x01',
		statoblastSecurityMultiplierBps: 20_000n,
		securityPoolAddress: zeroAddress,
		shareTokenSupplyAttoShares: 0n,
		systemState: 'operational',
		totalPoolHeldRepAttoRep: 5n * 10n ** 18n,
		totalCoverageCommitmentAttoEth: 2n * 10n ** 18n,
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

function getTransactionReviewValue(label: string) {
	const labelElement = Array.from(document.body.querySelectorAll('.transaction-review-row > span')).find(element => element.textContent === label)
	if (!(labelElement instanceof HTMLElement)) throw new Error(`Expected ${label} label`)
	const valueElement = labelElement.nextElementSibling
	if (!(valueElement instanceof HTMLElement)) throw new Error(`Expected ${label} value`)
	return valueElement.textContent
}

function createEndedPoolState() {
	return evaluateSecurityPoolState({
		lifecycleState: 'ended',
		universeHasForked: false,
	})
}

describe('LiquidationModal', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	const defaultCallerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
	const defaultTargetVaultAddress = getAddress('0x00000000000000000000000000000000000000a1')

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

	function createLiquidationModalProps(overrides: Partial<Parameters<typeof LiquidationModal>[0]> = {}): Parameters<typeof LiquidationModal>[0] {
		return {
			accountAddress: defaultCallerVaultAddress,
			closeLiquidationModal: () => undefined,
			currentPoolOracleManagerDetails: undefined,
			isOnActiveAppChain: true,
			coverageCommitmentTransferEthAmount: '1',
			maximumCoverageCommitmentTransferAttoEth: 5n * 10n ** 18n,
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
			onQueueLiquidation: () => undefined,
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
			...overrides,
		}
	}

	function renderLiquidationModal(overrides: Partial<Parameters<typeof LiquidationModal>[0]> = {}) {
		return renderIntoDocument(<LiquidationModal {...createLiquidationModalProps(overrides)} />)
	}

	test('disables execute liquidation when the selected pool has ended', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
			}),
			poolState: createEndedPoolState(),
			selectedPool: createSelectedPool({
				questionOutcome: 'yes',
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Execute vault liquidation')
	})

	test('disables queued liquidation when the selected pool has ended', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
			}),
			poolState: createEndedPoolState(),
			selectedPool: createSelectedPool({
				questionOutcome: 'yes',
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Queue liquidation')
	})

	test('defaults queued liquidation timeout copy to 5 minutes', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('This queued staged operation will expire 5m after the oracle settlement window completes.')).toBe(true)
	})

	test('reviews the complete queued liquidation funding sequence and resulting balances', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: false }),
			liquidationFundingPreview: {
				currentRepBalanceAttoRep: 25n * ETH,
				currentWethBalanceAttoEth: 1n * ETH,
				initialReportRepRequiredAttoRep: 10n * ETH,
				initialReportWethRequiredAttoEth: 2n * ETH,
				queueOperationValueAttoEth: (12n * ETH) / 10n,
				totalWalletEthRequiredAttoEth: (22n * ETH) / 10n,
				wethShortfallAttoEth: 1n * ETH,
			},
			walletBalanceAttoEth: 5n * ETH,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const review = within(document.body).getByRole('heading', { name: 'Transaction Review' }).closest('section')
		if (review === null) throw new Error('Expected transaction review')
		expect(review.textContent).toContain('Buffered Queue Cost≈ 1.20 ETH')
		expect(review.textContent).toContain('ETH Wrapped to WETH≈ 1.00 ETH')
		expect(review.textContent).toContain('REP Locked for Initial Report≈ 10.00 REP')
		expect(review.textContent).toContain('WETH Locked for Initial Report≈ 2.00 WETH')
		expect(review.textContent).toContain('Total Wallet ETH Required≈ 2.20 ETH')
		expect(review.textContent).toContain('Resulting Wallet ETH≈ 2.80 ETH')
		expect(review.textContent).toContain('request funding may require multiple wallet transactions')
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
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Submitted' })).not.toBeNull()
		expect(documentQueries.getByText('The transaction succeeded, but the latest manager state is not available.')).not.toBeNull()
		expect(documentQueries.queryByText('Refresh staged operations to confirm the latest manager state.')).toBeNull()
	})

	test('requires a queued liquidation timeout of at least 1 minute', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
			}),
			liquidationTimeoutMinutes: '0',
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Queue liquidation', 'Enter a liquidation timeout of at least 1 minute.')
	})

	test('keeps liquidation disabled off mainnet and explains recovery', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
			}),
			isOnActiveAppChain: false,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionButtonState(document.body, 'Execute vault liquidation')).toEqual({ disabled: true, reason: 'Switch to Ethereum mainnet.' })
		expect(document.body.textContent?.includes('Switch to Ethereum mainnet.')).toBe(true)
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

		const dialog = within(document.body).getByRole('dialog', { name: 'Liquidate Vault' })
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
		expect(within(container).getByRole('dialog', { name: 'Liquidate Vault' })).not.toBeNull()

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

		expect(within(container).getByRole('dialog', { name: 'Execute Vault Liquidation' })).not.toBeNull()
		expect(within(container).getByRole('dialog', { name: 'Queue Vault Liquidation' })).not.toBeNull()
		const stackedBackdrops = container.querySelectorAll('.modal-backdrop')
		const executeBackdrop = stackedBackdrops[0]
		if (!(executeBackdrop instanceof HTMLElement)) throw new Error('Expected execute modal backdrop')
		expect(executeBackdrop.getAttribute('aria-hidden')).toBe('true')
		expect(executeBackdrop.hasAttribute('inert')).toBe(true)

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})

		expect(within(container).getByRole('dialog', { name: 'Execute Vault Liquidation' })).not.toBeNull()
		expect(within(container).queryByRole('dialog', { name: 'Queue Vault Liquidation' })).toBeNull()
		const restoredExecuteBackdrop = container.querySelector('.modal-backdrop')
		if (!(restoredExecuteBackdrop instanceof HTMLElement)) throw new Error('Expected restored execute modal backdrop')
		expect(restoredExecuteBackdrop.getAttribute('aria-hidden')).toBe(null)
		expect(restoredExecuteBackdrop.hasAttribute('inert')).toBe(false)

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})
		expect(within(container).queryByRole('dialog', { name: 'Execute Vault Liquidation' })).toBeNull()

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

		const executeDialog = within(container).getByRole('dialog', { name: 'Execute Vault Liquidation' })
		const queueDialog = within(container).getByRole('dialog', { name: 'Queue Vault Liquidation' })
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
			const [coverageCommitmentTransferEthAmount, setLiquidationAmount] = useState('1')

			return (
				<LiquidationModal
					accountAddress={zeroAddress}
					closeLiquidationModal={() => undefined}
					currentPoolOracleManagerDetails={undefined}
					isOnActiveAppChain
					coverageCommitmentTransferEthAmount={coverageCommitmentTransferEthAmount}
					maximumCoverageCommitmentTransferAttoEth={5n}
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

	test('shows queued liquidation details and links to staged operations', async () => {
		const selectedViews: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				pendingOperation: {
					amount: 5n * 10n ** 18n,
					initiatorVault: zeroAddress,
					operation: 'liquidation',
					operationId: 9n,
					targetVault: zeroAddress,
				},
				pendingOperationSlotId: 9n,
			}),
			coverageCommitmentTransferEthAmount: '5',
			maximumCoverageCommitmentTransferAttoEth: 5n * 10n ** 18n,
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
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Queued' })).not.toBeNull()
		expect(documentQueries.getByText('#9')).not.toBeNull()
		expect(documentQueries.getByText('Coverage commitment transfer')).not.toBeNull()
		expect(documentQueries.getByText('5 ETH')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Queued' }).closest('.liquidation-modal-actions')).toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'View in staged operations' }))
		})

		expect(selectedViews).toEqual(['staged-operations'])
	})

	test('shows manual execution guidance for overflow queued liquidations', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
				pendingOperation: {
					amount: 5n,
					initiatorVault: zeroAddress,
					operation: 'withdrawRep',
					operationId: 8n,
					targetVault: '0x0000000000000000000000000000000000000001',
				},
				pendingOperationSlotId: 8n,
			}),
			coverageCommitmentTransferEthAmount: '5',
			maximumCoverageCommitmentTransferAttoEth: 5n * 10n ** 18n,
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
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Queued' })).not.toBeNull()
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
			coverageCommitmentTransferEthAmount: '5',
			maximumCoverageCommitmentTransferAttoEth: 5n * 10n ** 18n,
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
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Executed' })).not.toBeNull()
		expect(documentQueries.getByText('A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Execute Vault Liquidation' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Queue Vault Liquidation' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'View in staged operations' })).toBeNull()
	})

	test('executes liquidation when the current oracle price is valid', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				pendingOperation: undefined,
				pendingOperationSlotId: 0n,
			}),
			coverageCommitmentTransferEthAmount: '5',
			maximumCoverageCommitmentTransferAttoEth: 5n * 10n ** 18n,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Execute Vault Liquidation' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Execute vault liquidation' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Queue Vault Liquidation' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Queue liquidation' })).toBeNull()
	})

	test('disables queued liquidation when the wallet lacks the buffered oracle bounty ETH', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
				requestPriceCostAttoEth: 10n * ETH,
			}),
			liquidationFundingPreview: {
				currentRepBalanceAttoRep: 0n,
				currentWethBalanceAttoEth: 0n,
				initialReportRepRequiredAttoRep: 0n,
				initialReportWethRequiredAttoEth: 0n,
				queueOperationValueAttoEth: 12n * ETH,
				totalWalletEthRequiredAttoEth: 12n * ETH,
				wethShortfallAttoEth: 0n,
			},
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 100n * 10n ** 18n,
			}),
			walletBalanceAttoEth: 5n * ETH,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Queue liquidation', 'Need 7 more ETH in this wallet to queue liquidation.')
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
			coverageCommitmentTransferEthAmount: '100',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 2_000n * 10n ** 18n,
				coverageCommitmentAttoEth: 0n,
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 100n * 10n ** 18n,
			}),
			walletBalanceAttoEth: 100n * ETH,
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const queueButton = within(document.body).getByRole('button', { name: 'Queue liquidation' }) as HTMLButtonElement
		expect(queueButton.disabled).toBe(false)
	})

	test('coverage commitment', async () => {
		const amountChanges: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: false,
				lastPrice: 10n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '1',
			maximumCoverageCommitmentTransferAttoEth: 100n * 10n ** 18n,
			onLiquidationAmountChange: value => {
				amountChanges.push(value)
			},
			selectedPool: createSelectedPool({
				lastOraclePrice: 10n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 100n * 10n ** 18n,
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
			coverageCommitmentTransferEthAmount: '5',
			maximumCoverageCommitmentTransferAttoEth: 5n * 10n ** 18n,
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ab',
				securityPoolAddress: zeroAddress,
				stagedExecution: {
					errorMessage: 'Local Coverage commitment broken',
					operation: 'liquidation',
					operationId: 4n,
					success: false,
				},
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Failed' })).not.toBeNull()
		expect(documentQueries.getByText('Local Coverage commitment broken')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'View in staged operations' })).toBeNull()
	})

	test('maps compact liquidation revert reasons back to explicit operator-facing copy', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				pendingOperation: undefined,
				pendingOperationSlotId: 0n,
			}),
			coverageCommitmentTransferEthAmount: '5',
			maximumCoverageCommitmentTransferAttoEth: 5n * 10n ** 18n,
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ac',
				securityPoolAddress: zeroAddress,
				stagedExecution: {
					errorMessage: 'Caller commitment',
					operation: 'liquidation',
					operationId: 5n,
					success: false,
				},
			},
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Your vault would remain below the minimum coverage commitment after liquidation.')).not.toBeNull()

		renderedComponent.cleanup()
		cleanupRenderedComponent = undefined

		const noGainRenderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				pendingOperation: undefined,
				pendingOperationSlotId: 0n,
			}),
			coverageCommitmentTransferEthAmount: '5',
			maximumCoverageCommitmentTransferAttoEth: 5n * 10n ** 18n,
			securityPoolOverviewResult: {
				action: 'queueLiquidation',
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ad',
				securityPoolAddress: zeroAddress,
				stagedExecution: {
					errorMessage: 'No gain',
					operation: 'liquidation',
					operationId: 6n,
					success: false,
				},
			},
		})
		cleanupRenderedComponent = noGainRenderedComponent.cleanup

		expect(within(document.body).getByText('This liquidation amount rounds to no transferable bundled position.')).not.toBeNull()
	})

	test('keeps the dialog open and shows execution results when the parent closes it after submit', async () => {
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
					coverageCommitmentTransferEthAmount='1'
					maximumCoverageCommitmentTransferAttoEth={5n * 10n ** 18n}
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
						setLiquidationModalOpen(false)
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
						vaultRepBackingAttoRep: 20n * 10n ** 18n,
						coverageCommitmentAttoEth: 1n * 10n ** 18n,
						vaultAddress: defaultCallerVaultAddress,
					})}
					targetVaultSummary={createTargetVaultSummary({
						vaultRepBackingAttoRep: 12n * 10n ** 18n,
						coverageCommitmentAttoEth: 11n * 10n ** 18n,
						vaultAddress: defaultTargetVaultAddress,
					})}
				/>
			)
		}

		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<LiquidationExecutionHarness />, container)
		})

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Execute vault liquidation' }))
		})

		expect(documentQueries.getByRole('dialog', { name: 'Execute Vault Liquidation' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Executed' })).not.toBeNull()
		expect(documentQueries.getByText('A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.')).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Close' }))
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Execute Vault Liquidation' })).toBeNull()

		render(null, container)
		container.remove()
	})

	test('keeps the dialog open and shows liquidation errors inside the dialog', async () => {
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
					coverageCommitmentTransferEthAmount='1'
					maximumCoverageCommitmentTransferAttoEth={5n * 10n ** 18n}
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
						setLiquidationModalOpen(false)
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
						vaultRepBackingAttoRep: 20n * 10n ** 18n,
						coverageCommitmentAttoEth: 1n * 10n ** 18n,
						vaultAddress: defaultCallerVaultAddress,
					})}
					targetVaultSummary={createTargetVaultSummary({
						vaultRepBackingAttoRep: 12n * 10n ** 18n,
						coverageCommitmentAttoEth: 11n * 10n ** 18n,
						vaultAddress: defaultTargetVaultAddress,
					})}
				/>
			)
		}

		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<LiquidationErrorHarness />, container)
		})

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Execute vault liquidation' }))
		})

		expect(documentQueries.getByRole('dialog', { name: 'Execute Vault Liquidation' })).not.toBeNull()
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
			coverageCommitmentTransferEthAmount: '1',
			maximumCoverageCommitmentTransferAttoEth: 25n * 10n ** 18n,
			onLiquidationAmountChange: value => {
				amountChanges.push(value)
			},
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 73n * 10n ** 18n,
				coverageCommitmentAttoEth: 50n * 10n ** 18n,
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

	test('fills the liquidation amount from the dust-safe liquidation Max value', async () => {
		const amountChanges: string[] = []
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 1000n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '1',
			maximumCoverageCommitmentTransferAttoEth: 995n * 10n ** 17n,
			onLiquidationAmountChange: value => {
				amountChanges.push(value)
			},
			selectedPool: createSelectedPool({
				lastOraclePrice: 1000n * 10n ** 18n,
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 1000n * 10n ** 18n,
				coverageCommitmentAttoEth: 14n * 10n ** 17n,
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

	test('disables direct liquidation when the current Open Oracle price does not make the vault liquidatable', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 0n,
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
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(true)
		expect(documentQueries.getByText('This vault is not undercollateralized at the current Open Oracle price.')).not.toBeNull()
		expect(documentQueries.getByText(/^Open Oracle Price$/)).not.toBeNull()
	})

	test('shows target-safe before post-liquidation REP floor warnings for a safe near-floor target vault', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 1n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '1',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 11n * 10n ** 18n,
				coverageCommitmentAttoEth: 1n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(true)
		expect(documentQueries.getByText('This vault is not undercollateralized at the current Open Oracle price.')).not.toBeNull()
		expect(documentQueries.queryByText('The target vault would fall below the minimum REP backing after liquidation.')).toBeNull()
	})

	test('allows full-close liquidation when the target only holds the minimum REP deposit', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 61n * 10n ** 17n,
			}),
			coverageCommitmentTransferEthAmount: '1',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 10n * 10n ** 18n,
				coverageCommitmentAttoEth: 1n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(false)
		expect(documentQueries.queryByText('No coverage commitment is transferable at the current target-side bounds.')).toBeNull()
		expect(documentQueries.queryByText('The target vault would fall below the minimum REP backing after liquidation.')).toBeNull()
	})

	test('allows full-close liquidation when the computed REP penalty exceeds the target vault balance', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '1',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 10n * 10n ** 18n,
				coverageCommitmentAttoEth: 1n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(false)
		expect(documentQueries.queryByText('No coverage commitment is transferable at the current target-side bounds.')).toBeNull()
		expect(documentQueries.queryByText('The target vault would fall below the minimum REP backing after liquidation.')).toBeNull()
	})

	test('does not offer a positive Max or REP transfer preview for a safe target vault', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 1n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '2',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxButton = document.body.querySelector('.field-inline-action')
		if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected liquidation Max button')
		expect(maxButton.disabled).toBe(true)

		const repMovedLabel = Array.from(document.body.querySelectorAll('.transaction-review-row > span')).find(element => element.textContent === 'REP backing transferred')
		if (!(repMovedLabel instanceof HTMLElement)) throw new Error('Expected REP backing transferred label')
		const repMovedValue = repMovedLabel.nextElementSibling
		if (!(repMovedValue instanceof HTMLElement)) throw new Error('Expected Rep Moved value')
		expect(repMovedValue.textContent).toBe('≈ 0.00 REP')
	})

	test('allows an atomic bonus-priced liquidation', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 1n * 10n ** 18n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 4n * 10n ** 17n,
			}),
			coverageCommitmentTransferEthAmount: '0.000000000000000001',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 130n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(button.disabled).toBe(false)
		expect(documentQueries.getByText(/Escalation claims, pool-held vault REP backing surplus, and accrued fees stay with the target vault/)).not.toBeNull()
		expect(documentQueries.getByText(/A maximum request records any untransferred residual as bad debt/)).not.toBeNull()
	})

	test('previews the exact post-backingUnits-conversion REP amount after a pool donation', () => {
		const totalPoolHeldRepBalanceAttoRep = 200n * ETH + 1n
		const totalRepBackingUnits = 200n * ETH * ETH
		const targetVaultSummary = createTargetVaultSummary({
			repBackingUnits: 100n * ETH * ETH,
			totalRepBackingUnits,
			vaultRepBackingAttoRep: 100n * ETH,
			coverageCommitmentAttoEth: 100n * ETH,
			totalPoolHeldRepBalanceAttoRep,
		})
		const simulation = simulateLiquidation({
			callerVaultSummary: createTargetVaultSummary({ vaultRepBackingAttoRep: 100n * ETH }),
			coverageCommitmentTransferAttoEth: 1n * ETH,
			repPerEthPrice: 1n * ETH,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})
		const quotedRep = (105n * ETH) / 100n
		const backingUnitsMoved = (quotedRep * totalRepBackingUnits + totalPoolHeldRepBalanceAttoRep - 1n) / totalPoolHeldRepBalanceAttoRep
		const exactRepMoved = (backingUnitsMoved * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits

		expect(exactRepMoved).toBe(quotedRep)
		expect(simulation.vaultRepBackingToTransferAttoRep).toBe(exactRepMoved)
	})

	test('matches the contract partial reserve when the REP backing units rate is non-integral', () => {
		const totalPoolHeldRepBalanceAttoRep = 20n * ETH
		const repBackingUnits = 20n * ETH * ETH + 1n
		const totalRepBackingUnits = repBackingUnits
		const targetVaultSummary = createTargetVaultSummary({
			repBackingUnits,
			totalRepBackingUnits,
			vaultRepBackingAttoRep: 20n * ETH,
			coverageCommitmentAttoEth: 20n * ETH,
			totalPoolHeldRepBalanceAttoRep,
		})
		const simulation = simulateLiquidation({
			callerVaultSummary: createTargetVaultSummary({ vaultRepBackingAttoRep: 100n * ETH }),
			coverageCommitmentTransferAttoEth: 10n * ETH,
			repPerEthPrice: ETH,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})
		const reserveBackingUnits = (10n * ETH * totalRepBackingUnits + totalPoolHeldRepBalanceAttoRep - 1n) / totalPoolHeldRepBalanceAttoRep
		const awardableRepAttoRep = ((repBackingUnits - reserveBackingUnits) * totalPoolHeldRepBalanceAttoRep) / totalRepBackingUnits
		const expectedCoverageCommitmentTransferAttoEth = (awardableRepAttoRep * ETH * 10_000n) / (ETH * 10_500n)

		expect(awardableRepAttoRep).toBe(10n * ETH - 1n)
		expect(simulation.coverageCommitmentToTransferAttoEth).toBe(expectedCoverageCommitmentTransferAttoEth)
		expect(simulation.badDebtAttoEth).toBe(0n)
	})

	test('caps coverage commitment at the fully funded award and previews residual bad debt at the minimum multiplier', () => {
		const targetVaultSummary = createTargetVaultSummary({
			disputeStakedRepAttoRep: 900n * ETH,
			vaultRepBackingAttoRep: 100n * ETH,
			coverageCommitmentAttoEth: 900n * ETH,
		})
		const simulation = simulateLiquidation({
			callerVaultSummary: createTargetVaultSummary({ vaultRepBackingAttoRep: 1000n * ETH }),
			coverageCommitmentTransferAttoEth: 900n * ETH,
			repPerEthPrice: 2n * ETH,
			statoblastSecurityMultiplierBps: 10_002n,
			targetVaultSummary,
		})
		const expectedCoverageCommitmentTransferAttoEth = (100n * ETH * ETH * 10_000n) / (2n * ETH * 10_500n)

		expect(simulation.coverageCommitmentToTransferAttoEth).toBe(expectedCoverageCommitmentTransferAttoEth)
		expect(simulation.vaultRepBackingToTransferAttoRep).toBe(100n * ETH - 1n)
		expect(simulation.badDebtAttoEth).toBe(900n * ETH - expectedCoverageCommitmentTransferAttoEth)
		expect(simulation.targetAfter.disputeStakedRepAttoRep).toBe(900n * ETH)
		expect(simulation.targetAfter.coverageCommitmentAttoEth).toBe(0n)
	})

	test('coverage commitment', () => {
		const targetVaultSummary = createTargetVaultSummary({
			vaultRepBackingAttoRep: 100n * ETH,
			coverageCommitmentAttoEth: ETH / 2n,
		})
		const callerVaultSummary = createTargetVaultSummary({ vaultRepBackingAttoRep: 100n * ETH, coverageCommitmentAttoEth: 0n })
		const partial = simulateLiquidation({
			callerVaultSummary,
			coverageCommitmentTransferAttoEth: ETH / 4n,
			repPerEthPrice: 300n * ETH,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})
		const maximum = simulateLiquidation({
			callerVaultSummary,
			coverageCommitmentTransferAttoEth: ETH / 2n,
			repPerEthPrice: 300n * ETH,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})

		expect(partial.coverageCommitmentToTransferAttoEth).toBe(0n)
		expect(partial.badDebtAttoEth).toBe(0n)
		expect(partial.targetAfter.coverageCommitmentAttoEth).toBe(ETH / 2n)
		expect(maximum.coverageCommitmentToTransferAttoEth).toBe(0n)
		expect(maximum.badDebtAttoEth).toBe(ETH / 2n)
		expect(maximum.targetAfter.coverageCommitmentAttoEth).toBe(0n)
	})

	test('leaves dispute-staked REP with the target during liquidation', () => {
		const targetVaultSummary = createTargetVaultSummary({
			disputeStakedRepAttoRep: 11n * ETH,
			vaultRepBackingAttoRep: 100n * ETH,
			coverageCommitmentAttoEth: 100n * ETH,
		})
		const simulation = simulateLiquidation({
			callerVaultSummary: createTargetVaultSummary({ vaultRepBackingAttoRep: 100n * ETH }),
			coverageCommitmentTransferAttoEth: 50n * ETH,
			repPerEthPrice: ETH,
			statoblastSecurityMultiplierBps: 20_000n,
			targetVaultSummary,
		})

		expect(simulation.vaultRepBackingToTransferAttoRep).toBe((105n * ETH) / 2n)
		expect(simulation.targetAfter.disputeStakedRepAttoRep).toBe(11n * ETH)
		expect(simulation.callerAfter.disputeStakedRepAttoRep).toBe(0n)
	})

	test('renders the full pool-held vault REP backing award and retained fees', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({ vaultRepBackingAttoRep: 100n * ETH, vaultAddress: defaultCallerVaultAddress }),
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: ETH }),
			coverageCommitmentTransferEthAmount: '50',
			selectedPool: createSelectedPool({ statoblastSecurityMultiplierBps: 20_000n }),
			targetVaultSummary: createTargetVaultSummary({
				disputeStakedRepAttoRep: 11n * ETH,
				vaultRepBackingAttoRep: 100n * ETH,
				coverageCommitmentAttoEth: 100n * ETH,
				claimableFeesAttoEth: 7n * ETH,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionReviewValue('Gross REP Award (Includes 5%)')).toBe('≈ 52.50 REP')
		expect(getTransactionReviewValue('REP backing transferred')).toBe('≈ 52.50 REP')
		expect(getTransactionReviewValue('Target Accrued Fees Retained')).toBe('≈ 7.00 ETH')
	})

	test('does not credit target dispute-staked REP against the pool-held vault REP backing award', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({ vaultRepBackingAttoRep: 100n * ETH, vaultAddress: defaultCallerVaultAddress }),
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: 2n * ETH }),
			coverageCommitmentTransferEthAmount: '50',
			selectedPool: createSelectedPool({ statoblastSecurityMultiplierBps: 20_000n }),
			targetVaultSummary: createTargetVaultSummary({
				disputeStakedRepAttoRep: 300n * ETH,
				vaultRepBackingAttoRep: 300n * ETH,
				coverageCommitmentAttoEth: 100n * ETH,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(getTransactionReviewValue('Gross REP Award (Includes 5%)')).toBe('≈ 105.00 REP')
		expect(getTransactionReviewValue('REP backing transferred')).toBe('≈ 105.00 REP')
	})

	test('uses the shared chain timestamp context for oracle expiry text', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n + 5n * 60n + 60n}>
				<LiquidationModal
					accountAddress={defaultCallerVaultAddress}
					closeLiquidationModal={() => undefined}
					currentPoolOracleManagerDetails={undefined}
					isOnActiveAppChain
					coverageCommitmentTransferEthAmount='1'
					maximumCoverageCommitmentTransferAttoEth={5n * 10n ** 18n}
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
		expect(documentQueries.getByRole('heading', { name: 'Queue Vault Liquidation' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Queue liquidation' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Execute Vault Liquidation' })).toBeNull()
	})

	test('uses a dedicated top-aligned action row when execute liquidation shows a disabled reason', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '2',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 20n * 10n ** 18n,
				coverageCommitmentAttoEth: 1n * 10n ** 18n,
				vaultAddress: getAddress('0x0000000000000000000000000000000000000001'),
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 30n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		const cancelButton = documentQueries.getByRole('button', { name: 'Cancel' })
		const actionContainer = cancelButton.closest('.liquidation-modal-actions')

		expect(executeButton.disabled).toBe(true)
		expect(documentQueries.getByText('Your vault would become liquidatable after this liquidation.')).not.toBeNull()
		expect(actionContainer).not.toBeNull()
		expect(actionContainer?.className).toContain('actions')
		expect(actionContainer?.className).toContain('liquidation-modal-actions')
	})

	test('distinguishes caller vaults that remain liquidatable after the simulated liquidation', async () => {
		const renderedComponent = await renderLiquidationModal({
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '1',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 20n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
				vaultAddress: getAddress('0x0000000000000000000000000000000000000001'),
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 30n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement

		expect(executeButton.disabled).toBe(true)
		expect(documentQueries.getByText('Your vault would remain liquidatable after this liquidation.')).not.toBeNull()
	})

	test('does not use target dispute-staked REP to make the caller appear healthy', async () => {
		const renderedComponent = await renderLiquidationModal({
			callerVaultSummary: createTargetVaultSummary({
				disputeStakedRepAttoRep: 0n,
				vaultRepBackingAttoRep: 23n * ETH,
				coverageCommitmentAttoEth: 0n,
				vaultAddress: defaultCallerVaultAddress,
			}),
			currentPoolOracleManagerDetails: createOracleManagerDetails({ isPriceValid: true, lastPrice: ETH }),
			coverageCommitmentTransferEthAmount: '50',
			selectedPool: createSelectedPool({ statoblastSecurityMultiplierBps: 20_000n }),
			targetVaultSummary: createTargetVaultSummary({
				disputeStakedRepAttoRep: 100n * ETH,
				vaultRepBackingAttoRep: 100n * ETH,
				coverageCommitmentAttoEth: 100n * ETH,
				vaultAddress: defaultTargetVaultAddress,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement

		expect(executeButton.disabled).toBe(true)
		expect(documentQueries.getByText('Your vault would become liquidatable after this liquidation.')).not.toBeNull()
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

	test('shows a warning and disables liquidation when caller and target vaults are the same', async () => {
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: vaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '1',
			liquidationTargetVault: vaultAddress,
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
				vaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 5n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
				vaultAddress,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(executeButton.disabled).toBe(true)
		expect(documentQueries.getByRole('heading', { name: 'Invalid Liquidation Pair' })).not.toBeNull()
		expect(document.body.querySelector('.warning-surface')).not.toBeNull()
		expect(document.body.querySelector('.badge.warn')).toBeNull()
		expect(documentQueries.getAllByText('Select a target vault that is different from your vault.')).toHaveLength(2)
	})

	test('shows the caller vault and a post-liquidation simulation', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '2',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 5n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Your Vault')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: `Copy address ${callerVaultAddress}` })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Caller Vault After Liquidation' })).toBeNull()
		expect(documentQueries.getByText('Your vault REP backing after')).not.toBeNull()
		expect(documentQueries.getByText('Your coverage commitment after')).not.toBeNull()
		expect(documentQueries.getByText('REP backing transferred')).not.toBeNull()
	})

	test('shows only the fully funded award and the residual bad debt for a maximum liquidation', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '2',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 2n * 10n ** 18n,
				coverageCommitmentAttoEth: 2n * 10n ** 18n,
				claimableFeesAttoEth: 25n * 10n ** 16n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const repMovedLabel = Array.from(document.body.querySelectorAll('.transaction-review-row > span')).find(element => element.textContent === 'REP backing transferred')
		if (!(repMovedLabel instanceof HTMLElement)) throw new Error('Expected REP backing transferred label')
		const repMovedValue = repMovedLabel.nextElementSibling
		if (!(repMovedValue instanceof HTMLElement)) throw new Error('Expected Rep Moved value')

		expect(repMovedValue.textContent).toBe('≈ 2.00 REP')
		expect(getTransactionReviewValue('Gross REP Award (Includes 5%)')).toBe('≈ 2.00 REP')
		expect(getTransactionReviewValue('Residual Bad Debt Recorded')).toBe('≈ 1.81 ETH')
		expect(getTransactionReviewValue('Target Accrued Fees Retained')).toBe('≈ 0.25 ETH')
	})

	test('allows execution when the entered amount exceeds the executable cap because execution will clamp it', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '100',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 2_000n * 10n ** 18n,
				coverageCommitmentAttoEth: 0n,
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 100n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const executeButton = within(document.body).getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(executeButton.disabled).toBe(false)
	})

	test('allows execution when the entered amount would leave dust before the executable cap clamp', async () => {
		const callerVaultAddress = getAddress('0x0000000000000000000000000000000000000001')
		const renderedComponent = await renderLiquidationModal({
			accountAddress: callerVaultAddress,
			currentPoolOracleManagerDetails: createOracleManagerDetails({
				isPriceValid: true,
				lastPrice: 10n * 10n ** 18n,
			}),
			coverageCommitmentTransferEthAmount: '99.6',
			selectedPool: createSelectedPool({
				statoblastSecurityMultiplierBps: 20_000n,
			}),
			callerVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 2_000n * 10n ** 18n,
				coverageCommitmentAttoEth: 0n,
				vaultAddress: callerVaultAddress,
			}),
			targetVaultSummary: createTargetVaultSummary({
				vaultRepBackingAttoRep: 100n * 10n ** 18n,
				coverageCommitmentAttoEth: 100n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const executeButton = within(document.body).getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(executeButton.disabled).toBe(false)
		expect(document.body.textContent?.includes('The target vault would fall below the minimum coverage commitment after liquidation.')).toBe(false)
		const coverageCommitmentAssumedLabel = Array.from(document.body.querySelectorAll('.transaction-review-row > span')).find(element => element.textContent === 'Coverage commitment assumed')
		if (!(coverageCommitmentAssumedLabel instanceof HTMLElement)) throw new Error('Expected Coverage commitment assumed label')
		expect(coverageCommitmentAssumedLabel.nextElementSibling?.textContent).toBe('≈ 8.57 ETH')
	})

	test('uses simulation labels for mock prices and clamps the preview once the entered amount exceeds the executable cap', async () => {
		function LiquidationSimulationHarness() {
			const [coverageCommitmentTransferEthAmount, setLiquidationAmount] = useState('5000')

			return (
				<LiquidationModal
					accountAddress={defaultCallerVaultAddress}
					closeLiquidationModal={() => undefined}
					currentPoolOracleManagerDetails={createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					})}
					isOnActiveAppChain
					coverageCommitmentTransferEthAmount={coverageCommitmentTransferEthAmount}
					maximumCoverageCommitmentTransferAttoEth={2_500n * 10n ** 18n}
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
						lastOraclePrice: 3n * 10n ** 18n,
						statoblastSecurityMultiplierBps: 20_000n,
					})}
					securityPoolOverviewActiveAction={undefined}
					securityPoolLiquidationError={undefined}
					securityPoolOverviewResult={undefined}
					callerVaultSummary={createTargetVaultSummary({
						vaultRepBackingAttoRep: 30_000n * 10n ** 18n,
						coverageCommitmentAttoEth: 1_000n * 10n ** 18n,
						vaultAddress: defaultCallerVaultAddress,
					})}
					targetVaultSummary={createTargetVaultSummary({
						vaultRepBackingAttoRep: 1840n * 10n ** 18n,
						coverageCommitmentAttoEth: 2_500n * 10n ** 18n,
						vaultAddress: defaultTargetVaultAddress,
					})}
				/>
			)
		}

		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<LiquidationSimulationHarness />, container)
		})

		const documentQueries = within(document.body)
		const amountInput = container.querySelector("input[placeholder='0.0']")
		if (!(amountInput instanceof HTMLInputElement)) throw new Error('Expected liquidation amount input')

		const executeButton = documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement
		expect(executeButton.disabled).toBe(false)
		expect(documentQueries.getByText(/Simulation REP \/ ETH/)).not.toBeNull()
		const repMovedLabel = Array.from(document.body.querySelectorAll('.transaction-review-row > span')).find(element => element.textContent === 'REP backing transferred')
		if (!(repMovedLabel instanceof HTMLElement)) throw new Error('Expected REP backing transferred label')
		const repMovedValueBefore = repMovedLabel.nextElementSibling
		if (!(repMovedValueBefore instanceof HTMLElement)) throw new Error('Expected Rep Moved value')
		const clampedPreviewText = repMovedValueBefore.textContent
		const coverageCommitmentAssumedLabel = Array.from(document.body.querySelectorAll('.transaction-review-row > span')).find(element => element.textContent === 'Coverage commitment assumed')
		if (!(coverageCommitmentAssumedLabel instanceof HTMLElement)) throw new Error('Expected Coverage commitment assumed label')
		const coverageCommitmentAssumedValue = coverageCommitmentAssumedLabel.nextElementSibling
		if (!(coverageCommitmentAssumedValue instanceof HTMLElement)) throw new Error('Expected Coverage commitment assumed value')
		expect(coverageCommitmentAssumedValue.textContent).toBe('≈ 584.13 ETH')

		await act(() => {
			fireEvent.input(amountInput, { target: { value: '2500' } })
		})

		const repMovedValueAfter = repMovedLabel.nextElementSibling
		if (!(repMovedValueAfter instanceof HTMLElement)) throw new Error('Expected Rep Moved value after input')
		expect(repMovedValueAfter.textContent).toBe(clampedPreviewText)
		expect(coverageCommitmentAssumedValue.textContent).toBe('≈ 584.13 ETH')

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
		expect(documentQueries.getByText(/Uniswap V4 REP \/ ETH/)).not.toBeNull()

		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const renderedV3Component = await renderLiquidationModal({
			repPerEthSource: 'v3',
			repPerEthSourceUrl: 'https://example.com/uniswap-v3',
		})
		cleanupRenderedComponent = renderedV3Component.cleanup

		documentQueries = within(document.body)
		expect(documentQueries.getByText(/Uniswap V3 REP \/ ETH/)).not.toBeNull()
	})

	test('coverage commitment', async () => {
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
				disputeStakedRepAttoRep: 4n * 10n ** 18n,
				vaultRepBackingAttoRep: 16n * 10n ** 18n,
				coverageCommitmentAttoEth: 10n * 10n ** 18n,
			}),
		})
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('button', { name: 'Execute vault liquidation' }) as HTMLButtonElement).disabled).toBe(true)
		expect(documentQueries.getByText('This vault is not undercollateralized at the current Open Oracle price.')).not.toBeNull()
		expect(documentQueries.getByText('Target coverage commitment')).not.toBeNull()
		expect(documentQueries.getByText('Target vault REP backing')).not.toBeNull()
		expect(documentQueries.getByText('Target dispute-staked REP')).not.toBeNull()
		expect(documentQueries.queryByText(/Collateralization/)).toBeNull()
		expect(documentQueries.queryByText('Below target')).toBeNull()
	})

	test('shows refreshing status while the modal is loading Open Oracle validity', async () => {
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
		expect(documentQueries.getByRole('dialog', { name: 'Liquidate Vault' })).not.toBeNull()
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
})
