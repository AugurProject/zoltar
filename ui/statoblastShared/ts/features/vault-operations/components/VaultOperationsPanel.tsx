import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { formatCurrencyBalance, formatAmountDisplay } from '@zoltar/ui-core-shared/lib/formatters.js'
import { countVaultPriceActions } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { getVaultOperationsTargetState } from '../lib/targets.js'
import type { VaultOperationsDependencies } from '../hooks/dependencies.js'
import type { ListedSecurityPool } from '../../../types/contracts.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { useVaultOperations } from '../hooks/useVaultOperations.js'
import * as copy from '../../../copy/vaultOperations.js'
import * as priceRequestCopy from '../../../copy/priceRequest.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as liquidationCopy from '../../../copy/liquidation.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import { getPoolExecutionFailureSentence } from '../../security-pools/lib/liquidation.js'
import { useId } from 'preact/hooks'

type Props = { pool: ListedSecurityPool; parameters: WriteOperationsParameters; contextKey: string; networkReady: boolean; embedded?: boolean; onViewStagedOperations: (operationId: bigint) => void; onPoolChanged?: (totalCommitment?: bigint) => void; dependencies?: VaultOperationsDependencies }

export function VaultOperationsPanel({ pool, parameters, contextKey, networkReady, embedded = false, onViewStagedOperations, onPoolChanged, dependencies }: Props) {
	const model = useVaultOperations(pool, parameters, contextKey, dependencies, onPoolChanged)
	const initialPriceId = useId()
	const fieldsDisabled = model.busy
	const operationalFieldsDisabled = fieldsDisabled || model.resolved === true
	const priceActions = model.input === undefined ? 0 : countVaultPriceActions(model.input)
	const fresh = model.quote?.validPrice ?? model.manager?.isPriceValid ?? false
	let actionHint: string | undefined = copy.limits
	if (model.resolved) actionHint = (model.owned?.underwritingLimitAttoEth ?? 0n) > 0n ? copy.resolvedHint : undefined
	let disabledReason: string | undefined
	if (model.busy) disabledReason = undefined
	else if (parameters.accountAddress === undefined) disabledReason = copy.noWallet
	else if (!networkReady) disabledReason = copy.walletWrongNetwork
	else if (pool.systemState !== 'operational' || (pool.universeHasForked && !model.resolved)) disabledReason = copy.poolInactive
	else if (model.loading) disabledReason = copy.loading
	else disabledReason = model.readError ?? model.inputError ?? model.quoteError ?? (model.quote === undefined ? copy.checking : undefined)
	let executionSummary: string | undefined
	if (model.input !== undefined) {
		if (model.resolved) executionSummary = copy.directCommitment
		else if (priceActions === 0) executionSummary = copy.depositOnly
		else if (fresh) executionSummary = copy.fresh
		else if (model.input.depositAttoRep === 0n) executionSummary = copy.queuedNoDeposit
		else executionSummary = copy.queued
	}
	const queuedStatus = model.status?.status
	const unknown = queuedStatus === 'missing'
	const failed = queuedStatus === 'failed' || queuedStatus === 'expired' || queuedStatus === 'superseded'
	const completed = model.result?.stagedExecution?.success === true || queuedStatus === 'executed'
	let resultTitle = copy.confirmedDeposit
	if (model.result?.action === 'commitment') resultTitle = copy.confirmedCommitment
	else if (model.result?.action === 'fees') resultTitle = copy.feesConfirmed
	else if (model.result?.action === 'redeem') resultTitle = copy.repConfirmed
	if (failed) resultTitle = copy.failedOrExpired
	else if (completed) resultTitle = copy.success
	else if (unknown) resultTitle = copy.unknownOutcome
	else if (model.pending) resultTitle = copy.awaiting
	const confirmed = model.result !== undefined && model.result.queuedOperation === undefined
	const resultTone = completed || confirmed ? 'success' : 'warning'
	let resultDetail: string | undefined
	if (failed) resultDetail = getPoolExecutionFailureSentence(model.status?.execution?.errorMessage) ?? copy.laterFailure
	else if (model.pending) resultDetail = copy.laterFailure
	let claimDisabledReason: string | undefined
	if (model.busy) claimDisabledReason = undefined
	else if (parameters.accountAddress === undefined) claimDisabledReason = copy.noWallet
	else if (!networkReady) claimDisabledReason = copy.walletWrongNetwork
	else if (model.loading) claimDisabledReason = copy.loading
	else claimDisabledReason = model.readError
	const feeClaimReason = claimDisabledReason ?? model.feeClaimReason
	const repClaimReason = claimDisabledReason ?? (pool.systemState !== 'operational' ? copy.poolInactive : model.repClaimReason)
	return (
		<div className='vault-operations-flow'>
			<p className='detail'>{model.resolved ? copy.resolvedDescription : copy.description}</p>
			<MetricGrid>
				{!embedded ? <MetricField label={liquidationCopy.receiverVault}>{parameters.accountAddress === undefined ? commonCopy.metricUnavailablePlaceholder : <AddressValue address={parameters.accountAddress} />}</MetricField> : undefined}
				{!embedded ? <MetricField label={copy.currentBacking}>{model.owned === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={model.owned.vaultAttoRepBacking} notation='compact' suffix={commonCopy.rep} />}</MetricField> : undefined}
				{!embedded ? <MetricField label={securityPoolCopy.currentCommitment}>{model.owned === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={model.owned.underwritingLimitAttoEth} notation='compact' suffix={commonCopy.eth} />}</MetricField> : undefined}
				<MetricField label={copy.walletBalance}>{model.balance === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={model.balance} notation='compact' suffix={commonCopy.rep} />}</MetricField>
			</MetricGrid>
			{model.loading ? <UserMessage loading detail={copy.loading} /> : undefined}
			{model.readError === undefined ? undefined : (
				<UserMessage
					tone='error'
					detail={model.readError}
					actions={
						<button type='button' className='secondary' onClick={model.refresh}>
							{commonCopy.retry}
						</button>
					}
				/>
			)}

			<div className='vault-operations-layout'>
				<SectionBlock title={copy.title} variant={embedded ? 'embedded' : 'surface'} className='vault-operations-form'>
					<WorkflowSubsection title={copy.myVault}>
						<div className='vault-operations-fields'>
							<AmountField
								label={copy.deposit}
								value={model.draft.deposit}
								disabled={operationalFieldsDisabled}
								unit={commonCopy.rep}
								hint={model.owned?.minimumVaultRepDepositAttoRep === undefined ? undefined : copy.formatMinimumBacking(formatCurrencyBalance(model.owned.minimumVaultRepDepositAttoRep))}
								fillMax={{ amount: model.balance === undefined ? undefined : model.balance - (model.quote?.funding?.requiredRepAttoRep ?? 0n), unavailableReason: copy.loading }}
								onChange={deposit => model.setDraft({ deposit })}
							/>
							<label className='field'>
								{securityPoolCopy.commitmentLimit}
								<FormInput inputMode='decimal' value={model.draft.commitment} disabled={fieldsDisabled || (!model.resolved && model.commitmentPending)} adornment={commonCopy.eth} hint={copy.unchanged} onInput={event => model.setDraft({ commitment: event.currentTarget.value })} />
							</label>
						</div>
					</WorkflowSubsection>
					<WorkflowSubsection title={copy.liquidations}>
						<p className='detail'>{copy.liquidationHint}</p>
						{model.targets.length === 0 ? (
							<EmptyState title={copy.noTargets} />
						) : (
							<ul className='vault-operations-targets'>
								{model.targets.map(target => {
									const selected = model.draft.liquidations.find(item => item.address.toLowerCase() === target.vaultAddress.toLowerCase())
									const availability = getVaultOperationsTargetState(pool, model.owned, target, model.input, model.price, model.manager?.minLiquidationPriceDistanceBps)
									return (
										<li key={target.vaultAddress}>
											<label className='vault-operations-target-choice'>
												<input type='checkbox' checked={selected !== undefined} disabled={operationalFieldsDisabled || (availability.reason !== undefined && selected === undefined)} onChange={() => model.toggle(target)} />
												<span>
													<AddressValue address={target.vaultAddress} />
													<small>{copy.formatTargetSummary(formatAmountDisplay(target.vaultAttoRepBacking, { notation: 'compact' }), formatAmountDisplay(target.underwritingLimitAttoEth, { notation: 'compact' }))}</small>
													<small>{availability.reason ?? copy.formatTargetMaximum(formatAmountDisplay(availability.maximum ?? 0n, { notation: 'compact' }))}</small>
												</span>
											</label>
											{selected === undefined ? undefined : (
												<AmountField
													label={liquidationCopy.requestedLiquidationDebt}
													unit={commonCopy.eth}
													disabled={operationalFieldsDisabled}
													value={selected.amount}
													fillMax={{ amount: availability.maximum, unavailableReason: availability.reason }}
													onChange={amount => model.setDraft({ liquidations: model.draft.liquidations.map(item => (item === selected ? { ...item, amount } : item)) })}
												/>
											)}
										</li>
									)
								})}
							</ul>
						)}
						<label className='field vault-operations-lookup'>
							{copy.lookup}
							<FormInput
								value={model.lookupAddress}
								disabled={fieldsDisabled || model.lookupBusy}
								error={model.lookupError}
								onInput={event => model.setLookupAddress(event.currentTarget.value)}
								action={
									<TransactionActionButton
										tone='secondary'
										idleLabel={copy.lookupAction}
										pendingLabel={copy.lookupPending}
										pending={model.lookupBusy}
										onClick={() => void model.lookup()}
										availability={{ disabled: fieldsDisabled || model.lookupAddress.trim() === '', reason: model.busy ? undefined : copy.enterTarget }}
									/>
								}
							/>
						</label>
					</WorkflowSubsection>
					<WorkflowSubsection title={copy.withdrawal}>
						<AmountField
							label={copy.withdraw}
							value={model.draft.withdraw}
							disabled={operationalFieldsDisabled}
							unit={commonCopy.rep}
							hint={copy.withdrawHint}
							fillMax={{ amount: fresh ? model.withdrawMaximum : undefined, unavailableReason: fresh ? copy.noWithdrawal : copy.unavailableMaximum }}
							onChange={withdraw => model.setDraft({ withdraw })}
						/>
					</WorkflowSubsection>
					{fresh || model.resolved ? undefined : (
						<WorkflowSubsection title={statoblastAppCopy.openOracle}>
							<label className='field'>
								{securityPoolCopy.executionWindow}
								<FormInput type='number' min='1' max='5' step='1' value={model.draft.timeoutMinutes} disabled={fieldsDisabled} hint={securityPoolCopy.executionWindowHelpText} onInput={event => model.setDraft({ timeoutMinutes: event.currentTarget.value })} />
							</label>
							<div className='field vault-operations-price'>
								<label htmlFor={initialPriceId}>{copy.initialPrice}</label>
								<FormInput
									id={initialPriceId}
									inputMode='decimal'
									adornment={commonCopy.repPerEth}
									value={model.draft.proposedPrice}
									placeholder={formatCurrencyBalance(model.manager?.lastPrice ?? pool.lastOraclePrice ?? 0n)}
									disabled={fieldsDisabled}
									hint={copy.initialPriceHint}
									error={model.priceFetchError}
									action={
										<button type='button' className='secondary request-price-fetch' disabled={fieldsDisabled || model.fetchingPrice || model.loading || !networkReady} aria-busy={model.fetchingPrice} onClick={() => void model.fetchPrice()}>
											{model.fetchingPrice ? priceRequestCopy.fetchingUniswapPrice : priceRequestCopy.fetchUniswapPrice}
										</button>
									}
									onInput={event => model.setDraft({ proposedPrice: event.currentTarget.value })}
								/>
							</div>
						</WorkflowSubsection>
					)}
					<WorkflowSubsection title={copy.claims}>
						<MetricGrid>
							<MetricField label={securityPoolCopy.claimableFees}>
								<CurrencyValue value={model.owned?.claimableFeesAttoEth ?? 0n} notation='compact' suffix={commonCopy.eth} />
							</MetricField>
						</MetricGrid>
						<div className='actions'>
							<TransactionActionButton
								idleLabel={securityPoolCopy.claimFees}
								pendingLabel={securityPoolCopy.claimingFees}
								pending={model.busyAction === 'fees'}
								onClick={() => void model.claimFees()}
								availability={{ disabled: model.busy || feeClaimReason !== undefined, reason: model.busy ? undefined : feeClaimReason }}
							/>
							<TransactionActionButton
								idleLabel={copy.redeemRep}
								pendingLabel={securityPoolCopy.formatRedeemingRep(commonCopy.rep)}
								pending={model.busyAction === 'redeem'}
								onClick={() => void model.redeemRep()}
								availability={{ disabled: model.busy || repClaimReason !== undefined, reason: model.busy ? undefined : repClaimReason }}
							/>
						</div>
						{model.claimError === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={model.claimError} />}
						{model.claimResult === undefined ? undefined : (
							<UserMessage
								placement='section'
								tone='success'
								announcement='polite'
								title={model.claimResult.action === 'fees' ? copy.feesConfirmed : copy.repConfirmed}
								actions={
									<>
										<TransactionHashLink hash={model.claimResult.hash} />
										<button type='button' className='secondary' onClick={model.dismissClaimResult}>
											{transactionCopy.dismiss}
										</button>
									</>
								}
							/>
						)}
					</WorkflowSubsection>
				</SectionBlock>
				<SectionBlock title={copy.preview} variant={embedded ? 'embedded' : 'surface'} className='vault-operations-preview'>
					<dl className='vault-operations-summary'>
						<div>
							<dt>{copy.previewDeposit}</dt>
							<dd>
								<CurrencyValue value={model.input?.depositAttoRep ?? 0n} notation='compact' suffix={commonCopy.rep} />
							</dd>
						</div>
						<div>
							<dt>{copy.previewLiquidations}</dt>
							<dd>{model.draft.liquidations.length}</dd>
						</div>
						<div>
							<dt>{copy.withdrawal}</dt>
							<dd>
								<CurrencyValue value={model.input?.withdrawAttoRep ?? 0n} notation='compact' suffix={commonCopy.rep} />
							</dd>
						</div>
						<div>
							<dt>{copy.finalCommitment}</dt>
							<dd>{model.preview === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={model.preview.commitment} notation='compact' suffix={commonCopy.eth} />}</dd>
						</div>
						<div>
							<dt>{copy.resultingBacking}</dt>
							<dd>{model.preview === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={model.preview.backing} notation='compact' suffix={commonCopy.rep} />}</dd>
						</div>
						<div>
							<dt>{copy.oracleFunding}</dt>
							<dd>{model.bounty === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue copyable decimals={4} notation='compact' value={model.bounty} suffix={commonCopy.eth} />}</dd>
						</div>
						{model.quote?.funding === undefined ? undefined : (
							<>
								<div>
									<dt>{copy.reportRep}</dt>
									<dd>
										<CurrencyValue copyable decimals={4} notation='compact' value={model.quote.funding.requiredRepAttoRep} suffix={commonCopy.rep} />
									</dd>
								</div>
								<div>
									<dt>{copy.reportWeth}</dt>
									<dd>
										<CurrencyValue copyable decimals={4} notation='compact' value={model.quote.funding.minimumToken1ReportAttoEth} suffix={commonCopy.weth} />
									</dd>
								</div>
							</>
						)}
					</dl>
					{executionSummary === undefined ? undefined : <p className={fresh ? 'detail' : 'warning'}>{executionSummary}</p>}
					{priceActions === 0 || model.resolved ? undefined : (
						<p className='detail'>
							{copy.estimateHint} {fresh ? copy.freshFailure : copy.queuedFailure} {!fresh && (model.input?.depositAttoRep ?? 0n) > 0n ? copy.laterFailure : ''}
						</p>
					)}
					{actionHint === undefined ? undefined : <p className='detail'>{actionHint}</p>}
					{model.error === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={model.error} />}
					<TransactionActionButton idleLabel={model.resolved ? copy.reviewCommitment : copy.review} pendingLabel={copy.pending} pending={model.busyAction === 'bundle'} onClick={() => void model.submit()} availability={{ disabled: model.busy || disabledReason !== undefined, reason: disabledReason }} />
					<TransactionActionButton tone='secondary' idleLabel={copy.clearDraft} pendingLabel={copy.clearDraft} pending={false} onClick={model.clearDraft} availability={{ disabled: model.busy, reason: undefined }} />
					{model.result === undefined && !model.pending ? undefined : (
						<UserMessage
							placement='section'
							tone={failed ? 'error' : resultTone}
							announcement='polite'
							title={resultTitle}
							detail={resultDetail}
							actions={
								<>
									{model.result === undefined ? undefined : <TransactionHashLink hash={model.result.hash} />}
									{model.result?.queuedOperation === undefined ? undefined : (
										<button
											type='button'
											className='secondary'
											onClick={() => {
												if (model.result?.queuedOperation !== undefined) onViewStagedOperations(model.result.queuedOperation.operationId)
											}}
										>
											{copy.reviewStaged}
										</button>
									)}
									{model.pending ? undefined : (
										<button type='button' className='secondary' onClick={model.dismissResult}>
											{transactionCopy.dismiss}
										</button>
									)}
								</>
							}
						/>
					)}
				</SectionBlock>
			</div>
		</div>
	)
}
