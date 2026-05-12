import { useEffect, useRef } from 'preact/hooks'
import type { Address } from 'viem'
import { AddressInfo } from './AddressInfo.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { FormInput } from './FormInput.js'
import { MetricField } from './MetricField.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import type { OracleManagerDetails, SecurityPoolOverviewActionResult } from '../types/contracts.js'

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
	securityPoolOverviewActiveAction: 'queueLiquidation' | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	liquidationTargetVault: string
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTargetVaultChange: (value: string) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
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
	securityPoolOverviewActiveAction,
	securityPoolOverviewResult,
	onLiquidationAmountChange,
	onLiquidationTargetVaultChange,
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
	const queueLiquidationReason =
		accountAddress === undefined
			? 'Connect a wallet before queueing liquidation.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before queueing liquidation.'
				: liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined
					? 'Reload the selected pool before queueing liquidation.'
					: liquidationTargetVault.trim() === ''
						? 'Enter the target vault address.'
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
						<h3 id='liquidation-modal-title'>Queue a vault liquidation</h3>
					</div>
					<button ref={closeButtonRef} className='quiet' onClick={closeLiquidationModal}>
						Close
					</button>
				</div>
				<p className='detail'>The selected vault is prefilled here. Adjust the target or amount if needed, then queue the liquidation transaction.</p>
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
					<AddressInfo address={liquidationManagerAddress} label='Manager' />
				</DataGrid>
				<div className='form-grid'>
					<div className='field-row'>
						<label className='field'>
							<span>Target Vault</span>
							<FormInput value={liquidationTargetVault} onInput={event => onLiquidationTargetVaultChange(event.currentTarget.value)} placeholder='0x...' />
						</label>
						<label className='field'>
							<span>Liquidation Amount</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} />
								<button className='quiet field-inline-action' type='button' onClick={() => onLiquidationAmountChange(liquidationMaxAmount?.toString() ?? '')} disabled={liquidationMaxAmount === undefined || liquidationMaxAmount <= 0n}>
									Max
								</button>
							</div>
						</label>
					</div>
				</div>
				<div className='actions'>
					<button className='secondary' onClick={closeLiquidationModal}>
						Cancel
					</button>
					<TransactionActionButton
						idleLabel='Queue Liquidation'
						pendingLabel='Queueing liquidation...'
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
