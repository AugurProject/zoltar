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
	const isCreateDisabled = createDisabledReason !== undefined
	let createdQuestionDetails = undefined
	if (securityPoolResult !== undefined)
		if (marketDetails?.questionId === securityPoolResult.questionId) {
			createdQuestionDetails = marketDetails
		} else {
			createdQuestionDetails = carriedPoolCreationMarketDetails
		}

	let createButtonLabel: ComponentChildren = 'Create Pool'
	if (securityPoolCreating) {
		createButtonLabel = <LoadingText>Creating Pool...</LoadingText>
	} else if (checkingDuplicateOriginPool) {
		createButtonLabel = <LoadingText>Checking Duplicate...</LoadingText>
	} else if (duplicateOriginPoolExists) {
		createButtonLabel = 'Pool Already Exists'
	} else if (zoltarUniverseHasForked) createButtonLabel = 'Pool Creation Locked'

	const createdPoolResult =
		securityPoolResult === undefined ? undefined : (
			<EntityCard
				title='Pool Created'
				variant='record'
				actions={
					<div className='actions'>
						<button className='primary' onClick={() => onOpenCreatedPool?.(securityPoolResult.securityPoolAddress)}>
							Open Pool
						</button>
						{onReturnToBrowse === undefined ? undefined : (
							<button className='secondary' onClick={onReturnToBrowse}>
								Return to Browse
							</button>
						)}
						<button className='secondary' onClick={onResetSecurityPoolCreation}>
							Create Another Pool
						</button>
					</div>
				}
			>
				<Question question={createdQuestionDetails} loading={createdQuestionDetails === undefined} />
				<ul className='status-list hashes'>
					<li>
						<span>Pool address</span>
						<strong>
							<AddressValue address={securityPoolResult.securityPoolAddress} />
						</strong>
					</li>
					<li>
						<span>Security Multiplier</span>
						<strong>{securityPoolResult.securityMultiplier.toString()}</strong>
					</li>
					<li>
						<span>Universe</span>
						<strong>
							<UniverseLink universeId={securityPoolResult.universeId} />
						</strong>
					</li>
					<li>
						<span>Deployment transaction hash</span>
						<strong>
							<TransactionHashLink hash={securityPoolResult.deployPoolHash} />
						</strong>
					</li>
				</ul>
			</EntityCard>
		)

	return (
		<RouteWorkflowPanel showHeader={showHeader} title='Create Pool'>
			{hasSecurityPoolResult ? (
				<>
					{createdPoolResult}
					<ErrorNotice message={securityPoolError} />
				</>
			) : (
				<>
					<SectionBlock title='Create Pool' description='Choose the exact binary Yes / No question and security multiplier before deploying the pool that will back trading and reporting for that question.'>
						<div className='workflow-summary-strip workflow-guide'>
							<div className='workflow-guide-intro'>
								<strong>Pool creation turns a binary question into a collateralized trading surface.</strong>
								<p className='detail'>Enter the question, choose how much REP coverage the pool should require, then deploy the pool for vaults, reporting, and trading.</p>
							</div>
							<div className='workflow-summary-strip-steps'>
								<span className='current'>1. Enter a binary question</span>
								<span>2. Choose collateral strength</span>
								<span>3. Deploy the pool</span>
							</div>
						</div>

						<SectionBlock headingLevel={4} title='Before You Deploy' variant='embedded'>
							<ul className='requirements-checklist'>
								<li>Make sure the question title and description are strong enough for users to trust how it will resolve.</li>
								<li>Security pools only work with binary questions.</li>
								<li>Higher security multipliers require more REP backing per unit of open interest and create a thicker safety buffer.</li>
							</ul>
						</SectionBlock>
						<div className='form-grid'>
							<div className='field'>
								<LookupFieldRow label='Question ID' value={securityPoolForm.marketId} onInput={marketId => onSecurityPoolFormChange({ marketId })} placeholder='0x...' />
								<p className='field-help'>Paste an exact binary Yes / No Zoltar question ID.</p>
							</div>
							{loadingMarketDetails ? (
								<p className='detail'>
									<LoadingText>Loading question...</LoadingText>
								</p>
							) : undefined}
							{marketDetails === undefined ? undefined : (
								<div className='loaded-question-preview'>
									<Question question={marketDetails} variant='preview' />
								</div>
							)}

							<div className='field'>
								<label htmlFor='security-pool-security-multiplier'>
									<span>Security Multiplier</span>
								</label>
								<FormInput id='security-pool-security-multiplier' aria-describedby='security-pool-security-multiplier-help' value={securityPoolForm.securityMultiplier} onInput={event => onSecurityPoolFormChange({ securityMultiplier: event.currentTarget.value })} />
								<p className='field-help' id='security-pool-security-multiplier-help'>
									Security Multiplier sets the REP collateral target relative to open interest. Higher values require more REP backing and create a thicker safety buffer.
								</p>
							</div>

							<div className='field'>
								<span>Initial Open Interest Fee / Year</span>
								<strong>{formatOpenInterestFeePerYearPercent(ORIGIN_POOL_INITIAL_RETENTION_RATE)}</strong>
								<p className='field-help'>Initial Open Interest Fee / Year is the starting annualized fee charged against open interest. The rate follows pool utilization after deployment.</p>
							</div>

							<div className='actions'>
								<TransactionActionButton safetyId='security-pool.createPool' idleLabel={createButtonLabel} pendingLabel='Creating Pool...' onClick={onCreateSecurityPool} pending={securityPoolCreating} availability={{ disabled: isCreateDisabled, reason: createDisabledReason }} />
							</div>
						</div>
						{!duplicateOriginPoolExists ? undefined : <p className='detail'>A pool for this question and security multiplier already exists. Origin pool deployment is deterministic for that pair, so change the security multiplier to create a different pool.</p>}
						{marketDetails !== undefined && marketDetails.marketType !== 'binary' ? <p className='notice error'>Security pools can only be created for exact binary Yes / No questions. Enter an eligible question to proceed.</p> : undefined}
						{zoltarUniverseHasForked ? <p className='notice error'>Security pools cannot be created after Zoltar has forked.</p> : undefined}
					</SectionBlock>

					<ErrorNotice message={securityPoolError} />
				</>
			)}
		</RouteWorkflowPanel>
	)
}
