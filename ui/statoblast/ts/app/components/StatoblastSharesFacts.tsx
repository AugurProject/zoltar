import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'
import * as poolCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolPage.js'
import { buildStatoblastCalendarEvent, downloadStatoblastCalendarEvent, LAST_CALENDAR_START } from '@zoltar/ui-statoblast-shared/features/reporting/lib/escalationReminder.js'
import { collateralPresentation } from '@zoltar/ui-statoblast-shared/protocol/collateral.js'
import type { loadStatoblastQuestion } from '@zoltar/ui-statoblast-shared/protocol/questionLedgers.js'
import type { ListedQuestionLedger } from '@zoltar/ui-statoblast-shared/types/contracts.js'

export function StatoblastSharesFacts({ question, facts, now }: { question: ListedQuestionLedger; facts: Awaited<ReturnType<typeof loadStatoblastQuestion>>['sharesFacts']; now: bigint | undefined }) {
	const token = collateralPresentation(facts?.collateral)
	const expires = question.oraclePriceValidUntilTimestamp
	const priceCurrent = expires !== undefined && now !== undefined && now < expires
	const opensAt = question.marketDetails.endTime
	const canAddReminder = now !== undefined && now < opensAt && opensAt <= LAST_CALENDAR_START && !question.universeHasForked
	const addReminder = () => {
		const calendar = buildStatoblastCalendarEvent({ id: `${question.questionLedgerAddress}-opens-${opensAt}`, generatedAt: BigInt(Math.floor(Date.now() / 1000)), startsAt: opensAt, title: copy.reportingOpensReminder(question.marketDetails.title), description: location.href })
		downloadStatoblastCalendarEvent(calendar, 'statoblast-reporting.ics')
	}
	return (
		<div className='statoblast-pool-facts'>
			<MetricField label={copy.reportingOpens}>
				<TimestampValue timestamp={opensAt} relative={false} />
				{canAddReminder ? (
					<button className='quiet' type='button' onClick={addReminder}>
						{copy.addToCalendar}
					</button>
				) : undefined}
			</MetricField>
			<MetricField label={copy.capacityFree}>
				<CurrencyValue value={facts?.capacity} suffix={token.symbol} units={token.decimals} />
			</MetricField>
			<MetricField label={poolCopy.poolTabLabels.price}>
				<Badge tone={priceCurrent ? 'ok' : 'muted'}>{priceCurrent ? copy.currentPrice : copy.priceNeeded}</Badge>
			</MetricField>
			<MetricField label={poolCopy.holdingFee}>{facts?.annualFeeBps === undefined ? undefined : poolCopy.formatAnnualFee(formatUnits(facts.annualFeeBps, 2))}</MetricField>
			<MetricField label={poolCopy.purchaseFee}>
				{facts?.purchaseFeeBps === undefined ? undefined : (
					<>
						{formatUnits(facts.purchaseFeeBps, 2)}
						{poolCopy.minimumFeeTail}
						<CurrencyValue value={facts.minimumPurchaseFee} suffix={token.symbol} units={token.decimals} />)
					</>
				)}
			</MetricField>
		</div>
	)
}
