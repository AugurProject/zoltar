import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'
import { TransactionStepsContent } from '@zoltar/ui-core-shared/components/TransactionStepsContent.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { formatOpenInterestFeePerYearPercent, ORIGIN_POOL_INITIAL_RETENTION_RATE } from '../lib/retentionRate.js'
import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getInitialReportPriorityFeeValidationMessage, getSecurityPoolCreateDisabledReason, getStatoblastSecurityMultiplierValidationMessage } from '../lib/securityPoolCreationGuards.js'
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import { MarketCreateQuestionSection } from '../../markets/components/MarketCreateQuestionSection.js'
import { getDefaultMarketFormState } from '../../markets/lib/marketForm.js'
import { validateMarketForm } from '@zoltar/ui-zoltar-shared/features/questions/lib/questionCreation.js'
import type { SecurityPoolSectionProps } from '../../types.js'
import { formatUniverseIdHex } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import * as marketCopy from '@zoltar/ui-zoltar-shared/copy/market.js'
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js'
import { SecurityPoolLink } from './SecurityPoolLink.js'

export function SecurityPoolSection({
	accountState,
	activeUniverseId,
	checkingDuplicateOriginPool,
	duplicateOriginPoolAddress,
	duplicateOriginPoolExists,
	existingQuestionCheck,
	onRetryExistingQuestionCheck,
	loadingMarketDetails,
	marketDetails,
	marketCreating = false,
	marketError = undefined,
	marketForm = getDefaultMarketFormState(),
	marketResult = undefined,
	onCreateMarket = () => undefined,
	onCreateQuestionAndSecurityPool,
	onCreateSecurityPool,
	onOpenCreatedPool,
	onMarketFormChange = () => undefined,
	onResetMarket = () => undefined,
	onReturnToBrowse,
	onSecurityPoolFormChange,
	onDismissSecurityPoolReview,
	onResetSecurityPoolCreation,
	securityPoolCreating,
	securityPoolError,
	securityPoolForm,
	securityPoolResult,
	securityPoolReviewSignal,
	showHeader = true,
	questionAndPoolCreating = false,
	poolCreationMarketDetails: carriedPoolCreationMarketDetails,
	zoltarUniverseHasForked,
}: SecurityPoolSectionProps) {
	const fallbackMarketForm = {
		...getDefaultMarketFormState(),
		description: securityPoolCopy.createQuestionForPoolTitle,
		endTime: '4102444800',
		startTime: '4102358400',
		title: securityPoolCopy.createQuestionForPoolTitle,
	}
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	// An unfinished question-and-pool flow keeps its question; otherwise use an explicitly selected ID or start a new question.
	const [questionSource, setQuestionSource] = useState<'existing' | 'new'>(marketResult !== undefined || (securityPoolForm.marketId.trim() === '' && marketDetails === undefined) ? 'new' : 'existing')
	const reviewWorkflow = transactionSteps.value
	const ownsTransactionReview = securityPoolReviewSignal !== undefined && !securityPoolReviewSignal.aborted && reviewWorkflow?.reviewSignal === securityPoolReviewSignal && reviewWorkflow.steps[reviewWorkflow.activeIndex] !== undefined
	useEffect(() => {
		if (ownsTransactionReview && reviewWorkflow?.steps[reviewWorkflow.activeIndex]?.phase === 'failed') (onDismissSecurityPoolReview ?? reviewWorkflow.cancel)()
	}, [ownsTransactionReview, reviewWorkflow, onDismissSecurityPoolReview])
	// The wallet confirms normal pool creation. Keep an escape if a pre-wallet review is unexpectedly published.
	const inlineTransactionReview = ownsTransactionReview ? (
		<TransactionStepsContent cancelable={reviewWorkflow.steps[reviewWorkflow.activeIndex]?.phase === 'review'} contextKey='security-pool-creation' focusOnMount heading={transactionReviewCopy.transactionReview} keepActionsVisible onClose={onDismissSecurityPoolReview} />
	) : undefined
	const panelRef = useRef<HTMLDivElement>(null)
	const returnFocusAfterReview = useRef(false)
	// Leaving the card (for example through the route tabs) would strand a review that only this card renders.
	const dismissOwnedReview = useRef<(() => void) | undefined>(undefined)
	dismissOwnedReview.current = ownsTransactionReview ? onDismissSecurityPoolReview : undefined
	useEffect(() => () => dismissOwnedReview.current?.(), [])
	// When the review closes, return focus to the submit button once it is interactive again.
	useEffect(() => {
		if (ownsTransactionReview) {
			returnFocusAfterReview.current = true
			return
		}
		if (!returnFocusAfterReview.current || securityPoolCreating) return
		returnFocusAfterReview.current = false
		panelRef.current?.querySelector<HTMLElement>('.actions .tx-action-button:not(:disabled)')?.focus()
	}, [ownsTransactionReview, securityPoolCreating])
	// A transaction still showing keeps the form it summarizes locked while the wallet decides.
	const questionSourceLocked = questionAndPoolCreating || marketCreating || securityPoolCreating || ownsTransactionReview || marketResult !== undefined
	const hasSecurityPoolResult = securityPoolResult !== undefined
	const statoblastSecurityMultiplierValidationMessage = getStatoblastSecurityMultiplierValidationMessage(securityPoolForm.statoblastSecurityMultiplierBps)
	const initialReportPriorityFeeValidationMessage = getInitialReportPriorityFeeValidationMessage(securityPoolForm.initialReportPriorityFeeEth)
	const questionFormValidation = validateMarketForm(marketForm)
	const createGuardInputs = {
		accountAddress: accountState.address,
		duplicateOriginPoolExists,
		initialReportPriorityFeeEth: securityPoolForm.initialReportPriorityFeeEth,
		isOnActiveAppChain,
		marketDetails,
		securityPoolCreating,
		statoblastSecurityMultiplier: securityPoolForm.statoblastSecurityMultiplierBps,
		zoltarUniverseHasForked,
	}
	const createDisabledReason = getSecurityPoolCreateDisabledReason({ ...createGuardInputs, checkingDuplicateOriginPool })
	// The reason is the in-progress duplicate check exactly when clearing that flag would change it.
	const createDisabledReasonLoading = checkingDuplicateOriginPool && createDisabledReason !== getSecurityPoolCreateDisabledReason({ ...createGuardInputs, checkingDuplicateOriginPool: false })
	const isCreateDisabled = !isOnActiveAppChain || createDisabledReason !== undefined
	const createQuestionAndPoolDisabledReason = (() => {
		if (questionAndPoolCreating || marketCreating || securityPoolCreating) return undefined
		if (accountState.address === undefined) return marketCopy.questionCreationWalletRequired
		if (!isOnActiveAppChain) return getWrongNetworkReason()
		if (zoltarUniverseHasForked) return securityPoolCopy.poolCreationAfterForkReason
		if (marketForm.marketType !== 'binary') return securityPoolCopy.ineligibleQuestionDetail
		if (!questionFormValidation.isValid) return questionFormValidation.notice
		if (existingQuestionCheck?.status === 'checking') return securityPoolCopy.checkingQuestionExists
		if (existingQuestionCheck?.status === 'error') return securityPoolCopy.questionExistenceUnavailable
		if (existingQuestionCheck?.status === 'existing') return existingQuestionCheck.poolAddress === undefined ? securityPoolCopy.questionAlreadyExists : securityPoolCopy.questionAlreadyHasPool
		const multiplierValidationMessage = getStatoblastSecurityMultiplierValidationMessage(securityPoolForm.statoblastSecurityMultiplierBps)
		if (multiplierValidationMessage !== undefined) return multiplierValidationMessage
		return getInitialReportPriorityFeeValidationMessage(securityPoolForm.initialReportPriorityFeeEth)
	})()
	let visibleFieldErrorId: string | undefined = undefined
	if (createDisabledReason === statoblastSecurityMultiplierValidationMessage) {
		visibleFieldErrorId = 'security-pool-security-multiplier-error'
	} else if (createDisabledReason === initialReportPriorityFeeValidationMessage) {
		visibleFieldErrorId = 'security-pool-initial-report-priority-fee-error'
	}
	let createdQuestionDetails = undefined
	if (securityPoolResult !== undefined)
		if (marketDetails?.questionId === securityPoolResult.questionId) {
			createdQuestionDetails = marketDetails
		} else {
			createdQuestionDetails = carriedPoolCreationMarketDetails
		}

	let createButtonLabel: ComponentChildren = commonCopy.createPoolAction
	if (securityPoolCreating) {
		createButtonLabel = <LoadingText>{securityPoolCopy.creatingPool}</LoadingText>
	} else if (checkingDuplicateOriginPool) {
		createButtonLabel = <LoadingText>{securityPoolCopy.checkingDuplicate}</LoadingText>
	} else if (duplicateOriginPoolExists) {
		createButtonLabel = securityPoolCopy.poolAlreadyExists
	} else if (zoltarUniverseHasForked) createButtonLabel = securityPoolCopy.poolCreationLocked
	const poolConfigurationFields = (
		<>
			<div className='field'>
				<label htmlFor='security-pool-security-multiplier'>
					<span>{statoblastAppCopy.statoblastSecurityMultiplierBps}</span>
				</label>
				<FormInput
					id='security-pool-security-multiplier'
					aria-describedby={`security-pool-security-multiplier-help${statoblastSecurityMultiplierValidationMessage === undefined ? '' : ' security-pool-security-multiplier-error'}`}
					invalid={statoblastSecurityMultiplierValidationMessage !== undefined}
					disabled={questionSourceLocked}
					value={securityPoolForm.statoblastSecurityMultiplierBps}
					onInput={event => onSecurityPoolFormChange({ statoblastSecurityMultiplierBps: event.currentTarget.value })}
				/>
				<p className='field-help' id='security-pool-security-multiplier-help'>
					{securityPoolCopy.statoblastSecurityMultiplierBpsHelpText}
				</p>
				{statoblastSecurityMultiplierValidationMessage === undefined ? undefined : (
					<p className='field-error' id='security-pool-security-multiplier-error'>
						{statoblastSecurityMultiplierValidationMessage}
					</p>
				)}
			</div>
			<div className='field'>
				<label htmlFor='security-pool-initial-report-priority-fee'>
					<span>{securityPoolCopy.initialReportPriorityFeeEthLabel}</span>
				</label>
				<FormInput
					id='security-pool-initial-report-priority-fee'
					aria-describedby={`security-pool-initial-report-priority-fee-help${initialReportPriorityFeeValidationMessage === undefined ? '' : ' security-pool-initial-report-priority-fee-error'}`}
					invalid={initialReportPriorityFeeValidationMessage !== undefined}
					disabled={questionSourceLocked}
					value={securityPoolForm.initialReportPriorityFeeEth}
					onInput={event => onSecurityPoolFormChange({ initialReportPriorityFeeEth: event.currentTarget.value })}
				/>
				<p className='field-help' id='security-pool-initial-report-priority-fee-help'>
					{securityPoolCopy.initialReportPriorityFeeHelpText}
				</p>
				{initialReportPriorityFeeValidationMessage === undefined ? undefined : (
					<p className='field-error' id='security-pool-initial-report-priority-fee-error'>
						{initialReportPriorityFeeValidationMessage}
					</p>
				)}
			</div>
			<div className='field'>
				<span>{securityPoolCopy.initialOpenInterestFeeYear}</span>
				<strong>{formatOpenInterestFeePerYearPercent(ORIGIN_POOL_INITIAL_RETENTION_RATE)}</strong>
			</div>
		</>
	)

	const createdPoolResult =
		securityPoolResult === undefined ? undefined : (
			<>
				<EntityCard
					surface='flat'
					title={securityPoolCopy.poolCreated}
					variant='record'
					actions={
						<div className='actions'>
							<button
								aria-label={securityPoolCopy.formatOpenPoolLabel(createdQuestionDetails === undefined ? securityPoolResult.securityPoolAddress : getQuestionTitle(createdQuestionDetails), securityPoolResult.securityPoolAddress)}
								className='primary'
								onClick={() => onOpenCreatedPool?.(securityPoolResult.securityPoolAddress, securityPoolResult.universeId)}
							>
								{securityPoolCopy.openPool}
							</button>
							{onReturnToBrowse === undefined ? undefined : (
								<button className='secondary' onClick={onReturnToBrowse}>
									{commonCopy.returnToBrowse}
								</button>
							)}
							<button
								className='secondary'
								onClick={() => {
									onResetSecurityPoolCreation()
									onResetMarket()
									setQuestionSource('new')
								}}
							>
								{securityPoolCopy.createAnotherPool}
							</button>
						</div>
					}
				>
					{securityPoolResult.universeId === activeUniverseId ? undefined : <p className='detail'>{securityPoolCopy.formatBrowsePoolUniverseMismatch(formatUniverseIdHex(securityPoolResult.universeId))}</p>}
					<Question question={createdQuestionDetails} loading={createdQuestionDetails === undefined} />
					<ul className='status-list hashes'>
						<li>
							<span>{securityPoolCopy.poolAddressLabel}</span>
							<strong>
								<AddressValue address={securityPoolResult.securityPoolAddress} />
							</strong>
						</li>
						<li>
							<span>{statoblastAppCopy.statoblastSecurityMultiplierBps}</span>
							<strong>{formatStatoblastSecurityMultiplier(securityPoolResult.statoblastSecurityMultiplierBps)}x</strong>
						</li>
						<li>
							<span>{securityPoolCopy.initialReportPriorityFeeEthLabel}</span>
							<strong>{formatCurrencyBalanceWithUnit(securityPoolResult.initialReportPriorityFeeAttoEthPerGas, commonCopy.eth, 18)}</strong>
						</li>
						<li>
							<span>{securityPoolCopy.deploymentTransactionHash}</span>
							<strong>
								<TransactionHashLink hash={securityPoolResult.deployPoolHash} />
							</strong>
						</li>
					</ul>
				</EntityCard>
			</>
		)

	return (
		<RouteWorkflowPanel showHeader={showHeader} title={commonCopy.createPool}>
			<div className='workflow-stack' ref={panelRef}>
				{hasSecurityPoolResult ? (
					<>
						{createdPoolResult}
						<ErrorNotice message={securityPoolError} />
					</>
				) : (
					<>
						{questionSourceLocked ? undefined : (
							<fieldset className='pool-question-source' disabled={questionSourceLocked}>
								<legend>{securityPoolCopy.questionSourceLegend}</legend>
								<label>
									<input checked={questionSource === 'new'} disabled={questionSourceLocked} name='security-pool-question-source' type='radio' value='new' onChange={() => setQuestionSource('new')} /> {securityPoolCopy.createNewQuestion}
								</label>
								<label>
									<input checked={questionSource === 'existing'} disabled={questionSourceLocked} name='security-pool-question-source' type='radio' value='existing' onChange={() => setQuestionSource('existing')} /> {securityPoolCopy.useQuestionId}
								</label>
							</fieldset>
						)}

						{questionSource === 'existing' ? (
							<SectionBlock variant='plain'>
								<div className='form-grid'>
									<div className='field'>
										<LookupFieldRow disabled={questionSourceLocked} label={commonCopy.questionId} value={securityPoolForm.marketId} onInput={marketId => onSecurityPoolFormChange({ marketId })} placeholder={commonCopy.hexValuePlaceholder} />
										<p className='field-help'>{securityPoolCopy.questionIdFallbackHint}</p>
									</div>
									{loadingMarketDetails ? (
										<p className='detail'>
											<LoadingText>{securityPoolCopy.loadingQuestion}</LoadingText>
										</p>
									) : undefined}
									{marketDetails === undefined ? undefined : (
										<div className='loaded-question-preview'>
											<Question question={marketDetails} variant='preview' />
										</div>
									)}

									{poolConfigurationFields}

									{inlineTransactionReview ?? (
										<div className='actions'>
											<TransactionActionButton
												idleLabel={createButtonLabel}
												pendingLabel={securityPoolCopy.creatingPool}
												onClick={() => onCreateSecurityPool()}
												pending={securityPoolCreating}
												availability={{ disabled: isCreateDisabled, loading: createDisabledReasonLoading, reason: createDisabledReason }}
												disabledReasonElementId={visibleFieldErrorId}
												showDisabledReason={visibleFieldErrorId === undefined}
											/>
										</div>
									)}
								</div>
								{!duplicateOriginPoolExists ? undefined : (
									<p className='detail'>
										{securityPoolCopy.duplicatePoolDetail} {duplicateOriginPoolAddress === undefined ? undefined : <SecurityPoolLink securityPoolAddress={duplicateOriginPoolAddress} />}
									</p>
								)}
								{marketDetails !== undefined && marketDetails.marketType !== 'binary' ? <p className='notice error'>{securityPoolCopy.ineligibleQuestionDetail}</p> : undefined}
								{zoltarUniverseHasForked ? <p className='notice error'>{securityPoolCopy.poolCreationAfterForkReason}</p> : undefined}
							</SectionBlock>
						) : undefined}

						{questionSource === 'new' && marketResult === undefined ? (
							<SectionBlock description={securityPoolCopy.createQuestionForPoolDetail} title={commonCopy.createQuestion} variant='plain'>
								<MarketCreateQuestionSection
									accountAddress={accountState.address}
									formDisabled={questionSourceLocked}
									hasForked={false}
									isOnActiveAppChain={isOnActiveAppChain}
									loadingZoltarQuestions={false}
									marketCreating={marketCreating}
									marketError={marketError}
									marketForm={marketForm ?? fallbackMarketForm}
									marketResult={marketResult}
									onCreateMarket={onCreateMarket}
									{...(onCreateQuestionAndSecurityPool === undefined
										? {}
										: {
												submitActionOverride: {
													availability: {
														disabled: questionAndPoolCreating || securityPoolCreating || marketCreating || createQuestionAndPoolDisabledReason !== undefined,
														reason: createQuestionAndPoolDisabledReason,
													},
													idleLabel: securityPoolCopy.createQuestionAndPool,
													onSubmit: onCreateQuestionAndSecurityPool,
													pending: questionAndPoolCreating,
													pendingLabel: securityPoolCopy.creatingQuestionAndPool,
													...(inlineTransactionReview === undefined ? {} : { reviewContent: inlineTransactionReview }),
												},
											})}
									onMarketFormChange={onMarketFormChange}
									onOpenForkTab={() => undefined}
									onResetMarket={onResetMarket}
									submitFields={
										<>
											{poolConfigurationFields}
											{existingQuestionCheck?.status === 'error' ? (
												<button className='secondary' type='button' onClick={onRetryExistingQuestionCheck}>
													{commonCopy.retry}
												</button>
											) : undefined}
											{existingQuestionCheck?.status === 'existing' ? (
												<div className='detail'>
													<p>
														{commonCopy.questionId}: <span className='identifier-value'>{existingQuestionCheck.questionId}</span>
													</p>
													{existingQuestionCheck.poolAddress === undefined ? (
														<button
															className='secondary'
															type='button'
															onClick={() => {
																onSecurityPoolFormChange({ marketId: existingQuestionCheck.questionId })
																setQuestionSource('existing')
															}}
														>
															{securityPoolCopy.useExistingQuestion}
														</button>
													) : (
														<p>
															{securityPoolCopy.poolAddressLabel}: <SecurityPoolLink securityPoolAddress={existingQuestionCheck.poolAddress} />
														</p>
													)}
												</div>
											) : undefined}
										</>
									}
									onUseQuestionForFork={() => undefined}
									onUseQuestionForPool={questionId => onSecurityPoolFormChange({ marketId: questionId })}
									zoltarQuestions={[]}
								/>
							</SectionBlock>
						) : undefined}
						{questionSource === 'new' && marketResult !== undefined ? (
							<EntityCard
								surface='flat'
								title={marketForm.title}
								variant='record'
								actions={
									inlineTransactionReview ?? (
										<div className='actions'>
											<TransactionActionButton
												idleLabel={securityPoolCopy.retryPoolCreation}
												pendingLabel={securityPoolCopy.creatingPool}
												onClick={() => onCreateSecurityPool(marketResult.questionId)}
												pending={questionAndPoolCreating || securityPoolCreating}
												availability={{
													disabled: questionAndPoolCreating || securityPoolCreating || createDisabledReason !== undefined,
													loading: questionAndPoolCreating || securityPoolCreating,
													reason: questionAndPoolCreating || securityPoolCreating ? securityPoolCopy.poolCreationInProgress : createDisabledReason,
												}}
											/>
										</div>
									)
								}
							>
								<p className='detail'>{securityPoolCopy.questionCreatedPoolPending}</p>
								<ul className='status-list hashes'>
									<li>
										<span>{commonCopy.questionId}</span>
										<strong>{marketResult.questionId}</strong>
									</li>
									<li>
										<span>{marketCopy.creationTransactionHash}</span>
										<strong>
											<TransactionHashLink hash={marketResult.createQuestionHash} />
										</strong>
									</li>
								</ul>
							</EntityCard>
						) : undefined}

						<ErrorNotice message={securityPoolError} />
					</>
				)}
			</div>
		</RouteWorkflowPanel>
	)
}
