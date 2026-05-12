import { useEffect, useRef } from 'preact/hooks'
import type { Address } from 'viem'
import { AddressInfo } from './AddressInfo.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { TimestampValue } from './TimestampValue.js'
import { FormInput } from './FormInput.js'
import { MetricField } from './MetricField.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import type { ListedSecurityPool, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '../types/contracts.js'

type LiquidationModalProps = {
	accountAddress: Address | undefined
	closeLiquidationModal: () => void
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	isMainnet: boolean
	liquidationAmount: string
	liquidationMaxAmount: bigint | undefined
	liquidationManagerAddress: Address | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	loadingPoolOracleManager: boolean
	onSelectedPoolViewChange: (view: string | undefined) => void
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
	selectedPool: ListedSecurityPool | undefined
	securityPoolOverviewActiveAction: 'queueLiquidation' | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationTargetVault: string
	onLiquidationAmountChange: (value: string) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
}

function getLiquidationExecutionMode(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	return currentPoolOracleManagerDetails?.isPriceValid === true ? 'execute' : 'queue'
}

function getLiquidationModalTitle(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	return getLiquidationExecutionMode(currentPoolOracleManagerDetails) === 'execute' ? 'Execute Vault Liquidation' : 'Queue Vault Liquidation'
}

function getLiquidationButtonLabels(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	return getLiquidationExecutionMode(currentPoolOracleManagerDetails) === 'execute' ? { idle: 'Execute Liquidation', pending: 'Executing liquidation...' } : { idle: 'Queue Liquidation', pending: 'Queueing liquidation...' }
}

function getPoolOracleStatus(currentPoolOracleManagerDetails: OracleManagerDetails | undefined, selectedPool: ListedSecurityPool | undefined) {
	if (currentPoolOracleManagerDetails !== undefined) {
		if (currentPoolOracleManagerDetails.lastSettlementTimestamp === 0n) return 'No settled price'
		return currentPoolOracleManagerDetails.isPriceValid ? 'Valid' : 'Stale'
	}

	if ((selectedPool?.lastOracleSettlementTimestamp ?? 0n) === 0n) return 'No settled price'
	return 'Unknown validity'
}

function renderPriceSourceLabel(source: 'v4' | 'v3' | 'mock' | undefined, sourceUrl: string | undefined) {
	if (source === undefined) return 'Unavailable'
	const label = source === 'mock' ? 'MOCK' : source === 'v4' ? 'Uniswap V4' : 'Uniswap V3'
	if (sourceUrl === undefined) return label
	return (
		<a href={sourceUrl} target='_blank' rel='noreferrer'>
			{label}
		</a>
	)
}

