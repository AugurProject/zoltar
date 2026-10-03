import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
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

type Props = { pool: ListedSecurityPool; parameters: WriteOperationsParameters; contextKey: string; networkReady: boolean; onViewStagedOperations: () => void; onPoolChanged?: (totalCommitment?: bigint) => void; dependencies?: VaultOperationsDependencies }

export function VaultOperationsPanel({ pool, parameters, contextKey, networkReady, onViewStagedOperations, onPoolChanged, dependencies }: Props) {
	const model = useVaultOperations(pool, parameters, contextKey, dependencies, onPoolChanged)
	const fieldsDisabled = model.busy
	const priceActions = model.input === undefined ? 0 : countVaultPriceActions(model.input)
	const fresh = model.quote?.validPrice ?? model.manager?.isPriceValid ?? false
	let disabledReason: string | undefined
	if (parameters.accountAddress === undefined) disabledReason = copy.noWallet
	else if (!networkReady) disabledReason = copy.walletWrongNetwork
	else if (pool.systemState !== 'operational' || pool.universeHasForked) disabledReason = copy.poolInactive
	else if (model.loading) disabledReason = copy.loading
	else disabledReason = model.readError ?? model.inputError ?? model.quoteError ?? (model.quote === undefined ? copy.checking : undefined)
	let executionTitle: string | undefined
	if (model.input !== undefined) {
		if (priceActions === 0) executionTitle = copy.depositOnly
		else if (fresh) executionTitle = copy.fresh
		else if (model.input.depositAttoRep === 0n) executionTitle = copy.queuedNoDeposit
		else executionTitle = copy.queued
	}
	const queuedStatus = model.status?.status
	const unknown = queuedStatus === 'missing'
	const failed = queuedStatus === 'failed' || queuedStatus === 'expired' || queuedStatus === 'superseded'
	const completed = model.result?.stagedExecution?.success === true || queuedStatus === 'executed'
	let resultTitle = copy.confirmedDeposit
	if (failed) resultTitle = copy.failedBundle
	else if (completed) resultTitle = copy.success
	else if (unknown) resultTitle = copy.unknownOutcome
	else if (model.pending) resultTitle = copy.awaiting
	const resultTone = completed ? 'success' : 'warning'
	let resultDetail: string | undefined
	if (failed) resultDetail = model.status?.execution?.errorMessage ?? copy.laterFailure
	else if (model.pending) resultDetail = copy.laterFailure
	return (
		<div className='vault-operations-flow'>
			<p className='detail'>{copy.description}</p>
			<MetricGrid>
				<MetricField label={copy.receiver}>{parameters.accountAddress === undefined ? copy.unavailable : <AddressValue address={parameters.accountAddress} />}</MetricField>
				<MetricField label={copy.currentBacking}>{model.owned === undefined ? copy.unavailable : <CurrencyValue value={model.owned.vaultAttoRepBacking} notation='compact' suffix={commonCopy.rep} />}</MetricField>
				<MetricField label={copy.currentCommitment}>{model.owned === undefined ? copy.unavailable : <CurrencyValue value={model.owned.underwritingLimitAttoEth} notation='compact' suffix={commonCopy.eth} />}</MetricField>
				<MetricField label={copy.walletBalance}>{model.balance === undefined ? copy.unavailable : <CurrencyValue value={model.balance} notation='compact' suffix={commonCopy.rep} />}</MetricField>
			</MetricGrid>
			{model.loading ? <UserMessage loading detail={copy.loading} /> : undefined}
			{model.readError === undefined ? undefined : (
				<UserMessage
					tone='error'
					detail={model.readError}
					actions={
						<button type='button' className='secondary' onClick={model.refresh}>
							{copy.retry}
						</button>
					}
				/>
			)}
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
								<button type='button' className='secondary' onClick={onViewStagedOperations}>
									{copy.reviewStaged}
								</button>
							)}
							{model.pending ? undefined : (
								<button type='button' className='secondary' onClick={model.dismissResult}>
									{copy.dismiss}
								</button>
							)}
						</>
					}
				/>
			)}
			<div className='vault-operations-layout'>
				<SectionBlock title={copy.title} variant='surface' className='vault-operations-form'>
					<WorkflowSubsection title={copy.myVault}>
						<div className='vault-operations-fields'>
							<label className='field'>
								{copy.deposit}
								<FormInput inputMode='decimal' value={model.draft.deposit} disabled={fieldsDisabled} adornment='REP' onInput={event => model.setDraft({ deposit: event.currentTarget.value })} />
							</label>
							<label className='field'>
								{copy.commitment}
								<FormInput inputMode='decimal' value={model.draft.commitment} disabled={fieldsDisabled || model.commitmentPending} adornment='ETH' hint={copy.unchanged} onInput={event => model.setDraft({ commitment: event.currentTarget.value })} />
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
												<input type='checkbox' checked={selected !== undefined} disabled={fieldsDisabled || (availability.reason !== undefined && selected === undefined)} onChange={() => model.toggle(target)} />
												<span>
													<AddressValue address={target.vaultAddress} />
													<small>{copy.formatTargetSummary(formatAmountDisplay(target.vaultAttoRepBacking, { notation: 'compact' }), formatAmountDisplay(target.underwritingLimitAttoEth, { notation: 'compact' }))}</small>
													<small>{availability.reason ?? copy.formatTargetMaximum(formatAmountDisplay(availability.maximum ?? 0n, { notation: 'compact' }))}</small>
												</span>
											</label>
											{selected === undefined ? undefined : (
												<label className='field vault-operations-target-amount'>
													{copy.amount}
													<FormInput inputMode='decimal' adornment='ETH' disabled={fieldsDisabled} value={selected.amount} onInput={event => model.setDraft({ liquidations: model.draft.liquidations.map(item => (item === selected ? { ...item, amount: event.currentTarget.value } : item)) })} />
												</label>
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
									<TransactionActionButton tone='secondary' idleLabel={copy.lookupAction} pendingLabel={copy.loading} pending={model.lookupBusy} onClick={() => void model.lookup()} availability={{ disabled: fieldsDisabled || model.lookupAddress.trim() === '', reason: model.busy ? copy.pending : copy.enterTarget }} />
								}
							/>
						</label>
					</WorkflowSubsection>
					<WorkflowSubsection title={copy.withdrawal}>
						<label className='field'>
							{copy.withdraw}
							<FormInput inputMode='decimal' value={model.draft.withdraw} disabled={fieldsDisabled} adornment='REP' hint={copy.withdrawHint} onInput={event => model.setDraft({ withdraw: event.currentTarget.value })} />
						</label>
					</WorkflowSubsection>
					{fresh ? undefined : (
						<WorkflowSubsection title={copy.oracle}>
							<label className='field'>
								{copy.initialPrice}
								<FormInput
									inputMode='decimal'
									adornment='REP / ETH'
									value={model.draft.proposedPrice}
									placeholder={formatCurrencyBalance(model.manager?.lastPrice ?? pool.lastOraclePrice ?? 0n)}
									disabled={fieldsDisabled}
									hint={copy.initialPriceHint}
									onInput={event => model.setDraft({ proposedPrice: event.currentTarget.value })}
								/>
							</label>
						</WorkflowSubsection>
					)}
				</SectionBlock>
				<SectionBlock title={copy.preview} variant='surface' className='vault-operations-preview'>
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
							<dd>{model.preview === undefined ? copy.unavailable : <CurrencyValue value={model.preview.commitment} notation='compact' suffix={commonCopy.eth} />}</dd>
						</div>
						<div>
							<dt>{copy.resultingBacking}</dt>
							<dd>{model.preview === undefined ? copy.unavailable : <CurrencyValue value={model.preview.backing} notation='compact' suffix={commonCopy.rep} />}</dd>
						</div>
						<div>
							<dt>{copy.oracleFunding}</dt>
							<dd>{model.bounty === undefined ? copy.unavailable : <CurrencyValue copyable decimals={4} notation='compact' value={model.bounty} suffix={commonCopy.eth} />}</dd>
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
					{executionTitle === undefined ? undefined : <p className={fresh ? 'detail' : 'warning'}>{executionTitle}</p>}
					{priceActions === 0 ? undefined : (
						<p className='detail'>
							{copy.estimateHint} {fresh ? copy.freshFailure : copy.queuedFailure} {!fresh && (model.input?.depositAttoRep ?? 0n) > 0n ? copy.laterFailure : ''}
						</p>
					)}
					<p className='detail'>{copy.limits}</p>
					{model.error === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={model.error} />}
					<TransactionActionButton idleLabel={copy.review} pendingLabel={copy.pending} pending={model.busy} onClick={() => void model.submit()} availability={{ disabled: disabledReason !== undefined, reason: disabledReason }} />
				</SectionBlock>
			</div>
		</div>
	)
}
