import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Address } from 'viem'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { EntityCard } from './EntityCard.js'
import { LoadingText } from './LoadingText.js'
import { Question } from './Question.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import { clampScalarTickIndex } from '../lib/scalarOutcome.js'
import type { MarketFormState } from '../types/app.js'
import type { MarketCreationResult, MarketDetails } from '../types/contracts.js'
import { ScalarCreatePreview, type ScalarCreatePreviewDetails } from './ScalarCreatePreview.js'

const MARKET_TYPE_OPTIONS: EnumDropdownOption<MarketFormState['marketType']>[] = [
	{ value: 'binary', label: 'Binary' },
	{ value: 'categorical', label: 'Categorical' },
	{ value: 'scalar', label: 'Scalar' },
]

type MarketCreateQuestionSectionProps = {
	accountAddress: Address | undefined
	hasForked: boolean
	isMainnet: boolean
	marketCreating: boolean
	marketError: string | undefined
	marketForm: MarketFormState
	marketResult: MarketCreationResult | undefined
	onCreateMarket: () => void
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onOpenForkTab: () => void
	onResetMarket: () => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	zoltarQuestions: MarketDetails[]
}

function getScalarCreatePreviewDetails(marketForm: MarketFormState): ScalarCreatePreviewDetails | undefined {
	if (marketForm.marketType !== 'scalar') return undefined
	try {
		const numTicks = parseBigIntInput(marketForm.numTicks, 'Number of ticks')
		const displayValueMin = parseBigIntInput(marketForm.displayValueMin, 'Display value min')
		const displayValueMax = parseBigIntInput(marketForm.displayValueMax, 'Display value max')
		if (numTicks <= 0n || displayValueMax <= displayValueMin) throw new Error('Invalid scalar parameters')
		return {
			answerUnit: marketForm.answerUnit.trim(),
			displayValueMax,
			displayValueMin,
			numTicks,
		}
	} catch {
		return undefined
	}
}

export function MarketCreateQuestionSection({ accountAddress, hasForked, isMainnet, marketCreating, marketError, marketForm, marketResult, onCreateMarket, onMarketFormChange, onOpenForkTab, onResetMarket, onUseQuestionForFork, onUseQuestionForPool, zoltarQuestions }: MarketCreateQuestionSectionProps) {
	const [scalarCreatePreviewTick, setScalarCreatePreviewTick] = useState('0')
	const selectedQuestionDetails = useMemo(() => (marketResult === undefined ? undefined : zoltarQuestions.find(question => question.questionId === marketResult.questionId)), [marketResult?.questionId, zoltarQuestions])
	const scalarCreatePreviewDetails = getScalarCreatePreviewDetails(marketForm)
	const selectedQuestionTitle = selectedQuestionDetails === undefined ? 'Question' : typeof selectedQuestionDetails.title !== 'string' || selectedQuestionDetails.title.trim() === '' ? 'Untitled question' : selectedQuestionDetails.title

	useEffect(() => {
		if (scalarCreatePreviewDetails === undefined) return
		const clampedTick = clampScalarTickIndex(BigInt(scalarCreatePreviewTick), scalarCreatePreviewDetails.numTicks).toString()
		if (clampedTick === scalarCreatePreviewTick) return
		setScalarCreatePreviewTick(clampedTick)
	}, [scalarCreatePreviewDetails?.numTicks, scalarCreatePreviewTick])

	return (
		<>
			{marketResult === undefined ? undefined : (
				<EntityCard
					title={selectedQuestionTitle}
					badge={<span className='badge ok'>{marketResult.marketType}</span>}
					actions={
						<div className='actions'>
							<button
								className='secondary'
								disabled={hasForked}
								onClick={() => {
									if (hasForked) return
									onUseQuestionForFork(marketResult.questionId)
									onOpenForkTab()
								}}
							>
								{hasForked ? 'Already Forked' : 'Use For Fork'}
							</button>
							<button className='secondary' onClick={() => onUseQuestionForPool(marketResult.questionId)} disabled={marketResult.marketType !== 'binary'}>
								Use For Create Pool
							</button>
							<button className='secondary' onClick={onResetMarket}>
								Create Another Question
							</button>
						</div>
					}
				>
					<div className='question-preview-body'>
						{selectedQuestionDetails === undefined ? <p className='detail'>Question details are not loaded yet.</p> : <Question question={selectedQuestionDetails} showTitle={false} />}
						<div>
							<span className='metric-label'>Creation transaction hash</span>
							<strong>
								<TransactionHashLink hash={marketResult.createQuestionHash} />
							</strong>
						</div>
					</div>
				</EntityCard>
			)}

			{marketResult === undefined ? (
				<EntityCard title='Create Question' badge={<span className='badge muted'>{marketForm.marketType}</span>}>
					<div className='form-grid'>
						<label className='field'>
							<span>Question Type</span>
							<EnumDropdown options={MARKET_TYPE_OPTIONS} value={marketForm.marketType} onChange={marketType => onMarketFormChange({ marketType })} />
						</label>

						<label className='field'>
							<span>Title</span>
							<input value={marketForm.title} onInput={event => onMarketFormChange({ title: event.currentTarget.value })} placeholder='Will event X happen?' />
						</label>

						<label className='field'>
							<span>Description</span>
							<textarea value={marketForm.description} onInput={event => onMarketFormChange({ description: event.currentTarget.value })} placeholder='Optional question context' />
						</label>

						<div className='field-row'>
							<label className='field'>
								<span>Start Time</span>
								<input type='datetime-local' value={marketForm.startTime} onInput={event => onMarketFormChange({ startTime: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>End Time</span>
								<input type='datetime-local' value={marketForm.endTime} onInput={event => onMarketFormChange({ endTime: event.currentTarget.value })} />
							</label>
						</div>

						{marketForm.marketType === 'categorical' ? (
							<label className='field'>
								<span>Outcome Labels</span>
								<textarea value={marketForm.categoricalOutcomes} onInput={event => onMarketFormChange({ categoricalOutcomes: event.currentTarget.value })} placeholder={'One outcome per line\nApple\nBanana\nCherry'} />
							</label>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<label className='field'>
									<span>Number Of Ticks</span>
									<input value={marketForm.numTicks} onInput={event => onMarketFormChange({ numTicks: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Answer Unit</span>
									<input value={marketForm.answerUnit} onInput={event => onMarketFormChange({ answerUnit: event.currentTarget.value })} placeholder='USD' />
								</label>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							<div className='field-row'>
								<label className='field'>
									<span>Display Value Min</span>
									<input value={marketForm.displayValueMin} onInput={event => onMarketFormChange({ displayValueMin: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Display Value Max</span>
									<input value={marketForm.displayValueMax} onInput={event => onMarketFormChange({ displayValueMax: event.currentTarget.value })} />
								</label>
							</div>
						) : undefined}

						{marketForm.marketType === 'scalar' ? (
							scalarCreatePreviewDetails === undefined ? (
								<p className='detail'>Enter valid scalar parameters to preview the tick slider.</p>
							) : (
								<ScalarCreatePreview details={scalarCreatePreviewDetails} selectedTick={scalarCreatePreviewTick} onSelectedTickChange={setScalarCreatePreviewTick} />
							)
						) : undefined}

						<div className='actions'>
							<button onClick={onCreateMarket} disabled={accountAddress === undefined || !isMainnet || marketCreating}>
								{marketCreating ? <LoadingText>Creating Question...</LoadingText> : 'Create Question'}
							</button>
						</div>
					</div>
				</EntityCard>
			) : undefined}

			{marketError === undefined ? undefined : <p className='notice error'>{marketError}</p>}
		</>
	)
}
