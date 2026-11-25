import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as copy from '../../../copy/reporting.js'
import type { ReportingDetails } from '../../../types/contracts.js'
import { RepAmount } from './RepAmount.js'
import { getKnownReportingClaimAmount, isPoolQuestionFinalized } from '../lib/reportingDomain.js'
import { getReportingOutcomeLabel } from '../lib/reporting.js'

export function ReportingResultCard({ details }: { details: ReportingDetails | undefined }) {
	if (!isPoolQuestionFinalized(details) || details === undefined || details.questionOutcome === 'none') return undefined
	const amount = getKnownReportingClaimAmount(details)
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
					{amount > 0n ? copy.resultClaim(<RepAmount value={amount} />) : undefined}
				</>
			}
		/>
	)
}
