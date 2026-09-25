import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { OutcomeChipRow } from '@zoltar/ui-core-shared/components/OutcomeChipRow.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { tryParseTimestampInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { formatRelativeTimestamp, formatTimestampDateTime, getWallClockTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import type { ComponentChildren, ComponentProps } from 'preact'
import type { MarketFormState } from '../../../types/app.js'
import { formatLocalAndUtcTimestamp } from '../lib/questionTimeZone.js'

type QuestionDraftPreviewProps = {
	children?: ComponentChildren
	currentTimestamp: bigint | undefined
	description: string | undefined
	endTime: string
	marketType: MarketFormState['marketType']
	outcomeItems: ComponentProps<typeof OutcomeChipRow>['items']
	startTime: string
	timeZone: string
	title: string
}

type DraftTimestampProps = {
	currentTimestamp: bigint | undefined
	emptyValue: string
	label: string
	timeZone: string
	value: string
}

function DraftTimestamp({ currentTimestamp, emptyValue, label, timeZone, value }: DraftTimestampProps) {
	const timestamp = value.trim() === '' ? undefined : tryParseTimestampInput(value)
	const formatted = timestamp === undefined ? undefined : formatLocalAndUtcTimestamp(timestamp, timeZone)
	const dateTime = timestamp === undefined ? undefined : formatTimestampDateTime(timestamp)
	return (
		<div className='question-draft-preview-meta-item' role='listitem'>
			<span className='question-draft-preview-meta-label'>{label}</span>
			{(() => {
				if (value.trim() === '') return <strong>{emptyValue}</strong>
				if (timestamp === undefined || formatted === undefined) return <strong>{value}</strong>
				return (
					<>
						<strong>
							<time dateTime={dateTime}>{formatted.local}</time> <span className='question-draft-preview-zone'>{formatted.zoneLabel}</span>
						</strong>
						<span className='question-draft-preview-secondary'>
							{formatted.zoneLabel === 'UTC' ? undefined : <span>{formatted.utc}</span>}
							<span>({formatRelativeTimestamp(timestamp, currentTimestamp ?? getWallClockTimestamp())})</span>
						</span>
					</>
				)
			})()}
		</div>
	)
}

/** Read-only summary of the draft, showing each time in the user's zone and in UTC. */
export function QuestionDraftPreview({ children, currentTimestamp, description, endTime, marketType, outcomeItems, startTime, timeZone, title }: QuestionDraftPreviewProps) {
	return (
		<aside aria-label={marketCopy.draftPreviewLabel} className='question-create-preview'>
			<SectionBlock headingLevel={4} title={marketCopy.draftPreview} variant='plain'>
				<div className='question-draft-preview'>
					<div className='question-draft-preview-header'>
						<div className='question-summary-heading'>
							<strong>{title}</strong>
							{description === undefined ? undefined : <p className='detail'>{description}</p>}
						</div>
						<span className='question-draft-preview-chip'>{getMarketTypeLabel(marketType)}</span>
					</div>
					<OutcomeChipRow items={outcomeItems} />
					<div className='question-draft-preview-meta' role='list' aria-label={marketCopy.draftQuestionSummary}>
						<DraftTimestamp currentTimestamp={currentTimestamp} emptyValue={marketCopy.immediatelyAfterCreation} label={commonCopy.starts} timeZone={timeZone} value={startTime} />
						<DraftTimestamp currentTimestamp={currentTimestamp} emptyValue={marketCopy.endTimeRequired} label={commonCopy.ends} timeZone={timeZone} value={endTime} />
					</div>
				</div>
			</SectionBlock>
			{children}
		</aside>
	)
}
