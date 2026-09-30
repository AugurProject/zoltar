import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as copy from '../../../copy/reporting.js'
import type { ReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getEscalationDepositClaimAmount, getImportedEscalationDepositClaimAmount, isPoolQuestionFinalized } from '../lib/reportingDomain.js'
import { getReportingOutcomeLabel } from '../lib/reporting.js'

export function ReportingResultCard({ details }: { details: ReportingDetails | undefined }) {
	if (!isPoolQuestionFinalized(details) || details === undefined || details.questionOutcome === 'none') return undefined
	const amount =
		details.status === 'active'
			? details.sides.reduce(
					(sum, side) => sum + side.userDeposits.reduce((total, deposit) => total + (getEscalationDepositClaimAmount(details, side.key, deposit) ?? 0n), 0n) + side.importedUserDeposits.reduce((total, deposit) => total + (getImportedEscalationDepositClaimAmount(details, side.key, deposit) ?? 0n), 0n),
					0n,
				)
			: 0n
	const hasPositions = details.status === 'active' && details.sides.some(side => side.userDeposits.length > 0 || side.importedUserDeposits.length > 0)
	const winning = details.status === 'active' && details.sides.some(side => side.key === details.questionOutcome && (side.userDeposits.length > 0 || side.importedUserDeposits.length > 0))
	return (
		<UserMessage
			placement='page'
			className='reporting-result'
			tone={!hasPositions || winning ? 'success' : 'warning'}
			detail={
				<>
					<strong>{copy.resultSummary(getReportingOutcomeLabel(details.questionOutcome))}</strong>
					{amount > 0n ? copy.resultClaim(formatCurrencyBalance(amount)) : undefined}
				</>
			}
		/>
	)
}
