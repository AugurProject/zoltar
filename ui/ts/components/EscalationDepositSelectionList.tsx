import type { ComponentChildren } from 'preact'
import type { EscalationDeposit } from '../types/contracts.js'

type EscalationDepositSelectionItem = {
	deposit: EscalationDeposit
	details: ComponentChildren[]
}

type EscalationDepositSelectionListProps = {
	disabled?: boolean
	items: EscalationDepositSelectionItem[]
	onSelectionChange: (selectedDepositIndexes: bigint[]) => void
	selectedDepositIndexes: bigint[]
}

export function EscalationDepositSelectionList({ disabled = false, items, onSelectionChange, selectedDepositIndexes }: EscalationDepositSelectionListProps) {
	return (
		<div className='withdraw-deposit-list'>
			{items.map(item => {
				const { deposit, details } = item
				const isChecked = selectedDepositIndexes.includes(deposit.depositIndex)

				return (
					<label key={deposit.depositIndex.toString()} className='withdraw-deposit-option'>
						<input
							type='checkbox'
							checked={isChecked}
							disabled={disabled}
							onChange={event => {
								const nextSelectedDepositIndexes = event.currentTarget.checked ? [...selectedDepositIndexes, deposit.depositIndex] : selectedDepositIndexes.filter(index => index !== deposit.depositIndex)
								onSelectionChange(nextSelectedDepositIndexes)
							}}
						/>
						<span className='withdraw-deposit-copy'>
							<strong>Deposit #{deposit.depositIndex.toString()}</strong>
							{details.map((detail, detailIndex) => (
								<span key={`${deposit.depositIndex.toString()}:${detailIndex.toString()}`}>{detail}</span>
							))}
						</span>
					</label>
				)
			})}
		</div>
	)
}
