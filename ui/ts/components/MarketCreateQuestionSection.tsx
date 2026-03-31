import { useState } from 'preact/hooks'
import type { Address } from 'viem'
import { EntityCard } from './EntityCard.js'
import { QuestionSummary } from './QuestionSummary.js'
import { formatScalarOutcomeLabel, getScalarSliderProgress } from '../lib/scalarOutcome.js'
import { parseMarketTypeInput } from '../lib/inputs.js'
import { parseBigIntInput } from '../lib/marketForm.js'
import type { MarketFormState } from '../types/app.js'
import type { MarketCreationResult, MarketDetails } from '../types/contracts.js'

type ScalarCreatePreviewDetails = {
	answerUnit: string
	displayValueMax: bigint
	displayValueMin: bigint
	numTicks: bigint
}

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

export function MarketCreateQuestionSection({ accountAddress, hasForked, isMainnet, marketCreating, marketError, marketForm, marketResult, onCreateMarket, onMarketFormChange, onOpenForkTab, onUseQuestionForFork, onUseQuestionForPool, zoltarQuestions }: MarketCreateQuestionSectionProps) {
	const [scalarCreatePreviewTick, setScalarCreatePreviewTick] = useState('0')
	const scalarCreatePreviewDetails = getScalarCreatePreviewDetails(marketForm)
	const createScalarProgress = scalarCreatePreviewDetails === undefined ? 0 : getScalarSliderProgress(BigInt(scalarCreatePreviewTick), scalarCreatePreviewDetails.numTicks)
	const selectedQuestionDetails = marketResult === undefined ? undefined : zoltarQuestions.find(question => question.questionId === marketResult.questionId)

	return (
		<>
			{marketResult === undefined ? undefined : (
				<EntityCard
					title="Question Created"
					badge={<span className="badge ok">{marketResult.marketType}</span>}
					actions={
						<div className="actions">
							<button
								className="secondary"
								disabled={hasForked}
								onClick={() => {
									if (hasForked) return
									onUseQuestionForFork(marketResult.questionId)
									onOpenForkTab()
								}}
							>
								{hasForked ? 'Already Forked' : 'Use For Fork'}
							</button>
							<button className="secondary" onClick={() => onUseQuestionForPool(marketResult.questionId)} disabled={marketResult.marketType !== 'binary'}>
								Use For Create Pool
							</button>
						</div>
					}
				>
					<div className="question-preview-body">
						<QuestionSummary question={selectedQuestionDetails} />
						<div>
							<span className="metric-label">Creation Tx</span>
							<strong>{marketResult.createQuestionHash}</strong>
						</div>
					</div>
				</EntityCard>
			)}

			<EntityCard title="Create Question" badge={<span className="badge muted">{marketForm.marketType}</span>}>
				<div className="form-grid">
					<label className="field">
						<span>Question Type</span>
						<select value={marketForm.marketType} onInput={event => onMarketFormChange({ marketType: parseMarketTypeInput(event.currentTarget.value) })}>
							<option value="binary">Binary</option>
							<option value="categorical">Categorical</option>
							<option value="scalar">Scalar</option>
						</select>
					</label>

					<label className="field">
						<span>Title</span>
						<input value={marketForm.title} onInput={event => onMarketFormChange({ title: event.currentTarget.value })} placeholder="Will event X happen?" />
					</label>

					<label className="field">
						<span>Description</span>
						<textarea value={marketForm.description} onInput={event => onMarketFormChange({ description: event.currentTarget.value })} placeholder="Optional question context" />
					</label>

					<div className="field-row">
						<label className="field">
							<span>Start Time</span>
							<input type="datetime-local" value={marketForm.startTime} onInput={event => onMarketFormChange({ startTime: event.currentTarget.value })} />
						</label>
						<label className="field">
							<span>End Time</span>
							<input type="datetime-local" value={marketForm.endTime} onInput={event => onMarketFormChange({ endTime: event.currentTarget.value })} />
						</label>
					</div>

					{marketForm.marketType === 'categorical' ? (
						<label className="field">
							<span>Outcome Labels</span>
							<textarea value={marketForm.categoricalOutcomes} onInput={event => onMarketFormChange({ categoricalOutcomes: event.currentTarget.value })} placeholder={'One outcome per line\nApple\nBanana\nCherry'} />
						</label>
					) : undefined}

					{marketForm.marketType === 'scalar' ? (
						<div className="field-row">
							<label className="field">
								<span>Number Of Ticks</span>
								<input value={marketForm.numTicks} onInput={event => onMarketFormChange({ numTicks: event.currentTarget.value })} />
							</label>
							<label className="field">
								<span>Answer Unit</span>
								<input value={marketForm.answerUnit} onInput={event => onMarketFormChange({ answerUnit: event.currentTarget.value })} placeholder="USD" />
							</label>
						</div>
					) : undefined}

					{marketForm.marketType === 'scalar' ? (
						<div className="field-row">
							<label className="field">
								<span>Display Value Min</span>
								<input value={marketForm.displayValueMin} onInput={event => onMarketFormChange({ displayValueMin: event.currentTarget.value })} />
							</label>
							<label className="field">
								<span>Display Value Max</span>
								<input value={marketForm.displayValueMax} onInput={event => onMarketFormChange({ displayValueMax: event.currentTarget.value })} />
							</label>
						</div>
					) : undefined}

					{marketForm.marketType === 'scalar' ? (
						scalarCreatePreviewDetails === undefined ? (
							<p className="detail">Enter valid scalar parameters to preview the tick slider.</p>
						) : (
							<div className="market-scalar-deploy">
								<label className="field scalar-slider-field">
									<span>Scalar Preview</span>
									<div className="scalar-slider-rail">
										<div className="scalar-slider-track" />
										<div className="scalar-slider-fill" style={{ width: `${ createScalarProgress }%` }} />
										<input type="range" min="0" max={scalarCreatePreviewDetails.numTicks.toString()} step="1" value={scalarCreatePreviewTick} aria-valuetext={formatScalarOutcomeLabel(scalarCreatePreviewDetails, BigInt(scalarCreatePreviewTick))} onInput={event => setScalarCreatePreviewTick(event.currentTarget.value)} />
									</div>
								</label>
								<div className="workflow-question-grid market-scalar-deploy-grid scalar-slider-stats">
									<div>
										<span className="metric-label">Min Value</span>
										<strong>{formatScalarOutcomeLabel(scalarCreatePreviewDetails, 0n)}</strong>
									</div>
									<div>
										<span className="metric-label">Selected Tick</span>
										<strong>{`${ scalarCreatePreviewTick } / ${ scalarCreatePreviewDetails.numTicks.toString() }`}</strong>
									</div>
									<div>
										<span className="metric-label">Selected Value</span>
										<strong>{formatScalarOutcomeLabel(scalarCreatePreviewDetails, BigInt(scalarCreatePreviewTick))}</strong>
									</div>
									<div>
										<span className="metric-label">Max Value</span>
										<strong>{formatScalarOutcomeLabel(scalarCreatePreviewDetails, scalarCreatePreviewDetails.numTicks)}</strong>
									</div>
								</div>
							</div>
						)
					) : undefined}

					<div className="actions">
						<button onClick={onCreateMarket} disabled={accountAddress === undefined || !isMainnet || marketCreating}>
							{marketCreating ? 'Creating Question...' : 'Create Question'}
						</button>
					</div>
				</div>
			</EntityCard>

			{marketError === undefined ? undefined : <p className="notice error">{marketError}</p>}
		</>
	)
}
