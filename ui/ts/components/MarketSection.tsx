import { useEffect, useState } from 'preact/hooks'
import { EntityCard } from './EntityCard.js'
import { LoadableValue } from './LoadableValue.js'
import { formatAddress, formatCurrencyBalance, formatTimestamp } from '../lib/formatters.js'
import { parseMarketTypeInput } from '../lib/inputs.js'
import { isMainnetChain } from '../lib/network.js'
import { readZoltarViewQueryParam, writeZoltarViewQueryParam } from '../lib/urlParams.js'
import type { MarketSectionProps } from '../types/components.js'

type ZoltarView = 'questions' | 'create' | 'fork'

function getZoltarView(value: string | undefined): ZoltarView {
	switch (value) {
		case 'questions':
		case 'create':
		case 'fork':
			return value
		default:
			return 'questions'
	}
}

export function MarketSection({ accountState, loadingZoltarForkAccess, loadingZoltarQuestionCount, loadingZoltarQuestions, loadingZoltarUniverse, marketForm, marketCreating, marketError, marketResult, onApproveZoltarForkRep, onCreateMarket, onForkZoltar, onLoadZoltarQuestions, onLoadZoltarUniverse, onMarketFormChange, onUseQuestionForFork, onUseQuestionForPool, onZoltarForkQuestionIdChange, zoltarForkAllowance, zoltarForkError, zoltarForkPending, zoltarForkQuestionId, zoltarForkRepBalance, zoltarForkResult, zoltarQuestionCount, zoltarQuestions, zoltarUniverse }: MarketSectionProps) {
	const [view, setView] = useState<ZoltarView>(() => getZoltarView(readZoltarViewQueryParam(window.location.search)))
	const isMainnet = isMainnetChain(accountState.chainId)
	const rootUniverse = zoltarUniverse
	const hasForked = rootUniverse?.hasForked === true
	const universeLabel = rootUniverse === undefined ? 'Loading...' : rootUniverse.universeId.toString()
	const forkQuestionLabel = rootUniverse === undefined || rootUniverse.forkQuestionId === 0n ? 'Not forked yet' : rootUniverse.forkQuestionId.toString()
	const hasEnoughRep = rootUniverse !== undefined && zoltarForkRepBalance !== undefined && zoltarForkRepBalance >= rootUniverse.forkThreshold
	const hasEnoughApproval = rootUniverse !== undefined && zoltarForkAllowance !== undefined && zoltarForkAllowance >= rootUniverse.forkThreshold
	const canFork = accountState.address !== undefined && isMainnet && rootUniverse !== undefined && !hasForked && !zoltarForkPending && zoltarForkQuestionId.trim() !== '' && hasEnoughRep && hasEnoughApproval

	useEffect(() => {
		const nextSearch = writeZoltarViewQueryParam(window.location.search, view)
		window.history.replaceState({}, '', `${ window.location.pathname }${ nextSearch }${ window.location.hash }`)
	}, [view])

	return (
		<section className="panel market-panel">
			<div className="workflow-stack">
				<EntityCard
					title="Zoltar"
					badge={<span className="badge ok">{rootUniverse === undefined ? 'Loading...' : hasForked ? 'Forked' : 'Unforked'}</span>}
					actions={
						<button className="secondary" onClick={onLoadZoltarUniverse} disabled={loadingZoltarUniverse}>
							{loadingZoltarUniverse ? 'Loading Universe...' : 'Refresh Universe'}
						</button>
					}
				>
					<div className="workflow-question-grid">
						<div>
							<span className="metric-label">Universe ID</span>
							<strong>{universeLabel}</strong>
						</div>
						<div>
							<span className="metric-label">Has Forked</span>
							<strong>{rootUniverse === undefined ? 'Loading...' : hasForked ? 'Yes' : 'No'}</strong>
						</div>
						<div>
							<span className="metric-label">Fork Question</span>
							<strong>{forkQuestionLabel}</strong>
						</div>
						<div>
							<span className="metric-label">Fork Time</span>
							<strong>
								<LoadableValue loading={loadingZoltarUniverse} placeholder="Loading...">
									{rootUniverse === undefined ? 'Loading...' : rootUniverse.forkTime === 0n ? 'Not forked yet' : formatTimestamp(rootUniverse.forkTime)}
								</LoadableValue>
							</strong>
						</div>
						<div>
							<span className="metric-label">Fork Threshold</span>
							<strong>{rootUniverse === undefined ? 'Loading...' : `${ formatCurrencyBalance(rootUniverse.forkThreshold) } REP`}</strong>
						</div>
						<div>
							<span className="metric-label">Reputation Token</span>
							<strong>{rootUniverse === undefined ? 'Loading...' : formatAddress(rootUniverse.reputationToken)}</strong>
						</div>
						<div>
							<span className="metric-label">Question Registry</span>
							<strong>ZoltarQuestionData</strong>
						</div>
						<div>
							<span className="metric-label">Known Questions</span>
							<strong>
								<LoadableValue loading={loadingZoltarQuestionCount} placeholder="Loading...">
									{zoltarQuestionCount === undefined ? 'Loading...' : zoltarQuestionCount.toString()}
								</LoadableValue>
							</strong>
						</div>
					</div>
					<div className="entity-card-subsection">
						<div className="entity-card-subsection-header">
							<h4>Forked universes</h4>
						</div>
						{rootUniverse === undefined ? (
							<p className="detail">Loading...</p>
						) : rootUniverse.childUniverses.length === 0 ? (
							<p className="detail">No child universes</p>
						) : (
							<div className="entity-card-list">
								{rootUniverse.childUniverses.map(child => (
									<EntityCard key={child.universeId.toString()} className="compact" title={`Universe ${ child.universeId.toString() }`} badge={<span className={`badge ${ child.exists ? 'ok' : 'pending' }`}>{child.exists ? 'Exists' : 'Not deployed'}</span>}>
										<div className="workflow-vault-grid">
											<div>
												<span className="metric-label">Outcome</span>
												<strong>{child.outcomeLabel}</strong>
											</div>
											<div>
												<span className="metric-label">Parent Universe</span>
												<strong>{child.parentUniverseId.toString()}</strong>
											</div>
											<div>
												<span className="metric-label">Reputation Token</span>
												<strong>{formatAddress(child.reputationToken)}</strong>
											</div>
											<div>
												<span className="metric-label">Fork Time</span>
												<strong>{child.forkTime === 0n ? 'Not forked yet' : formatTimestamp(child.forkTime)}</strong>
											</div>
										</div>
									</EntityCard>
								))}
							</div>
						)}
					</div>
				</EntityCard>
			</div>

			<div className="subtab-nav" role="tablist" aria-label="Zoltar views">
				<button className={`subtab-link ${ view === 'questions' ? 'active' : '' }`} type="button" onClick={() => setView('questions')} aria-pressed={view === 'questions'}>
					Questions
				</button>
				<button className={`subtab-link ${ view === 'create' ? 'active' : '' }`} type="button" onClick={() => setView('create')} aria-pressed={view === 'create'}>
					Create Question
				</button>
				<button className={`subtab-link ${ view === 'fork' ? 'active' : '' }`} type="button" onClick={() => setView('fork')} aria-pressed={view === 'fork'}>
					Fork Zoltar
				</button>
			</div>

			<div className="workflow-stack">
				{view === 'questions' ? (
					<EntityCard
						title="Questions"
						badge={<span className="badge muted">{zoltarQuestionCount === undefined ? 'Unknown count' : `${ zoltarQuestionCount.toString() } questions`}</span>}
						actions={
							<button className="secondary" onClick={onLoadZoltarQuestions} disabled={loadingZoltarQuestions}>
								{loadingZoltarQuestions ? 'Loading Questions...' : 'Refresh Questions'}
							</button>
						}
					>
						{zoltarQuestions.length === 0 ? (
							<p className="detail">
								<LoadableValue loading={loadingZoltarQuestionCount} placeholder="Loading...">
									{zoltarQuestionCount === undefined ? 'No questions loaded' : `${ zoltarQuestionCount.toString() } questions`}
								</LoadableValue>
							</p>
						) : (
							<div className="entity-card-list question-browser-list">
								{zoltarQuestions.map(question => (
									<EntityCard
										key={question.questionId}
										title={question.title === '' ? 'Untitled question' : question.title}
										badge={<span className="badge ok">{question.marketType}</span>}
										actions={
											<div className="actions">
												<button
													className="secondary"
													onClick={() => {
														onUseQuestionForFork(question.questionId)
														setView('fork')
													}}
												>
													Use For Fork
												</button>
												<button className="secondary" onClick={() => onUseQuestionForPool(question.questionId)}>
													Use For Create Pool
												</button>
											</div>
										}
									>
										<div className="workflow-question-grid">
											<div>
												<span className="metric-label">Question ID</span>
												<strong>{question.questionId}</strong>
											</div>
											<div>
												<span className="metric-label">Created</span>
												<strong>{formatTimestamp(question.createdAt)}</strong>
											</div>
											<div>
												<span className="metric-label">End Time</span>
												<strong>{formatTimestamp(question.endTime)}</strong>
											</div>
											<div>
												<span className="metric-label">Outcomes</span>
												<strong>{question.outcomeLabels.length === 0 ? 'Scalar' : question.outcomeLabels.join(', ')}</strong>
											</div>
										</div>
									</EntityCard>
								))}
							</div>
						)}
					</EntityCard>
				) : undefined}

				{view === 'create' ? (
					<>
						{marketResult === undefined ? undefined : (
							<EntityCard
								title="Question Created"
								badge={<span className="badge ok">{marketResult.marketType}</span>}
								actions={
									<div className="actions">
										<button
											className="secondary"
											onClick={() => {
												onUseQuestionForFork(marketResult.questionId)
												setView('fork')
											}}
										>
											Use For Fork
										</button>
										<button className="secondary" onClick={() => onUseQuestionForPool(marketResult.questionId)}>
											Use For Create Pool
										</button>
									</div>
								}
							>
								<div className="question-preview-body">
									<div>
										<span className="metric-label">Question ID</span>
										<strong>{marketResult.questionId}</strong>
									</div>
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

								<div className="actions">
									<button onClick={onCreateMarket} disabled={accountState.address === undefined || !isMainnet || marketCreating}>
										{marketCreating ? 'Creating Question...' : 'Create Question'}
									</button>
								</div>
							</div>
						</EntityCard>

						{marketError === undefined ? undefined : <p className="notice error">{marketError}</p>}
					</>
				) : undefined}

				{view === 'fork' ? (
					<>
						<EntityCard
							title="Fork Zoltar"
							badge={<span className={`badge ${ hasForked ? 'blocked' : 'ok' }`}>{hasForked ? 'Already forked' : 'Ready'}</span>}
							actions={
								<button className="secondary" onClick={onLoadZoltarUniverse} disabled={loadingZoltarUniverse}>
									{loadingZoltarUniverse ? 'Loading Universe...' : 'Refresh Fork State'}
								</button>
							}
						>
							<div className="workflow-metric-grid">
								<div>
									<span className="metric-label">Your REP Balance</span>
									<strong>
										<LoadableValue loading={loadingZoltarForkAccess} placeholder="Loading...">
											{`${ formatCurrencyBalance(zoltarForkRepBalance) } REP`}
										</LoadableValue>
									</strong>
								</div>
								<div>
									<span className="metric-label">REP Approved To Zoltar</span>
									<strong>
										<LoadableValue loading={loadingZoltarForkAccess} placeholder="Loading...">
											{`${ formatCurrencyBalance(zoltarForkAllowance) } REP`}
										</LoadableValue>
									</strong>
								</div>
							</div>

							<div className="form-grid">
								<label className="field">
									<span>Fork Question ID</span>
									<input value={zoltarForkQuestionId} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder="0x..." />
								</label>

								<div className="actions">
									<button className="secondary" onClick={onApproveZoltarForkRep} disabled={accountState.address === undefined || !isMainnet || rootUniverse === undefined || zoltarForkPending || hasEnoughApproval}>
										{zoltarForkPending ? 'Waiting...' : hasEnoughApproval ? 'Threshold Approved' : 'Approve REP Threshold'}
									</button>
									<button onClick={onForkZoltar} disabled={!canFork}>
										{zoltarForkPending ? 'Waiting...' : 'Fork Zoltar'}
									</button>
								</div>

								{rootUniverse === undefined ? undefined : !hasEnoughRep ? <p className="detail">Need {formatCurrencyBalance(rootUniverse.forkThreshold)} REP.</p> : !hasEnoughApproval ? <p className="detail">Approve {formatCurrencyBalance(rootUniverse.forkThreshold)} REP first.</p> : undefined}
							</div>
						</EntityCard>

						{zoltarForkResult === undefined ? undefined : (
							<EntityCard title="Latest Zoltar Fork Action" badge={<span className="badge ok">{zoltarForkResult.action}</span>}>
								<div className="question-preview-body">
									<div>
										<span className="metric-label">Question ID</span>
										<strong>{zoltarForkResult.questionId}</strong>
									</div>
									<div>
										<span className="metric-label">Universe</span>
										<strong>{zoltarForkResult.universeId.toString()}</strong>
									</div>
									<div>
										<span className="metric-label">Transaction</span>
										<strong>{zoltarForkResult.hash}</strong>
									</div>
								</div>
							</EntityCard>
						)}

						{zoltarForkError === undefined ? undefined : <p className="notice error">{zoltarForkError}</p>}
					</>
				) : undefined}
			</div>
		</section>
	)
}
