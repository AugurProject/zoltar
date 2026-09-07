import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
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
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { formatOpenInterestFeePerYearPercent, ORIGIN_POOL_INITIAL_RETENTION_RATE } from '../lib/retentionRate.js'
import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getInitialReportPriorityFeeValidationMessage, getSecurityPoolCreateDisabledReason, getStatoblastSecurityMultiplierValidationMessage } from '../lib/securityPoolCreationGuards.js'
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import { MarketCreateQuestionSection } from '../../markets/components/MarketCreateQuestionSection.js'
import { getDefaultMarketFormState } from '../../markets/lib/marketForm.js'
import { validateMarketForm } from '@zoltar/ui-zoltar/features/questions/lib/questionCreation.js'
import type { SecurityPoolSectionProps } from '../../types.js'
import { formatUniverseIdHex } from '@zoltar/ui-zoltar/features/universes/lib/universe.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/lib/network.js'
import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js'

export function SecurityPoolSection({
	accountState,
	activeUniverseId,
	checkingDuplicateOriginPool,
	duplicateOriginPoolExists,
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
	onResetSecurityPoolCreation,
	securityPoolCreating,
	securityPoolError,
	securityPoolForm,
	securityPoolResult,
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
	const [questionSource, setQuestionSource] = useState<'existing' | 'new'>(marketResult === undefined ? 'existing' : 'new')
	const questionSourceLocked = questionAndPoolCreating || marketCreating || securityPoolCreating || marketResult !== undefined
	const hasSecurityPoolResult = securityPoolResult !== undefined
	const statoblastSecurityMultiplierValidationMessage = getStatoblastSecurityMultiplierValidationMessage(securityPoolForm.statoblastSecurityMultiplierBps)
	const initialReportPriorityFeeValidationMessage = getInitialReportPriorityFeeValidationMessage(securityPoolForm.initialReportPriorityFeeGwei)
	const questionFormValidation = validateMarketForm(marketForm)
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
	const createDisabledReason = guardedCreateDisabledReason
	const isCreateDisabled = !isOnActiveAppChain || createDisabledReason !== undefined
	const createQuestionAndPoolDisabledReason = (() => {
		if (accountState.address === undefined) return marketCopy.questionCreationWalletRequired
		if (!isOnActiveAppChain) return getWrongNetworkReason()
		if (zoltarUniverseHasForked) return securityPoolCopy.poolCreationAfterForkReason
		if (marketForm.marketType !== 'binary') return securityPoolCopy.ineligibleQuestionDetail
		if (!questionFormValidation.isValid) return questionFormValidation.notice
		if (questionAndPoolCreating) return securityPoolCopy.combinedQuestionAndPoolInProgress
		if (marketCreating) return securityPoolCopy.questionCreationInProgress
		if (securityPoolCreating) return securityPoolCopy.poolCreationInProgress
		const multiplierValidationMessage = getStatoblastSecurityMultiplierValidationMessage(securityPoolForm.statoblastSecurityMultiplierBps)
		if (multiplierValidationMessage !== undefined) return multiplierValidationMessage
		return getInitialReportPriorityFeeValidationMessage(securityPoolForm.initialReportPriorityFeeGwei)
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
					<span>{commonCopy.initialReportPriorityFee}</span>
				</label>
				<FormInput
					id='security-pool-initial-report-priority-fee'
					aria-describedby={`security-pool-initial-report-priority-fee-help${initialReportPriorityFeeValidationMessage === undefined ? '' : ' security-pool-initial-report-priority-fee-error'}`}
					invalid={initialReportPriorityFeeValidationMessage !== undefined}
					disabled={questionSourceLocked}
					value={securityPoolForm.initialReportPriorityFeeGwei}
					onInput={event => onSecurityPoolFormChange({ initialReportPriorityFeeGwei: event.currentTarget.value })}
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
				{securityPoolResult.universeId === activeUniverseId ? undefined : (
					<WarningSurface role='alert' surface='flat' variant='compact'>
						<strong>{securityPoolCopy.universeMismatch}</strong>
						<p>{securityPoolCopy.formatBrowsePoolUniverseMismatch(formatUniverseIdHex(securityPoolResult.universeId), formatUniverseIdHex(activeUniverseId))}</p>
					</WarningSurface>
				)}
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
									setQuestionSource('existing')
								}}
							>
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
							<span>{statoblastAppCopy.statoblastSecurityMultiplierBps}</span>
							<strong>{formatStatoblastSecurityMultiplier(securityPoolResult.statoblastSecurityMultiplierBps)}x</strong>
						</li>
						<li>
							<span>{commonCopy.initialReportPriorityFee}</span>
							<strong>{formatCurrencyBalanceWithUnit(securityPoolResult.initialReportPriorityFeeAttoEthPerGas, commonCopy.gwei, 9)}</strong>
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
			{hasSecurityPoolResult ? (
				<>
					{createdPoolResult}
					<ErrorNotice message={securityPoolError} />
				</>
			) : (
				<>
					<SectionBlock variant='plain'>
						<fieldset className='form-grid' disabled={questionSourceLocked}>
							<legend>{securityPoolCopy.questionSourceLegend}</legend>
							<label>
								<input checked={questionSource === 'existing'} disabled={questionSourceLocked} name='security-pool-question-source' type='radio' value='existing' onChange={() => setQuestionSource('existing')} /> {securityPoolCopy.useQuestionId}
							</label>
							<label>
								<input checked={questionSource === 'new'} disabled={questionSourceLocked} name='security-pool-question-source' type='radio' value='new' onChange={() => setQuestionSource('new')} /> {securityPoolCopy.createNewQuestion}
							</label>
						</fieldset>
					</SectionBlock>

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

								<div className='actions'>
									<TransactionActionButton
										idleLabel={createButtonLabel}
										pendingLabel={securityPoolCopy.creatingPool}
										onClick={() => onCreateSecurityPool()}
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
											},
										})}
								onMarketFormChange={onMarketFormChange}
								onOpenForkTab={() => undefined}
								onResetMarket={onResetMarket}
								submitFields={poolConfigurationFields}
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
								<div className='actions'>
									<TransactionActionButton
										idleLabel={securityPoolCopy.retryPoolCreation}
										pendingLabel={securityPoolCopy.creatingPool}
										onClick={() => onCreateSecurityPool(marketResult.questionId)}
										pending={questionAndPoolCreating || securityPoolCreating}
										availability={{
											disabled: questionAndPoolCreating || securityPoolCreating || createDisabledReason !== undefined,
											reason: questionAndPoolCreating || securityPoolCreating ? securityPoolCopy.poolCreationInProgress : createDisabledReason,
										}}
									/>
								</div>
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
		</RouteWorkflowPanel>
	)
}
