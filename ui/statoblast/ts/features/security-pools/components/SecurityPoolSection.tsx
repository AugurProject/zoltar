import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { Question, getQuestionTitle } from '../../markets/components/Question.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'
import { UniverseLink } from '@zoltar/ui-zoltar/features/universes/components/UniverseLink.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { formatOpenInterestFeePerYearPercent, ORIGIN_POOL_INITIAL_RETENTION_RATE } from '../lib/retentionRate.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getInitialReportPriorityFeeValidationMessage, getSecurityPoolCreateDisabledReason, getStatoblastSecurityMultiplierValidationMessage } from '../lib/securityPoolCreationGuards.js'
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import type { SecurityPoolSectionProps } from '../../types.js'

export function SecurityPoolSection({
	accountState,
	availableQuestionsContextKey,
	availableQuestions,
	checkingDuplicateOriginPool,
	duplicateOriginPoolExists,
	hasLoadedAvailableQuestions,
	loadingMarketDetails,
	loadingAvailableQuestions,
	marketDetails,
	onCreateSecurityPool,
	onLoadAvailableQuestions,
	onOpenCreatedPool,
	onReturnToBrowse,
	onSecurityPoolFormChange,
	onResetSecurityPoolCreation,
	securityPoolCreating,
	securityPoolError,
	securityPoolForm,
	securityPoolResult,
	showHeader = true,
	poolCreationMarketDetails: carriedPoolCreationMarketDetails,
	zoltarUniverseHasForked,
}: SecurityPoolSectionProps) {
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const eligibleQuestions = availableQuestions.filter(question => question.marketType === 'binary')
	const [availableQuestionsLoadError, setAvailableQuestionsLoadError] = useState<string | undefined>(undefined)
	const requestedAvailableQuestionsContextRef = useRef<string | undefined>(undefined)
	let availableQuestionsHelp: ComponentChildren = undefined
	if (loadingAvailableQuestions) {
		availableQuestionsHelp = <LoadingText>{securityPoolCopy.loadingAvailableQuestions}</LoadingText>
	} else if (availableQuestionsLoadError === undefined && eligibleQuestions.length === 0) {
		availableQuestionsHelp = securityPoolCopy.noAvailableQuestions
	}
	useEffect(() => {
		if (requestedAvailableQuestionsContextRef.current !== availableQuestionsContextKey) {
			requestedAvailableQuestionsContextRef.current = undefined
			setAvailableQuestionsLoadError(undefined)
		}
		if (hasLoadedAvailableQuestions) {
			requestedAvailableQuestionsContextRef.current = undefined
			setAvailableQuestionsLoadError(undefined)
			return
		}
		if (loadingAvailableQuestions || requestedAvailableQuestionsContextRef.current === availableQuestionsContextKey) return
		requestedAvailableQuestionsContextRef.current = availableQuestionsContextKey
		void onLoadAvailableQuestions().catch(() => setAvailableQuestionsLoadError(securityPoolCopy.availableQuestionsLoadError))
	}, [availableQuestionsContextKey, hasLoadedAvailableQuestions, loadingAvailableQuestions, onLoadAvailableQuestions])
	const retryAvailableQuestions = () => {
		setAvailableQuestionsLoadError(undefined)
		requestedAvailableQuestionsContextRef.current = availableQuestionsContextKey
		void onLoadAvailableQuestions().catch(() => setAvailableQuestionsLoadError(securityPoolCopy.availableQuestionsLoadError))
	}
	const hasSecurityPoolResult = securityPoolResult !== undefined
	const statoblastSecurityMultiplierValidationMessage = getStatoblastSecurityMultiplierValidationMessage(securityPoolForm.statoblastSecurityMultiplierBps)
	const initialReportPriorityFeeValidationMessage = getInitialReportPriorityFeeValidationMessage(securityPoolForm.initialReportPriorityFeeGwei)
	const guardedCreateDisabledReason = getSecurityPoolCreateDisabledReason({
		accountAddress: accountState.address,
		checkingDuplicateOriginPool,
		duplicateOriginPoolExists,
		initialReportPriorityFeeGwei: securityPoolForm.initialReportPriorityFeeGwei,
		isOnActiveAppChain,
		marketDetails,
		securityPoolCreating,
		statoblastSecurityMultiplier: securityPoolForm.statoblastSecurityMultiplierBps,
		zoltarUniverseHasForked,
	})
	const createDisabledReason = loadingAvailableQuestions && securityPoolForm.marketId.trim() === '' ? securityPoolCopy.loadingAvailableQuestionsReason : guardedCreateDisabledReason
	const isCreateDisabled = !isOnActiveAppChain || createDisabledReason !== undefined
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

	const createdPoolResult =
		securityPoolResult === undefined ? undefined : (
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
						<button className='secondary' onClick={onResetSecurityPoolCreation}>
							{securityPoolCopy.createAnotherPool}
						</button>
					</div>
				}
			>
				<Question question={createdQuestionDetails} loading={createdQuestionDetails === undefined} />
				<ul className='status-list hashes'>
					<li>
						<span>{securityPoolCopy.poolAddressLabel}</span>
						<strong>
							<AddressValue address={securityPoolResult.securityPoolAddress} />
						</strong>
					</li>
					<li>
						<span>{commonCopy.statoblastSecurityMultiplierBps}</span>
						<strong>{formatStatoblastSecurityMultiplier(securityPoolResult.statoblastSecurityMultiplierBps)}x</strong>
					</li>
					<li>
						<span>{commonCopy.initialReportPriorityFee}</span>
						<strong>
							{formatCurrencyBalance(securityPoolResult.initialReportPriorityFeeAttoEthPerGas, 9)} {commonCopy.gwei}
						</strong>
					</li>
					<li>
						<span>{commonCopy.universe}</span>
						<strong>
							<UniverseLink universeId={securityPoolResult.universeId} />
						</strong>
					</li>
					<li>
						<span>{securityPoolCopy.deploymentTransactionHash}</span>
						<strong>
							<TransactionHashLink hash={securityPoolResult.deployPoolHash} />
						</strong>
					</li>
				</ul>
			</EntityCard>
		)

	return (
		<RouteWorkflowPanel showHeader={showHeader} title={commonCopy.createPool}>
			{hasSecurityPoolResult ? (
				<>
					{createdPoolResult}
					<ErrorNotice message={securityPoolError} />
				</>
			) : (
				<>
					<SectionBlock description={securityPoolCopy.marketHierarchyDetail} title={showHeader ? undefined : commonCopy.createPool} variant='plain'>
						<div className='form-grid'>
							<div className='field'>
								<label htmlFor='security-pool-question-picker'>
									<span>{securityPoolCopy.chooseAvailableQuestion}</span>
								</label>
								<select id='security-pool-question-picker' disabled={loadingAvailableQuestions} value={eligibleQuestions.some(question => question.questionId === securityPoolForm.marketId) ? securityPoolForm.marketId : ''} onChange={event => onSecurityPoolFormChange({ marketId: event.currentTarget.value })}>
									<option value=''>{securityPoolCopy.chooseQuestionPlaceholder}</option>
									{eligibleQuestions.map(question => (
										<option key={question.questionId} value={question.questionId}>
											{getQuestionTitle(question)}
										</option>
									))}
								</select>
								{availableQuestionsHelp === undefined ? undefined : <p className='field-help'>{availableQuestionsHelp}</p>}
								<ErrorNotice message={availableQuestionsLoadError} />
								{availableQuestionsLoadError === undefined ? undefined : (
									<div className='actions'>
										<button className='secondary' type='button' onClick={retryAvailableQuestions}>
											{securityPoolCopy.retryAvailableQuestions}
										</button>
									</div>
								)}
							</div>
							<div className='field'>
								<LookupFieldRow label={commonCopy.questionId} value={securityPoolForm.marketId} onInput={marketId => onSecurityPoolFormChange({ marketId })} placeholder={commonCopy.hexValuePlaceholder} />
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

							<div className='field'>
								<label htmlFor='security-pool-security-multiplier'>
									<span>{commonCopy.statoblastSecurityMultiplierBps}</span>
								</label>
								<FormInput
									id='security-pool-security-multiplier'
									aria-describedby={`security-pool-security-multiplier-help${statoblastSecurityMultiplierValidationMessage === undefined ? '' : ' security-pool-security-multiplier-error'}`}
									invalid={statoblastSecurityMultiplierValidationMessage !== undefined}
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
									<span>{commonCopy.initialReportPriorityFee}</span>
								</label>
								<FormInput
									id='security-pool-initial-report-priority-fee'
									aria-describedby={`security-pool-initial-report-priority-fee-help${initialReportPriorityFeeValidationMessage === undefined ? '' : ' security-pool-initial-report-priority-fee-error'}`}
									invalid={initialReportPriorityFeeValidationMessage !== undefined}
									value={securityPoolForm.initialReportPriorityFeeGwei}
									onInput={event =>
										onSecurityPoolFormChange({
											initialReportPriorityFeeGwei: event.currentTarget.value,
										})
									}
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

							<div className='actions'>
								<TransactionActionButton
									idleLabel={createButtonLabel}
									pendingLabel={securityPoolCopy.creatingPool}
									onClick={onCreateSecurityPool}
									pending={securityPoolCreating}
									availability={{ disabled: isCreateDisabled, reason: createDisabledReason }}
									disabledReasonElementId={visibleFieldErrorId}
									showDisabledReason={visibleFieldErrorId === undefined}
								/>
							</div>
						</div>
						{!duplicateOriginPoolExists ? undefined : <p className='detail'>{securityPoolCopy.duplicatePoolDetail}</p>}
						{marketDetails !== undefined && marketDetails.marketType !== 'binary' ? <p className='notice error'>{securityPoolCopy.ineligibleQuestionDetail}</p> : undefined}
						{zoltarUniverseHasForked ? <p className='notice error'>{securityPoolCopy.poolCreationAfterForkReason}</p> : undefined}
					</SectionBlock>

					<ErrorNotice message={securityPoolError} />
				</>
			)}
		</RouteWorkflowPanel>
	)
}
