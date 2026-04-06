import { CurrencyValue } from './CurrencyValue.js'
import type { EscalationSide as EscalationSideSummary } from '../types/contracts.js'

type EscalationSideProps = {
	estimate: {
		profit: bigint
		payout: bigint
	}
	isLeading: boolean
	isSelected: boolean
	side: EscalationSideSummary
	userStake: bigint
}

export function EscalationSide({ estimate, isLeading, isSelected, side, userStake }: EscalationSideProps) {
	return (
		<div className={`escalation-side ${isSelected ? 'selected' : ''} ${isLeading ? 'leading' : ''}`}>
			<div className='escalation-side-header'>
				<p className='panel-label'>{side.label}</p>
				{isLeading ? <span className='badge ok'>Leading</span> : undefined}
			</div>
			<p className='detail'>
				Total stake: <CurrencyValue value={side.balance} suffix='REP' />
			</p>
			<p className='detail'>
				Your stake: <CurrencyValue value={userStake} suffix='REP' />
			</p>
			<p className='detail'>Your deposits: {side.userDeposits.map(deposit => deposit.depositIndex.toString()).join(', ') || 'None'}</p>
			<p className='detail'>
				Projected payout for current amount: <CurrencyValue value={estimate.payout} suffix='REP' />
			</p>
			<p className='detail'>
				Projected profit if this side wins: <CurrencyValue value={estimate.profit} suffix='REP' />
			</p>
		</div>
	)
}
