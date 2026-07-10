import type { ComponentChildren } from 'preact'
import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { Question } from './Question.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { isMainnetChain } from '../lib/network.js'
import { formatOpenInterestFeePerYearPercent, ORIGIN_POOL_INITIAL_RETENTION_RATE } from '../lib/retentionRate.js'
import { getSecurityPoolCreateDisabledReason } from '../lib/securityPoolCreationGuards.js'
import { UI_STRINGS } from '../lib/uiStrings.js'
import type { SecurityPoolSectionProps } from '../types/components.js'

export function SecurityPoolSection({
	accountState,
	checkingDuplicateOriginPool,
	duplicateOriginPoolExists,
	loadingMarketDetails,
	marketDetails,
	onCreateSecurityPool,
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
	const isMainnet = isMainnetChain(accountState.chainId)
	const hasSecurityPoolResult = securityPoolResult !== undefined
	const createDisabledReason = getSecurityPoolCreateDisabledReason({
		accountAddress: accountState.address,
		checkingDuplicateOriginPool,
		duplicateOriginPoolExists,
		isMainnet,
		marketDetails,
		securityPoolCreating,
		zoltarUniverseHasForked,
	})
	const isCreateDisabled = !isMainnet || createDisabledReason !== undefined
	let createdQuestionDetails = undefined
	if (securityPoolResult !== undefined)
		if (marketDetails?.questionId === securityPoolResult.questionId) {
			createdQuestionDetails = marketDetails
		} else {
			createdQuestionDetails = carriedPoolCreationMarketDetails
		}

	let createButtonLabel: ComponentChildren = UI_STRINGS.securityPoolSection.createPoolButtonIdleLabel
	if (securityPoolCreating) {
		createButtonLabel = <LoadingText>{UI_STRINGS.securityPoolSection.createPoolButtonPendingLabel}</LoadingText>
	} else if (checkingDuplicateOriginPool) {
		createButtonLabel = <LoadingText>{UI_STRINGS.securityPoolSection.duplicateCheckPendingLabel}</LoadingText>
	} else if (duplicateOriginPoolExists) {
		createButtonLabel = UI_STRINGS.securityPoolSection.poolAlreadyExistsLabel
	} else if (zoltarUniverseHasForked) createButtonLabel = UI_STRINGS.securityPoolSection.createPoolLockedLabel

	const createdPoolResult =
		securityPoolResult === undefined ? undefined : (
			<EntityCard
				title={UI_STRINGS.securityPoolSection.createdPoolCardTitle}
				variant='record'
				actions={
					<div className='actions'>
						<button className='primary' onClick={() => onOpenCreatedPool?.(securityPoolResult.securityPoolAddress)}>
							{UI_STRINGS.securityPoolSection.openPoolLabel}
						</button>
						{onReturnToBrowse === undefined ? undefined : (
							<button className='secondary' onClick={onReturnToBrowse}>
								{UI_STRINGS.securityPoolSection.returnToBrowseLabel}
							</button>
						)}
						<button className='secondary' onClick={onResetSecurityPoolCreation}>
							{UI_STRINGS.securityPoolSection.createAnotherPoolLabel}
						</button>
					</div>
				}
			>
				<Question question={createdQuestionDetails} loading={createdQuestionDetails === undefined} />
				<ul className='status-list hashes'>
					<li>
						<span>{UI_STRINGS.securityPoolSection.poolAddressLabel}</span>
						<strong>
							<AddressValue address={securityPoolResult.securityPoolAddress} />
						</strong>
					</li>
					<li>
						<span>{UI_STRINGS.securityPoolSection.securityMultiplierLabel}</span>
						<strong>{securityPoolResult.securityMultiplier.toString()}</strong>
					</li>
					<li>
						<span>{UI_STRINGS.securityPoolSection.universeLabel}</span>
						<strong>
							<UniverseLink universeId={securityPoolResult.universeId} />
						</strong>
					</li>
					<li>
						<span>{UI_STRINGS.securityPoolSection.deploymentTransactionHashLabel}</span>
						<strong>
							<TransactionHashLink hash={securityPoolResult.deployPoolHash} />
						</strong>
					</li>
				</ul>
			</EntityCard>
		)

	return (
		<RouteWorkflowPanel showHeader={showHeader} title={UI_STRINGS.securityPoolSection.createPoolPanelTitle}>
			{hasSecurityPoolResult ? (
				<>
					{createdPoolResult}
					<ErrorNotice message={securityPoolError} />
				</>
			) : (
				<>
					<SectionBlock title={UI_STRINGS.securityPoolSection.createPoolPanelTitle} variant='plain'>
						<div className='form-grid'>
							<div className='field'>
								<LookupFieldRow label={UI_STRINGS.securityPoolSection.questionIdLabel} value={securityPoolForm.marketId} onInput={marketId => onSecurityPoolFormChange({ marketId })} placeholder={UI_STRINGS.securityPoolSection.questionIdPlaceholder} />
								<p className='field-help'>{UI_STRINGS.securityPoolSection.questionHelpText}</p>
							</div>
							{loadingMarketDetails ? (
								<p className='detail'>
									<LoadingText>{UI_STRINGS.securityPoolSection.loadingQuestionLabel}</LoadingText>
								</p>
							) : undefined}
							{marketDetails === undefined ? undefined : (
								<div className='loaded-question-preview'>
									<Question question={marketDetails} variant='preview' />
								</div>
							)}

							<div className='field'>
								<label htmlFor='security-pool-security-multiplier'>
									<span>{UI_STRINGS.securityPoolSection.securityMultiplierLabel}</span>
								</label>
								<FormInput id='security-pool-security-multiplier' aria-describedby='security-pool-security-multiplier-help' value={securityPoolForm.securityMultiplier} onInput={event => onSecurityPoolFormChange({ securityMultiplier: event.currentTarget.value })} />
								<p className='field-help' id='security-pool-security-multiplier-help'>
									{UI_STRINGS.securityPoolSection.securityMultiplierHelpText}
								</p>
							</div>

							<div className='field'>
								<span>{UI_STRINGS.securityPoolSection.initialOpenInterestFeeLabel}</span>
								<strong>{formatOpenInterestFeePerYearPercent(ORIGIN_POOL_INITIAL_RETENTION_RATE)}</strong>
								<p className='field-help'>{UI_STRINGS.securityPoolSection.initialOpenInterestFeeHelpText}</p>
							</div>

							<div className='actions'>
								<TransactionActionButton idleLabel={createButtonLabel} pendingLabel={UI_STRINGS.securityPoolSection.createPoolButtonPendingLabel} onClick={onCreateSecurityPool} pending={securityPoolCreating} availability={{ disabled: isCreateDisabled, reason: createDisabledReason }} />
							</div>
						</div>
						{!duplicateOriginPoolExists ? undefined : <p className='detail'>{UI_STRINGS.securityPoolSection.duplicatePoolError}</p>}
						{marketDetails !== undefined && marketDetails.marketType !== 'binary' ? <p className='notice error'>{UI_STRINGS.securityPoolSection.ineligibleQuestionError}</p> : undefined}
						{zoltarUniverseHasForked ? <p className='notice error'>{UI_STRINGS.securityPoolSection.creationLockedError}</p> : undefined}
					</SectionBlock>

					<ErrorNotice message={securityPoolError} />
				</>
			)}
		</RouteWorkflowPanel>
	)
}
