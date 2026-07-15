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
import {
	UI_STRING_A_POOL_FOR_THIS_QUESTION_AND_SECURITY_MULTIPLIER_ALREADY_EXISTS_ORIGIN_POOL_DEPLOYMENT_IS_DETERMINISTIC_FOR_THAT_PAIR_SO_CHANGE_THE_SECURITY_MULTIPLIER_TO_CREATE_A_DIFFERENT_POOL,
	UI_STRING_CHECKING_DUPLICATE,
	UI_STRING_CREATE_ANOTHER_POOL,
	UI_STRING_CREATE_POOL,
	UI_STRING_CREATING_POOL,
	UI_STRING_DEPLOYMENT_TRANSACTION_HASH,
	UI_STRING_HEX_VALUE_PLACEHOLDER,
	UI_STRING_INITIAL_OPEN_INTEREST_FEE_YEAR,
	UI_STRING_INITIAL_OPEN_INTEREST_FEE_YEAR_IS_THE_STARTING_ANNUALIZED_FEE_CHARGED_AGAINST_OPEN_INTEREST_THE_RATE_FOLLOWS_POOL_UTILIZATION_AFTER_DEPLOYMENT,
	UI_STRING_LOADING_QUESTION,
	UI_STRING_OPEN_POOL,
	UI_STRING_PASTE_AN_EXACT_BINARY_YES_NO_ZOLTAR_QUESTION_ID,
	UI_STRING_POOL_ADDRESS_SECURITY_POOL_SECTION_POOL_ADDRESS_LABEL,
	UI_STRING_POOL_ALREADY_EXISTS,
	UI_STRING_POOL_CREATED,
	UI_STRING_POOL_CREATION_LOCKED,
	UI_STRING_QUESTION_ID,
	UI_STRING_RETURN_TO_BROWSE,
	UI_STRING_SECURITY_MULTIPLIER,
	UI_STRING_SECURITY_MULTIPLIER_SETS_THE_REP_COLLATERAL_TARGET_RELATIVE_TO_OPEN_INTEREST_HIGHER_VALUES_REQUIRE_MORE_REP_BACKING_AND_CREATE_A_THICKER_SAFETY_BUFFER,
	UI_STRING_SECURITY_POOLS_CAN_ONLY_BE_CREATED_FOR_EXACT_BINARY_YES_NO_QUESTIONS_ENTER_AN_ELIGIBLE_QUESTION_TO_PROCEED,
	UI_STRING_SECURITY_POOLS_CANNOT_BE_CREATED_AFTER_ZOLTAR_HAS_FORKED,
	UI_STRING_UNIVERSE,
} from '../lib/uiStrings.js'
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

	let createButtonLabel: ComponentChildren = UI_STRING_CREATE_POOL
	if (securityPoolCreating) {
		createButtonLabel = <LoadingText>{UI_STRING_CREATING_POOL}</LoadingText>
	} else if (checkingDuplicateOriginPool) {
		createButtonLabel = <LoadingText>{UI_STRING_CHECKING_DUPLICATE}</LoadingText>
	} else if (duplicateOriginPoolExists) {
		createButtonLabel = UI_STRING_POOL_ALREADY_EXISTS
	} else if (zoltarUniverseHasForked) createButtonLabel = UI_STRING_POOL_CREATION_LOCKED

	const createdPoolResult =
		securityPoolResult === undefined ? undefined : (
			<EntityCard
				title={UI_STRING_POOL_CREATED}
				variant='record'
				actions={
					<div className='actions'>
						<button className='primary' onClick={() => onOpenCreatedPool?.(securityPoolResult.securityPoolAddress)}>
							{UI_STRING_OPEN_POOL}
						</button>
						{onReturnToBrowse === undefined ? undefined : (
							<button className='secondary' onClick={onReturnToBrowse}>
								{UI_STRING_RETURN_TO_BROWSE}
							</button>
						)}
						<button className='secondary' onClick={onResetSecurityPoolCreation}>
							{UI_STRING_CREATE_ANOTHER_POOL}
						</button>
					</div>
				}
			>
				<Question question={createdQuestionDetails} loading={createdQuestionDetails === undefined} />
				<ul className='status-list hashes'>
					<li>
						<span>{UI_STRING_POOL_ADDRESS_SECURITY_POOL_SECTION_POOL_ADDRESS_LABEL}</span>
						<strong>
							<AddressValue address={securityPoolResult.securityPoolAddress} />
						</strong>
					</li>
					<li>
						<span>{UI_STRING_SECURITY_MULTIPLIER}</span>
						<strong>{securityPoolResult.securityMultiplier.toString()}</strong>
					</li>
					<li>
						<span>{UI_STRING_UNIVERSE}</span>
						<strong>
							<UniverseLink universeId={securityPoolResult.universeId} />
						</strong>
					</li>
					<li>
						<span>{UI_STRING_DEPLOYMENT_TRANSACTION_HASH}</span>
						<strong>
							<TransactionHashLink hash={securityPoolResult.deployPoolHash} />
						</strong>
					</li>
				</ul>
			</EntityCard>
		)

	return (
		<RouteWorkflowPanel showHeader={showHeader} title={UI_STRING_CREATE_POOL}>
			{hasSecurityPoolResult ? (
				<>
					{createdPoolResult}
					<ErrorNotice message={securityPoolError} />
				</>
			) : (
				<>
					<SectionBlock title={UI_STRING_CREATE_POOL} variant='plain'>
						<div className='form-grid'>
							<div className='field'>
								<LookupFieldRow label={UI_STRING_QUESTION_ID} value={securityPoolForm.marketId} onInput={marketId => onSecurityPoolFormChange({ marketId })} placeholder={UI_STRING_HEX_VALUE_PLACEHOLDER} />
								<p className='field-help'>{UI_STRING_PASTE_AN_EXACT_BINARY_YES_NO_ZOLTAR_QUESTION_ID}</p>
							</div>
							{loadingMarketDetails ? (
								<p className='detail'>
									<LoadingText>{UI_STRING_LOADING_QUESTION}</LoadingText>
								</p>
							) : undefined}
							{marketDetails === undefined ? undefined : (
								<div className='loaded-question-preview'>
									<Question question={marketDetails} variant='preview' />
								</div>
							)}

							<div className='field'>
								<label htmlFor='security-pool-security-multiplier'>
									<span>{UI_STRING_SECURITY_MULTIPLIER}</span>
								</label>
								<FormInput id='security-pool-security-multiplier' aria-describedby='security-pool-security-multiplier-help' value={securityPoolForm.securityMultiplier} onInput={event => onSecurityPoolFormChange({ securityMultiplier: event.currentTarget.value })} />
								<p className='field-help' id='security-pool-security-multiplier-help'>
									{UI_STRING_SECURITY_MULTIPLIER_SETS_THE_REP_COLLATERAL_TARGET_RELATIVE_TO_OPEN_INTEREST_HIGHER_VALUES_REQUIRE_MORE_REP_BACKING_AND_CREATE_A_THICKER_SAFETY_BUFFER}
								</p>
							</div>

							<div className='field'>
								<span>{UI_STRING_INITIAL_OPEN_INTEREST_FEE_YEAR}</span>
								<strong>{formatOpenInterestFeePerYearPercent(ORIGIN_POOL_INITIAL_RETENTION_RATE)}</strong>
								<p className='field-help'>{UI_STRING_INITIAL_OPEN_INTEREST_FEE_YEAR_IS_THE_STARTING_ANNUALIZED_FEE_CHARGED_AGAINST_OPEN_INTEREST_THE_RATE_FOLLOWS_POOL_UTILIZATION_AFTER_DEPLOYMENT}</p>
							</div>

							<div className='actions'>
								<TransactionActionButton idleLabel={createButtonLabel} pendingLabel={UI_STRING_CREATING_POOL} onClick={onCreateSecurityPool} pending={securityPoolCreating} availability={{ disabled: isCreateDisabled, reason: createDisabledReason }} />
							</div>
						</div>
						{!duplicateOriginPoolExists ? undefined : <p className='detail'>{UI_STRING_A_POOL_FOR_THIS_QUESTION_AND_SECURITY_MULTIPLIER_ALREADY_EXISTS_ORIGIN_POOL_DEPLOYMENT_IS_DETERMINISTIC_FOR_THAT_PAIR_SO_CHANGE_THE_SECURITY_MULTIPLIER_TO_CREATE_A_DIFFERENT_POOL}</p>}
						{marketDetails !== undefined && marketDetails.marketType !== 'binary' ? <p className='notice error'>{UI_STRING_SECURITY_POOLS_CAN_ONLY_BE_CREATED_FOR_EXACT_BINARY_YES_NO_QUESTIONS_ENTER_AN_ELIGIBLE_QUESTION_TO_PROCEED}</p> : undefined}
						{zoltarUniverseHasForked ? <p className='notice error'>{UI_STRING_SECURITY_POOLS_CANNOT_BE_CREATED_AFTER_ZOLTAR_HAS_FORKED}</p> : undefined}
					</SectionBlock>

					<ErrorNotice message={securityPoolError} />
				</>
			)}
		</RouteWorkflowPanel>
	)
}
