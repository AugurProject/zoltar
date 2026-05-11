import { useEffect, useRef } from 'preact/hooks'
import type { Address } from 'viem'
import { AddressInfo } from './AddressInfo.js'
import { DataGrid } from './DataGrid.js'
import { FormInput } from './FormInput.js'
import { TransactionActionButton } from './TransactionActionButton.js'

type LiquidationModalProps = {
	accountAddress: Address | undefined
	closeLiquidationModal: () => void
	isMainnet: boolean
	liquidationAmount: string
	liquidationManagerAddress: Address | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	securityPoolOverviewActiveAction: 'queueLiquidation' | undefined
	liquidationTargetVault: string
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTargetVaultChange: (value: string) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
}

export function LiquidationModal({
	accountAddress,
	closeLiquidationModal,
	isMainnet,
	liquidationAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	securityPoolOverviewActiveAction,
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
							<FormInput value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} />
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
