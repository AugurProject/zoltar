import { useState } from 'preact/hooks'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { formatRelativeTimestamp, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import { normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { getForkEligibleQuestions } from '../lib/forkChecklist.js'

const MAX_VISIBLE_QUESTIONS = 8

type ForkQuestionPickerProps = {
	currentTimestamp: bigint | undefined
	disabled: boolean
	loading: boolean
	loadError: string | undefined
	onRetry: (() => void) | undefined
	onSelect: (questionId: string) => void
	questions: readonly MarketDetails[]
	selectedQuestionId: string | undefined
}

/** Lists only the loaded questions that can fork the universe now, searchable by title. */
export function ForkQuestionPicker({ currentTimestamp, disabled, loading, loadError, onRetry, onSelect, questions, selectedQuestionId }: ForkQuestionPickerProps) {
	const [searchText, setSearchText] = useState('')
	const eligibleQuestions = getForkEligibleQuestions(questions, currentTimestamp)
	const matchingQuestions = getForkEligibleQuestions(questions, currentTimestamp, searchText)
	const visibleQuestions = matchingQuestions.slice(0, MAX_VISIBLE_QUESTIONS)
	const waitingForData = (loading && questions.length === 0) || currentTimestamp === undefined
	const renderList = () => {
		if (loadError !== undefined) return undefined
		if (waitingForData) return <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: zoltarCopy.forkQuestionsLoading }} />
		if (eligibleQuestions.length === 0) return <EmptyState title={zoltarCopy.forkEligibleQuestionsEmpty} detail={zoltarCopy.forkEligibleQuestionsEmptyDetail} />
		if (matchingQuestions.length === 0) return <p className='detail'>{zoltarCopy.forkEligibleQuestionsNoMatches}</p>
		return (
			<>
				<OutcomeSelectionList
					className='fork-question-picker-list'
					items={visibleQuestions.map(question => ({
						details: (
							<>
								<Badge tone='muted'>{getMarketTypeLabel(question.marketType)}</Badge>
								<span className='detail' title={formatTimestamp(question.endTime)}>
									{zoltarCopy.formatEndedAt(formatRelativeTimestamp(question.endTime, currentTimestamp))}
								</span>
							</>
						),
						disabled,
						key: question.questionId,
						label: getQuestionTitle(question),
						onSelect: () => onSelect(question.questionId),
						selected: selectedQuestionId !== undefined && normalizeQuestionId(question.questionId) === selectedQuestionId,
					}))}
				/>
				{matchingQuestions.length > visibleQuestions.length ? <p className='detail'>{zoltarCopy.formatForkEligibleQuestionsTruncated(visibleQuestions.length, matchingQuestions.length)}</p> : undefined}
			</>
		)
	}
	return (
		<div className='fork-question-picker'>
			{eligibleQuestions.length === 0 ? undefined : (
				<label className='field'>
					<span>{zoltarCopy.searchEndedQuestions}</span>
					<FormInput disabled={disabled} onInput={event => setSearchText(event.currentTarget.value)} placeholder={zoltarCopy.forkQuestionSearchPlaceholder} type='search' value={searchText} />
				</label>
			)}
			<ErrorNotice message={loadError} />
			{loadError === undefined || onRetry === undefined ? undefined : (
				<div className='actions'>
					<button className='secondary' disabled={loading} onClick={onRetry} type='button'>
						{loading ? commonCopy.retrying : commonCopy.retry}
					</button>
				</div>
			)}
			{renderList()}
		</div>
	)
}
