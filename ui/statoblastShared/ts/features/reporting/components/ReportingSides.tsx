import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ProgressMeter } from '@zoltar/ui-core-shared/components/ProgressMeter.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ReportingDetails, ReportingOutcomeKey, EscalationDeposit } from '@zoltar/ui-core-shared/types/contracts.js'
import { EscalationSide } from './EscalationSide.js'

export function ReportingSides({
	largestBalance,
	chartScaleMax,
	displayBindingCapital,
	finalized,
	outcomeSides,
	disabled,
	questionOutcome,
	leadingOutcome,
	selectedOutcome,
	onSelect,
}: {
	largestBalance: bigint
	chartScaleMax: bigint | undefined
	displayBindingCapital: bigint | undefined
	finalized: boolean
	outcomeSides: { key: ReportingOutcomeKey; label: string; balance: bigint | undefined; userDeposits: EscalationDeposit[] | undefined; userStake: bigint | undefined }[]
	disabled: boolean
	questionOutcome: ReportingDetails['questionOutcome'] | undefined
	leadingOutcome: ReportingOutcomeKey | undefined
	selectedOutcome: ReportingOutcomeKey | undefined
	onSelect: (outcome: ReportingOutcomeKey) => void
}) {
	return (
		<div className='escalation-sides-shell'>
			<ProgressMeter
				valueText={undefined}
				label={
					chartScaleMax === undefined
						? reportingCopy.progressToForkUnavailable
						: reportingCopy.progressToFork(formatCurrencyBalance(largestBalance), formatCurrencyBalance(chartScaleMax), largestBalance > 0n && chartScaleMax > largestBalance * 10000n ? '<0.01' : (chartScaleMax > 0n ? Number((largestBalance * 10000n) / chartScaleMax) / 100 : 0).toString())
				}
				value={largestBalance}
				maxValue={chartScaleMax ?? 0n}
				detail={reportingCopy.forkProgressHelp}
			/>
			<div className='escalation-sides-legend'>
				<div className='escalation-sides-legend-item'>
					<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-total' />
					<span className='panel-label'>{reportingCopy.totalSideDisputeStakedRep}</span>
				</div>
				<div className='escalation-sides-legend-item'>
					<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-user' />
					<span className='panel-label'>{reportingCopy.yourSideDisputeStakedRep}</span>
				</div>
				{!finalized && displayBindingCapital !== undefined && displayBindingCapital > 0n ? (
					<div className='escalation-sides-legend-item escalation-sides-legend-item-binding'>
						<span aria-hidden='true' className='escalation-sides-legend-marker' />
						<span className='panel-label'>{reportingCopy.leadHoldingCapital}</span>
						<CurrencyValue copyable={false} value={displayBindingCapital} suffix={commonCopy.rep} />
					</div>
				) : undefined}
			</div>
			{!finalized && displayBindingCapital !== undefined && displayBindingCapital > 0n ? <p className='detail'>{reportingCopy.bindingCapitalHelp}</p> : undefined}
			<div className='escalation-sides' role={finalized ? undefined : 'radiogroup'} aria-label={reportingCopy.reportOutcomeAriaLabel}>
				{outcomeSides.map((side, index) => (
					<EscalationSide
						key={side.key}
						bindingCapital={finalized ? undefined : displayBindingCapital}
						chartScaleMax={chartScaleMax ?? 1n}
						disabled={disabled}
						readOnly={finalized}
						isWinner={finalized && questionOutcome === side.key}
						isLeading={!finalized && leadingOutcome === side.key}
						isSelected={!finalized && selectedOutcome !== undefined && selectedOutcome === side.key}
						isTabStop={selectedOutcome === undefined ? index === 0 : selectedOutcome === side.key}
						onSelect={() => onSelect(side.key)}
						side={side}
					/>
				))}
			</div>
		</div>
	)
}
