import type { ComponentChildren } from 'preact'
import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { CurrencyValue } from './CurrencyValue.js'
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
	onLoadMarket,
	onOpenCreatedPool,
	onSecurityPoolFormChange,
	onResetSecurityPoolCreation,
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

	return (
		<section className='panel market-panel'>
			{showHeader ? (
				<div className='market-header'>
					<div>
						<h2>Create Pool</h2>
					</div>
				</div>
			) : undefined}

			<div className='market-grid'>
				{hasSecurityPoolResult ? (
					<div className='market-column'>
						<EntityCard
							title='Pool created'
							badge={<span className='badge ok'>Deployed</span>}
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
					</div>
				) : (
					<>
						<div className='market-column'>
							{marketDetails === undefined ? undefined : (
								<EntityCard
									title='Question'
									badge={<span className='badge ok'>{marketDetails.marketType}</span>}
									actions={
										<div className='actions'>
											<button className='secondary' onClick={onLoadMarket} disabled={loadingMarketDetails || isPoolActionPending}>
												{loadingMarketDetails ? <LoadingText>Loading Question...</LoadingText> : 'Reload Question'}
											</button>
										</div>
									}
								>
									<Question question={marketDetails} />
									{marketDetails.marketType === 'scalar' ? undefined : (
										<div className='question-chip-row'>
											{marketDetails.outcomeLabels.map(label => (
												<span key={label} className='status-chip muted'>
													{label}
												</span>
											))}
										</div>
									)}
								</EntityCard>
							)}

							{matchingPools.length === 0 ? undefined : (
								<EntityCard title='Existing Pools For This Question' badge={<span className='badge muted'>{matchingPools.length} existing</span>}>
									<div className='entity-card-list'>
										{matchingPools.map(pool => (
											<EntityCard key={pool.securityPoolAddress} className='compact' title={<AddressValue address={pool.securityPoolAddress} />} badge={<span className='badge ok'>{pool.systemState}</span>}>
												<div className='workflow-vault-grid'>
													<MetricField label='Security Multiplier'>{pool.securityMultiplier.toString()}</MetricField>
													<MetricField label='Open Interest Fee / Year'>
														<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix='%' />
													</MetricField>
												</div>
											</EntityCard>
										))}
									</div>
								</EntityCard>
							)}
						</div>

						<div className='market-column'>
							<EntityCard title='Create Pool' badge={<span className='badge muted'>binary</span>}>
								<div className='form-grid'>
									<label className='field'>
										<span>Question ID</span>
										<input value={securityPoolForm.marketId} onInput={event => onSecurityPoolFormChange({ marketId: event.currentTarget.value })} placeholder='0x...' />
									</label>

									<div className='actions'>
										<button className='secondary' onClick={onLoadMarket} disabled={loadingMarketDetails || isPoolActionPending}>
											{loadingMarketDetails ? <LoadingText>Loading Question...</LoadingText> : 'Load Question'}
										</button>
									</div>

									<label className='field'>
										<span>Security Multiplier</span>
										<input value={securityPoolForm.securityMultiplier} onInput={event => onSecurityPoolFormChange({ securityMultiplier: event.currentTarget.value })} />
									</label>

									<label className='field'>
										<span>Open Interest Fee / Year (%)</span>
										<input value={securityPoolForm.currentRetentionRate} onInput={event => onSecurityPoolFormChange({ currentRetentionRate: event.currentTarget.value })} placeholder={formatOpenInterestFeePerYearPercent(999999996848000000n)} />
									</label>

									<label className='field'>
										<span>Starting REP / ETH Price</span>
										<input value={securityPoolForm.startingRepEthPrice} onInput={event => onSecurityPoolFormChange({ startingRepEthPrice: event.currentTarget.value })} />
									</label>

									<div className='actions'>
										<button className='primary' onClick={onCreateSecurityPool} disabled={isCreateDisabled}>
											{createButtonLabel}
										</button>
									</div>
								</div>
							</EntityCard>

							{!duplicateOriginPoolExists && !hasMatchingSecurityMultiplier ? undefined : <p className='detail'>A pool for this question and security multiplier already exists. Origin pool deployment is deterministic for that pair, so change the security multiplier to create a different pool.</p>}
							{marketDetails !== undefined && marketDetails.marketType !== 'binary' ? <p className='notice error'>Security pools can only be created for binary markets. Load a binary market to proceed.</p> : undefined}
							{zoltarUniverseHasForked ? <p className='notice error'>Security pools cannot be created after Zoltar has forked.</p> : undefined}
							<ErrorNotice message={securityPoolError} />
						</div>
					</>
				)}
			</div>
		</section>
	)
}
