import { CurrencyValue } from './CurrencyValue.js'
import type { EscalationDeposit } from '../types/contracts.js'

type EscalationSideDisplay = {
	balance: bigint | undefined
	label: string
	userDeposits: EscalationDeposit[] | undefined
	userStake: bigint | undefined
}

type EscalationSideProps = {
	bindingCapital: bigint | undefined
	chartScaleMax: bigint
	disabled?: boolean
	isLeading: boolean
	isSelected: boolean
	onSelect: () => void
	side: EscalationSideDisplay
}

function getChartRatio(value: bigint | undefined, maxValue: bigint) {
	if (value === undefined || value <= 0n || maxValue <= 0n) return '0%'

	const basisPoints = (value * 10000n) / maxValue
	const wholePercent = basisPoints / 100n
	const fractionalPercent = (basisPoints % 100n).toString().padStart(2, '0')

	return `${wholePercent.toString()}.${fractionalPercent}%`
}

export function EscalationSide({ bindingCapital, chartScaleMax, disabled = false, isLeading, isSelected, onSelect, side }: EscalationSideProps) {
	return (
		<button
			aria-pressed={isSelected}
			className={`escalation-side ${isSelected ? 'selected' : ''} ${isLeading ? 'leading' : ''}`}
			disabled={disabled}
			onClick={onSelect}
			style={{
				'--binding-ratio': getChartRatio(bindingCapital, chartScaleMax),
				'--side-ratio': getChartRatio(side.balance, chartScaleMax),
				'--user-ratio': getChartRatio(side.userStake, chartScaleMax),
			}}
			type='button'
		>
			<div className='escalation-side-row'>
				<div className='escalation-side-copy'>
					<div className='escalation-side-title-row'>
						<span className='panel-label'>{side.label}</span>
						{isLeading || isSelected ? (
							<div className='escalation-side-badges'>
								{isSelected ? <span className='badge escalation-side-selected-badge'>Selected</span> : undefined}
								{isLeading ? <span className='badge ok'>Leading</span> : undefined}
							</div>
						) : undefined}
					</div>
				</div>
				<div aria-hidden='true' className='escalation-side-chart'>
					<div className='escalation-side-track'>
						<div className='escalation-side-total-bar' />
						<div className='escalation-side-user-bar' />
						<div className='escalation-side-binding-marker' />
					</div>
				</div>
				<div className='escalation-side-values'>
					<div className='escalation-side-value'>
						<span className='metric-label'>Total stake</span>
						<CurrencyValue copyable={false} value={side.balance} suffix='REP' />
					</div>
					<div className='escalation-side-value'>
						<span className='metric-label'>Your stake</span>
						<CurrencyValue copyable={false} value={side.userStake} suffix='REP' />
					</div>
				</div>
			</div>
		</button>
	)
}
