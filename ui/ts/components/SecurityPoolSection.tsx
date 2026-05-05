import type { ComponentChildren } from 'preact'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OpenInterestCapacityMetrics } from './OpenInterestCapacityMetrics.js'
import { Question } from './Question.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { isMainnetChain } from '../lib/network.js'
import { formatOpenInterestFeePerYearPercent, openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import type { SecurityPoolSectionProps } from '../types/components.js'

export function SecurityPoolSection({
	accountState,
	checkingDuplicateOriginPool,
	duplicateOriginPoolExists,
	loadingMarketDetails,
	marketDetails,
	onCreateSecurityPool,
	onOpenCreatedPool,
	onSecurityPoolFormChange,
	onResetSecurityPoolCreation,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	securityPools,
	securityPoolCreating,
	securityPoolError,
	securityPoolForm,
	securityPoolResult,
	showHeader = true,
	poolCreationMarketDetails: carriedPoolCreationMarketDetails,
	zoltarUniverseHasForked,
}: SecurityPoolSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const isPoolActionPending = securityPoolCreating || checkingDuplicateOriginPool
	const hasSecurityPoolResult = securityPoolResult !== undefined
	const isCreateDisabled = accountState.address === undefined || !isMainnet || isPoolActionPending || duplicateOriginPoolExists || marketDetails?.marketType !== 'binary' || zoltarUniverseHasForked
	const createDisabledReason =
		accountState.address === undefined
			? 'Connect a wallet before creating a security pool.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before creating a security pool.'
				: checkingDuplicateOriginPool
					? 'Checking whether a pool already exists for this question and security multiplier.'
					: securityPoolCreating
						? 'Security pool creation is already in progress.'
						: duplicateOriginPoolExists
							? 'A pool for this question and security multiplier already exists.'
							: marketDetails === undefined
								? 'Load a binary market before creating a pool.'
								: marketDetails.marketType !== 'binary'
									? 'Security pools can only be created for binary markets.'
									: zoltarUniverseHasForked
										? 'Security pools cannot be created after Zoltar has forked.'
										: undefined
	const matchingPools = marketDetails === undefined ? [] : securityPools.filter(pool => sameCaseInsensitiveText(pool.questionId, marketDetails.questionId))
	const hasMatchingSecurityMultiplier = matchingPools.some(pool => pool.securityMultiplier.toString() === securityPoolForm.securityMultiplier.trim())
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
	} else if (matchingPools.length > 0) {
		createButtonLabel = 'Create Another Pool'
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
					<SectionBlock title='Question Context' description='Load a binary market question before configuring pool parameters.'>
						{marketDetails === undefined && !loadingMarketDetails ? <p className='detail'>Enter a question ID in the create form to inspect the market context.</p> : <Question question={marketDetails} loading={loadingMarketDetails && marketDetails === undefined} />}
					</SectionBlock>
					<SectionBlock title='Existing Pools' description='Existing pools for this question remain record surfaces.'>
						{matchingPools.length === 0 ? (
							<p className='detail'>No pools have been created for this question yet.</p>
						) : (
							<div className='entity-card-list'>
								{matchingPools.map(pool => (
									<EntityCard key={pool.securityPoolAddress} className='compact' title={<AddressValue address={pool.securityPoolAddress} />} badge={<span className='badge ok'>{pool.systemState}</span>}>
										<div className='workflow-vault-grid'>
											<MetricField label='Security Multiplier'>{pool.securityMultiplier.toString()}</MetricField>
											<MetricField label='Open Interest Fee / Year'>
												<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix='%' />
											</MetricField>
											<OpenInterestCapacityMetrics
												completeSetCollateralAmount={pool.completeSetCollateralAmount}
												repPerEthPrice={repPerEthPrice}
												repPerEthSource={repPerEthSource}
												repPerEthSourceUrl={repPerEthSourceUrl}
												securityMultiplier={pool.securityMultiplier}
												totalRepDeposit={pool.totalRepDeposit}
												totalSecurityBondAllowance={pool.totalSecurityBondAllowance}
											/>
										</div>
									</EntityCard>
								))}
							</div>
						)}
					</SectionBlock>

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
						{!duplicateOriginPoolExists && !hasMatchingSecurityMultiplier ? undefined : <p className='detail'>A pool for this question and security multiplier already exists. Origin pool deployment is deterministic for that pair, so change the security multiplier to create a different pool.</p>}
						{marketDetails !== undefined && marketDetails.marketType !== 'binary' ? <p className='notice error'>Security pools can only be created for binary markets. Load a binary market to proceed.</p> : undefined}
						{zoltarUniverseHasForked ? <p className='notice error'>Security pools cannot be created after Zoltar has forked.</p> : undefined}
					</SectionBlock>

					<ErrorNotice message={securityPoolError} />
				</>
			)}
		</RouteWorkflowPanel>
	)
}
