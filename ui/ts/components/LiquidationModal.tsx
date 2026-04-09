import { useEffect } from 'preact/hooks'
import type { Address } from 'viem'
import { AddressInfo } from './AddressInfo.js'

type LiquidationModalProps = {
	accountAddress: Address | undefined
	closeLiquidationModal: () => void
	isMainnet: boolean
	liquidationAmount: string
	liquidationManagerAddress: Address | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTargetVault: string
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTargetVaultChange: (value: string) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
}

export function LiquidationModal({ accountAddress, closeLiquidationModal, isMainnet, liquidationAmount, liquidationManagerAddress, liquidationModalOpen, liquidationSecurityPoolAddress, liquidationTargetVault, onLiquidationAmountChange, onLiquidationTargetVaultChange, onQueueLiquidation }: LiquidationModalProps) {
	useEffect(() => {
		if (!liquidationModalOpen) return
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') closeLiquidationModal()
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => {
			document.removeEventListener('keydown', handleKeyDown)
		}
	}, [liquidationModalOpen, closeLiquidationModal])

	if (!liquidationModalOpen) return undefined

	return (
		<div className='modal-backdrop' role='presentation' onClick={closeLiquidationModal}>
			<section className='modal-panel' role='dialog' aria-modal='true' aria-labelledby='liquidation-modal-title' onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div>
						<p className='panel-label'>Liquidation</p>
						<h3 id='liquidation-modal-title'>Queue a vault liquidation</h3>
					</div>
					<button className='quiet' onClick={closeLiquidationModal}>
						Close
					</button>
				</div>
				<p className='detail'>The selected vault is prefilled here. Adjust the target or amount if needed, then queue the liquidation transaction.</p>
				<div className='modal-summary-grid'>
					<AddressInfo address={liquidationSecurityPoolAddress} label='Security Pool' />
					<AddressInfo address={liquidationManagerAddress} label='Manager' />
				</div>
				<div className='form-grid'>
					<div className='field-row'>
						<label className='field'>
							<span>Target Vault</span>
							<input value={liquidationTargetVault} onInput={event => onLiquidationTargetVaultChange(event.currentTarget.value)} placeholder='0x...' />
						</label>
						<label className='field'>
							<span>Liquidation Amount</span>
							<input value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} />
						</label>
					</div>
				</div>
				<div className='actions'>
					<button className='secondary' onClick={closeLiquidationModal}>
						Cancel
					</button>
					<button
						className='primary'
						onClick={() => {
							if (liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined) return
							onQueueLiquidation(liquidationManagerAddress, liquidationSecurityPoolAddress)
						}}
						disabled={accountAddress === undefined || !isMainnet || liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined}
					>
						Queue Liquidation
					</button>
				</div>
			</section>
		</div>
	)
}
