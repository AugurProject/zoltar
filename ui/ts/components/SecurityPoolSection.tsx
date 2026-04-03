import { AddressValue } from './AddressValue.js'
import { EntityCard } from './EntityCard.js'
import { LoadingText } from './LoadingText.js'
import { Question } from './Question.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { isMainnetChain } from '../lib/network.js'
import { formatOpenInterestFeePerYearPercent } from '../lib/retentionRate.js'
import type { SecurityPoolSectionProps } from '../types/components.js'

export function SecurityPoolSection({
	accountState,
	checkingDuplicateOriginPool,
	createdQuestionDetails: carriedCreatedQuestionDetails,
	duplicateOriginPoolExists,
	lastCreatedQuestionId,
	loadingMarketDetails,
	marketDetails,
	onCreateSecurityPool,
	onLoadLatestMarket,
	onLoadMarket,
	onSecurityPoolFormChange,
	securityPools,
	securityPoolCreating,
	securityPoolError,
	securityPoolForm,
	securityPoolResult,
	showHeader = true,
}: SecurityPoolSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const isPoolActionPending = securityPoolCreating || checkingDuplicateOriginPool
	const isCreateDisabled = accountState.address === undefined || !isMainnet || isPoolActionPending || duplicateOriginPoolExists || marketDetails?.marketType !== 'binary'
	const matchingPools = marketDetails === undefined ? [] : securityPools.filter(pool => pool.questionId.toLowerCase() === marketDetails.questionId.toLowerCase())
	const hasMatchingSecurityMultiplier = matchingPools.some(pool => pool.securityMultiplier.toString() === securityPoolForm.securityMultiplier.trim())
	const createdQuestionDetails = securityPoolResult === undefined ? undefined : marketDetails?.questionId === securityPoolResult.questionId ? marketDetails : carriedCreatedQuestionDetails
	const createButtonLabel = securityPoolCreating ? <LoadingText>Creating Pool...</LoadingText> : checkingDuplicateOriginPool ? <LoadingText>Checking Duplicate...</LoadingText> : duplicateOriginPoolExists ? 'Pool Already Exists' : matchingPools.length > 0 ? 'Create Another Pool' : 'Create Pool'

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
									<button className='secondary' onClick={onLoadLatestMarket} disabled={lastCreatedQuestionId === undefined || isPoolActionPending}>
										Use Latest Question
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
											<div>
												<span className='metric-label'>Security Multiplier</span>
												<strong>{pool.securityMultiplier.toString()}</strong>
											</div>
											<div>
												<span className='metric-label'>Open Interest Fee / Year</span>
												<strong>{formatOpenInterestFeePerYearPercent(pool.currentRetentionRate)}</strong>
											</div>
										</div>
									</EntityCard>
								))}
							</div>
						</EntityCard>
					)}

					{securityPoolResult === undefined ? undefined : (
						<EntityCard title='Pool created' badge={<span className='badge ok'>Deployed</span>}>
							<Question question={createdQuestionDetails} loading={createdQuestionDetails === undefined} />
							<ul className='status-list hashes'>
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
					)}
				</div>

				<div className='market-column'>
					<div className='form-grid'>
						<label className='field'>
							<span>Question ID</span>
							<input value={securityPoolForm.marketId} onInput={event => onSecurityPoolFormChange({ marketId: event.currentTarget.value })} placeholder='0x...' />
						</label>

						<div className='actions'>
							<button className='secondary' onClick={onLoadMarket} disabled={loadingMarketDetails || isPoolActionPending}>
								{loadingMarketDetails ? <LoadingText>Loading Question...</LoadingText> : 'Load Question'}
							</button>
							<button className='secondary' onClick={onLoadLatestMarket} disabled={lastCreatedQuestionId === undefined || isPoolActionPending}>
								Use Latest Question
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
							<button onClick={onCreateSecurityPool} disabled={isCreateDisabled}>
								{createButtonLabel}
							</button>
						</div>
					</div>

					{!duplicateOriginPoolExists && !hasMatchingSecurityMultiplier ? undefined : <p className='detail'>A pool for this question and security multiplier already exists. Origin pool deployment is deterministic for that pair, so change the security multiplier to create a different pool.</p>}
					{securityPoolError === undefined ? undefined : <p className='notice error'>{securityPoolError}</p>}
				</div>
			</div>
		</section>
	)
}
