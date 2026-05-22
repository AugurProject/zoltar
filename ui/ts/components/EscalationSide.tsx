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
	estimate:
		| {
				profit: bigint
				payout: bigint
		  }
		| undefined
	isLeading: boolean
	isSelected: boolean
	side: EscalationSideDisplay
}

function getChartRatio(value: bigint | undefined, maxValue: bigint) {
	if (value === undefined || value <= 0n || maxValue <= 0n) return '0%'

	const basisPoints = (value * 10000n) / maxValue
	const wholePercent = basisPoints / 100n
	const fractionalPercent = (basisPoints % 100n).toString().padStart(2, '0')

	return `${wholePercent.toString()}.${fractionalPercent}%`
}

export function EscalationSide({ bindingCapital, chartScaleMax, estimate, isLeading, isSelected, side }: EscalationSideProps) {
	const depositIndexes = side.userDeposits === undefined ? '—' : side.userDeposits.map(deposit => deposit.depositIndex.toString()).join(', ') || 'None'

	return (
		<div
			className={`escalation-side ${isSelected ? 'selected' : ''} ${isLeading ? 'leading' : ''}`}
			style={{
				'--binding-ratio': getChartRatio(bindingCapital, chartScaleMax),
				'--side-ratio': getChartRatio(side.balance, chartScaleMax),
				'--user-ratio': getChartRatio(side.userStake, chartScaleMax),
			}}
		>
			<div className='escalation-side-row'>
				<div className='escalation-side-copy'>
					<div className='escalation-side-title-row'>
						<span className='panel-label'>{side.label}</span>
						<div className='escalation-side-badges'>
							{isLeading ? <span className='badge ok'>Leading</span> : undefined}
							{isSelected ? <span className='badge escalation-side-selected-badge'>Selected</span> : undefined}
						</div>
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
			<p className='detail'>Your deposits: {depositIndexes}</p>
			<p className='detail'>
				Projected payout for current amount: <CurrencyValue copyable={false} value={estimate?.payout} suffix='REP' />
			</p>
			<p className='detail'>
				Projected profit if this side wins: <CurrencyValue copyable={false} value={estimate?.profit} suffix='REP' />
			</p>
		</div>
	)
}
