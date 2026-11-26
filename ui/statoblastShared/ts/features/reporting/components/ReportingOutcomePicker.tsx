import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { useId } from 'preact/hooks'
import * as reportingCopy from '../../../copy/reporting.js'
import type { ReportingDetails } from '../../../types/contracts.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../lib/reporting.js'
import { getReportingMinimumOutcomeChangeContribution, reportingContributionTriggersFork } from '../lib/reportingDomain.js'
import { RepAmount } from './RepAmount.js'

type EscalationSideDisplay = {
	balance: bigint | undefined
	key: ReportingOutcomeKey
	label: string
	userStake: bigint | undefined
}
const outcomeOrder = { yes: 0, no: 1, invalid: 2 } satisfies Record<ReportingOutcomeKey, number>

export function getOutcomeSides(reportingDetails: ReportingDetails | undefined) {
	if (reportingDetails?.status === 'active')
		return reportingDetails.sides.map<EscalationSideDisplay>(side => ({
			balance: side.balance,
			key: side.key,
			label: side.label,
			userStake: (side.localPrincipalAttoRep ?? side.userDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n)) + side.importedUserDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n),
		}))
	if (reportingDetails?.status === 'not-started')
		return REPORTING_OUTCOME_DROPDOWN_OPTIONS.map<EscalationSideDisplay>(option => ({
			balance: 0n,
			key: option.value,
			label: option.label,
			userStake: 0n,
		}))
	return REPORTING_OUTCOME_DROPDOWN_OPTIONS.map<EscalationSideDisplay>(option => ({
		balance: undefined,
		key: option.value,
		label: option.label,
		userStake: undefined,
	}))
}

export function ReportingOutcomePicker({
	sides,
	details,
	selectedOutcome,
	leadingOutcome,
	disabled,
	onSelect,
}: {
	sides: EscalationSideDisplay[]
	details: ReportingDetails | undefined
	selectedOutcome: ReportingOutcomeKey | undefined
	leadingOutcome: ReportingOutcomeKey | undefined
	disabled: boolean
	onSelect: (outcome: ReportingOutcomeKey) => void
}) {
	const group = useId()
	return (
		<fieldset className='statoblast-report-outcomes' disabled={disabled}>
			<legend>{reportingCopy.reportOutcomeChoice}</legend>
			{sides
				.toSorted((left, right) => outcomeOrder[left.key] - outcomeOrder[right.key])
				.map(side => {
					const leads = leadingOutcome === side.key
					const behind = leadingOutcome !== undefined && !leads && (side.userStake ?? 0n) > 0n
					const toLead = behind ? getReportingMinimumOutcomeChangeContribution(details, side.key).amountAttoRep : undefined
					const canLead = toLead !== undefined && toLead > 0n && !reportingContributionTriggersFork(details, side.key, toLead)
					return (
						<label className='statoblast-report-option' key={side.key}>
							<input type='radio' name={group} checked={selectedOutcome === side.key} onChange={() => onSelect(side.key)} />
							<span className='statoblast-report-option-label'>
								<strong>{side.label}</strong>
								<span className='detail'>
									<CurrencyValue value={side.balance} suffix={commonCopy.rep} /> {reportingCopy.outcomeRepStaked}
									{canLead ? (
										<>
											{' · '}
											<RepAmount rounding='up' value={toLead} /> {reportingCopy.outcomeRepToLead}
										</>
									) : undefined}
								</span>
							</span>
							{leads && <Badge tone='ok'>{reportingCopy.outcomeLeading}</Badge>}
							{behind && <Badge tone='muted'>{reportingCopy.outcomeBehind}</Badge>}
						</label>
					)
				})}
		</fieldset>
	)
}
