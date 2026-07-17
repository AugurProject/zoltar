import * as commonCopy from '../../../copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { AddressValue } from '../../../components/AddressValue.js'
import { EntityCard } from '../../../components/EntityCard.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { LookupFieldRow } from '../../../components/LookupFieldRow.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { Question } from '../../markets/components/Question.js'
import { RouteWorkflowPanel } from '../../../components/RouteWorkflowPanel.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionHashLink } from '../../../components/TransactionHashLink.js'
import { UniverseLink } from '../../universes/components/UniverseLink.js'
import { isMainnetChain } from '../../../lib/network.js'
import { formatOpenInterestFeePerYearPercent, ORIGIN_POOL_INITIAL_RETENTION_RATE } from '../lib/retentionRate.js'
import { getSecurityPoolCreateDisabledReason } from '../lib/securityPoolCreationGuards.js'
import type { SecurityPoolSectionProps } from '../../types.js'

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

	let createButtonLabel: ComponentChildren = commonCopy.createPool
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
				title={securityPoolCopy.poolCreated}
				variant='record'
				actions={
					<div className='actions'>
						<button className='primary' onClick={() => onOpenCreatedPool?.(securityPoolResult.securityPoolAddress, securityPoolResult.universeId)}>
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
						<span>{commonCopy.securityMultiplier}</span>
						<strong>{securityPoolResult.securityMultiplier.toString()}</strong>
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
					<SectionBlock title={showHeader ? undefined : commonCopy.createPool} variant='plain'>
						<div className='form-grid'>
							<div className='field'>
								<LookupFieldRow label={commonCopy.questionId} value={securityPoolForm.marketId} onInput={marketId => onSecurityPoolFormChange({ marketId })} placeholder={commonCopy.hexValuePlaceholder} />
								<p className='field-help'>{securityPoolCopy.questionIdInputHint}</p>
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
									<span>{commonCopy.securityMultiplier}</span>
								</label>
								<FormInput id='security-pool-security-multiplier' aria-describedby='security-pool-security-multiplier-help' value={securityPoolForm.securityMultiplier} onInput={event => onSecurityPoolFormChange({ securityMultiplier: event.currentTarget.value })} />
								<p className='field-help' id='security-pool-security-multiplier-help'>
									{securityPoolCopy.securityMultiplierHelpText}
								</p>
							</div>

							<div className='field'>
								<span>{securityPoolCopy.initialOpenInterestFeeYear}</span>
								<strong>{formatOpenInterestFeePerYearPercent(ORIGIN_POOL_INITIAL_RETENTION_RATE)}</strong>
							</div>

							<div className='actions'>
								<TransactionActionButton idleLabel={createButtonLabel} pendingLabel={securityPoolCopy.creatingPool} onClick={onCreateSecurityPool} pending={securityPoolCreating} availability={{ disabled: isCreateDisabled, reason: createDisabledReason }} />
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