export function LiquidationModal({
	accountAddress,
	closeLiquidationModal,
	currentPoolOracleManagerDetails,
	isMainnet,
	liquidationAmount,
	liquidationMaxAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	loadingPoolOracleManager,
	liquidationTargetVault,
	onSelectedPoolViewChange,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	selectedPool,
	securityPoolOverviewActiveAction,
	securityPoolOverviewResult,
	targetVaultSummary,
	onLiquidationAmountChange,
	onQueueLiquidation,
}: LiquidationModalProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const onCloseRef = useRef(closeLiquidationModal)

	useEffect(() => {
		onCloseRef.current = closeLiquidationModal
	}, [closeLiquidationModal])

	useEffect(() => {
		if (!liquidationModalOpen) return
		const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
		closeButtonRef.current?.focus()
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onCloseRef.current()
			if (event.key !== 'Tab') return
			const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")
			if (focusableElements === undefined || focusableElements.length === 0) return
			const firstElement = focusableElements[0]
			const lastElement = focusableElements[focusableElements.length - 1]
			if (!(document.activeElement instanceof HTMLElement)) return
			if (event.shiftKey && document.activeElement === firstElement) {
				event.preventDefault()
				lastElement?.focus()
				return
			}
			if (!event.shiftKey && document.activeElement === lastElement) {
				event.preventDefault()
				firstElement?.focus()
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => {
			document.removeEventListener('keydown', handleKeyDown)
			previouslyFocusedElement?.focus()
		}
	}, [liquidationModalOpen])

	if (!liquidationModalOpen) return undefined
	const poolOraclePrice = currentPoolOracleManagerDetails?.lastPrice ?? selectedPool?.lastOraclePrice
	const poolOracleSettlementTimestamp = currentPoolOracleManagerDetails?.lastSettlementTimestamp ?? selectedPool?.lastOracleSettlementTimestamp ?? 0n
	const poolOracleStatus = getPoolOracleStatus(currentPoolOracleManagerDetails, selectedPool)
	const poolOracleCollateralization = targetVaultSummary === undefined ? undefined : getVaultCollateralizationPercent(targetVaultSummary.repDepositShare, targetVaultSummary.securityBondAllowance, poolOraclePrice)
	const uniswapCollateralization = targetVaultSummary === undefined ? undefined : getVaultCollateralizationPercent(targetVaultSummary.repDepositShare, targetVaultSummary.securityBondAllowance, repPerEthPrice)
	const buttonLabels = getLiquidationButtonLabels(currentPoolOracleManagerDetails)
	const queueLiquidationReason =
		accountAddress === undefined
			? 'Connect a wallet before queueing liquidation.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before queueing liquidation.'
				: liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined
					? 'Reload the selected pool before queueing liquidation.'
					: liquidationTargetVault.trim() === ''
						? 'Select a target vault first.'
						: liquidationAmount.trim() === ''
							? 'Enter a liquidation amount.'
							: undefined

	const queuedLiquidationOperation =
		securityPoolOverviewResult?.action !== 'queueLiquidation' || currentPoolOracleManagerDetails?.pendingOperation?.operation !== 'liquidation' || currentPoolOracleManagerDetails.pendingOperation.targetVault !== liquidationTargetVault ? undefined : currentPoolOracleManagerDetails.pendingOperation
	const queuedLiquidationStatus =
		securityPoolOverviewResult?.action !== 'queueLiquidation'
			? undefined
			: securityPoolOverviewResult.stagedExecution !== undefined
				? securityPoolOverviewResult.stagedExecution.success
					? 'executed'
					: 'failed'
				: loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined
					? 'refreshing'
					: queuedLiquidationOperation !== undefined
						? 'queued'
						: currentPoolOracleManagerDetails.isPriceValid
							? 'executed'
							: 'missing'

	return (
		<div className='modal-backdrop' role='presentation' onClick={closeLiquidationModal}>
			<section ref={dialogRef} className='modal-panel' role='dialog' aria-modal='true' aria-labelledby='liquidation-modal-title' onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div>
						<h3 id='liquidation-modal-title'>{getLiquidationModalTitle(currentPoolOracleManagerDetails)}</h3>
					</div>
					<button ref={closeButtonRef} className='quiet' onClick={closeLiquidationModal}>
						Close
					</button>
				</div>
				{queuedLiquidationStatus === undefined ? null : queuedLiquidationStatus === 'queued' ? (
					queuedLiquidationOperation === undefined ? null : (
						<section className='entity-card compact'>
							<div className='entity-card-header'>
								<div>
									<h4>Liquidation Queued</h4>
								</div>
								<span className='badge warn'>Queued</span>
							</div>
							<div className='workflow-metric-grid'>
								<MetricField label='Staged Operation'>#{queuedLiquidationOperation.operationId.toString()}</MetricField>
								<MetricField label='Amount'>
									<CurrencyValue value={queuedLiquidationOperation.amount} />
								</MetricField>
							</div>
							<div className='actions'>
								<button className='secondary' type='button' onClick={() => onSelectedPoolViewChange('staged-operations')}>
									View In Staged Operations
								</button>
							</div>
						</section>
					)
				) : queuedLiquidationStatus === 'failed' ? (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Liquidation Failed</h4>
							</div>
							<span className='badge blocked'>Failed</span>
						</div>
						<p className='detail'>{securityPoolOverviewResult?.stagedExecution?.errorMessage ?? 'The oracle manager attempted the liquidation immediately, but the security pool rejected it.'}</p>
					</section>
				) : queuedLiquidationStatus === 'executed' ? (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Liquidation Executed</h4>
							</div>
							<span className='badge ok'>Executed</span>
						</div>
						<p className='detail'>A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.</p>
					</section>
				) : queuedLiquidationStatus === 'missing' ? (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Liquidation Submitted</h4>
							</div>
							<span className='badge warn'>Check State</span>
						</div>
						<p className='detail'>The transaction succeeded, but no matching staged operation is currently visible for this vault. Refresh staged operations to confirm the latest manager state.</p>
					</section>
				) : (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>Refreshing Liquidation State</h4>
							</div>
							<span className='badge muted'>Refreshing</span>
						</div>
						<p className='detail'>Refreshing the oracle manager to determine whether the liquidation was queued or executed immediately.</p>
					</section>
				)}
				<DataGrid className='modal-summary-grid' columns={2}>
					<AddressInfo address={liquidationSecurityPoolAddress} label='Security Pool' />
					<MetricField label='Target Vault'>{liquidationTargetVault.trim() === '' ? 'None selected' : liquidationTargetVault}</MetricField>
					<MetricField label='Open Oracle Price'>{poolOraclePrice === undefined || poolOracleSettlementTimestamp === 0n ? 'Unavailable' : <CurrencyValue value={poolOraclePrice} suffix='REP / ETH' copyable={false} />}</MetricField>
					<MetricField label='Open Oracle Status'>{poolOracleStatus}</MetricField>
					<MetricField label='Last Settlement'>{poolOracleSettlementTimestamp === 0n ? 'Never settled' : <TimestampValue timestamp={poolOracleSettlementTimestamp} />}</MetricField>
					<MetricField label='Collateralization @ Open Oracle'>{poolOracleCollateralization === undefined ? 'Unavailable' : <CurrencyValue value={poolOracleCollateralization} suffix='%' copyable={false} />}</MetricField>
					<MetricField label='Uniswap REP / ETH'>{repPerEthPrice === undefined ? 'Unavailable' : <CurrencyValue value={repPerEthPrice} suffix='REP / ETH' copyable={false} />}</MetricField>
					<MetricField label='Uniswap Source'>{renderPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}</MetricField>
					<MetricField label='Collateralization @ Uniswap'>{uniswapCollateralization === undefined ? 'Unavailable' : <CurrencyValue value={uniswapCollateralization} suffix='%' copyable={false} />}</MetricField>
				</DataGrid>
				<div className='form-grid'>
					<label className='field'>
						<span>Liquidation Amount (ETH)</span>
						<div className='field-inline'>
							<FormInput className='field-inline-input' value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} placeholder='0.0' />
							<button className='quiet field-inline-action' type='button' onClick={() => onLiquidationAmountChange(liquidationMaxAmount === undefined ? '' : formatCurrencyInputBalance(liquidationMaxAmount))} disabled={liquidationMaxAmount === undefined || liquidationMaxAmount <= 0n}>
								Max
							</button>
						</div>
					</label>
				</div>
				<div className='actions'>
					<button className='secondary' onClick={closeLiquidationModal}>
						Cancel
					</button>
					<TransactionActionButton
						idleLabel={buttonLabels.idle}
						pendingLabel={buttonLabels.pending}
						onClick={() => {
							if (liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined) return
							onQueueLiquidation(liquidationManagerAddress, liquidationSecurityPoolAddress)
						}}
						pending={securityPoolOverviewActiveAction === 'queueLiquidation'}
						availability={{ disabled: queueLiquidationReason !== undefined, reason: queueLiquidationReason }}
					/>
				</div>
			</section>
		</div>
	)
}
