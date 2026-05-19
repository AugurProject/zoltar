import type { ComponentChildren } from 'preact'
import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LoadingText } from './LoadingText.js'
import { Question } from './Question.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { ResultBanner } from './ResultBanner.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { isMainnetChain } from '../lib/network.js'
import { formatOpenInterestFeePerYearPercent } from '../lib/retentionRate.js'
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
	if (securityPoolResult !== undefined) {
		if (marketDetails?.questionId === securityPoolResult.questionId) {
			createdQuestionDetails = marketDetails
		} else {
			createdQuestionDetails = carriedPoolCreationMarketDetails
		}
	}

	let createButtonLabel: ComponentChildren = 'Create Pool'
	if (securityPoolCreating) {
		createButtonLabel = <LoadingText>Creating Pool...</LoadingText>
	} else if (checkingDuplicateOriginPool) {
		createButtonLabel = <LoadingText>Checking Duplicate...</LoadingText>
	} else if (duplicateOriginPoolExists) {
		createButtonLabel = 'Pool Already Exists'
	} else if (zoltarUniverseHasForked) {
		createButtonLabel = 'Pool Creation Locked'
	}

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
			<ResultBanner
				outcome={
					securityPoolResult === undefined
						? undefined
						: {
								title: 'Security pool created',
								detail: (
									<>
										Created pool <AddressValue address={securityPoolResult.securityPoolAddress} />.
									</>
								),
								nextStep: 'Open the pool to begin operating vault, trading, reporting, and fork workflows.',
							}
				}
			/>
			{hasSecurityPoolResult ? (
				<>
					{createdPoolResult}
					<ErrorNotice message={securityPoolError} />
				</>
			) : (
				<>
					<SectionBlock title='Create Pool' description='Configure the binary question, security multiplier, and retention rate before deploying the pool.'>
						<div className='form-grid'>
							<label className='field'>
								<span>Question ID</span>
								<FormInput value={securityPoolForm.marketId} onInput={event => onSecurityPoolFormChange({ marketId: event.currentTarget.value })} placeholder='0x...' />
							</label>
							{loadingMarketDetails ? (
								<p className='detail'>
									<LoadingText>Loading question...</LoadingText>
								</p>
							) : undefined}

							<label className='field'>
								<span>Security Multiplier</span>
								<FormInput value={securityPoolForm.securityMultiplier} onInput={event => onSecurityPoolFormChange({ securityMultiplier: event.currentTarget.value })} />
							</label>

							<label className='field'>
								<span>Open Interest Fee / Year (%)</span>
								<FormInput value={securityPoolForm.currentRetentionRate} onInput={event => onSecurityPoolFormChange({ currentRetentionRate: event.currentTarget.value })} placeholder={formatOpenInterestFeePerYearPercent(999999996848000000n)} />
							</label>

							<div className='actions'>
								<TransactionActionButton idleLabel={createButtonLabel} pendingLabel='Creating Pool...' onClick={onCreateSecurityPool} pending={securityPoolCreating} availability={{ disabled: isCreateDisabled, reason: createDisabledReason }} />
							</div>
						</div>
						{!duplicateOriginPoolExists ? undefined : <p className='detail'>A pool for this question and security multiplier already exists. Origin pool deployment is deterministic for that pair, so change the security multiplier to create a different pool.</p>}
						{marketDetails !== undefined && marketDetails.marketType !== 'binary' ? <p className='notice error'>Security pools can only be created for binary markets. Load a binary market to proceed.</p> : undefined}
						{zoltarUniverseHasForked ? <p className='notice error'>Security pools cannot be created after Zoltar has forked.</p> : undefined}
					</SectionBlock>

					<ErrorNotice message={securityPoolError} />
				</>
			)}
		</RouteWorkflowPanel>
	)
}
