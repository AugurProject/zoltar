import { TransactionActionButton, TransactionActionGroup, TransactionActionButtonLockProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import * as copy from '../../copy/transactionSteps.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { useEffect } from 'preact/hooks'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { transactionSteps } from './transactionSteps.js'

function EthAmount({ value }: { value: bigint | undefined }) {
	const useNanoEth = value !== undefined && value > 0n && value < 10n ** 15n
	return <CurrencyValue precision='exact' copyable={false} value={value} units={useNanoEth ? 9 : 18} suffix={useNanoEth ? copy.nanoEth : commonCopy.eth} />
}

export function TransactionStepsModal({ contextKey }: { contextKey: string }) {
	useEffect(() => () => transactionSteps.peek()?.cancel(), [contextKey])
	const presentation = useGlobalTransactionPresentation()
	useEffect(() => {
		if (presentation?.tone === 'success') transactionSteps.value?.finish()
	}, [presentation?.tone, presentation?.hash])
	const workflow = transactionSteps.value
	const current = workflow?.steps[workflow.activeIndex]
	if (workflow === undefined || current === undefined) return undefined
	const operationFailed = presentation?.tone === 'error'
	const operationError = typeof presentation?.detail === 'string' ? presentation.detail : copy.requirementsFailed
	const error = current.error ?? (operationFailed ? operationError : undefined)
	const pending = error === undefined && workflow.steps.some(step => step.phase === 'pending')
	const completed = workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const outcome = workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome
	const fundingReason = funding.length > 0 ? copy.fundingRequired : copy.prerequisitesRequired
	const blockedReason = pending ? copy.transactionPending : fundingReason
	const totalEth = workflow.steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n)
	const renderTransactionActions = () => (
		<>
			<TransactionActionGroup message={undefined}>
				{workflow.steps.map((step, index) => {
					const active = index === workflow.activeIndex
					const ready = step.phase === 'review' && !pending && error === undefined
					const status = { skipped: copy.skipped, upcoming: step.optional ? copy.ifNeeded : undefined, review: undefined, pending: undefined, confirmed: copy.confirmed, failed: copy.notCompleted }[step.phase]
					const detail = [step.phase === 'upcoming' || step.approval !== undefined ? undefined : step.amount, status].filter(value => value !== undefined).join(' · ')
					return (
						<div key={index} className={`transaction-plan-action${step.approval === undefined ? ' transaction-plan-action-wide' : ''}`}>
							{step.approval !== undefined && (step.phase === 'review' || step.phase === 'pending' || step.phase === 'upcoming') ? (
								<TokenApprovalControl
									compact
									showRequirementNotice={false}
									actionLabel={copy.fundReport}
									allowanceError={undefined}
									allowanceLoading={false}
									approvedAmount={step.approval.approvedAmount}
									guardMessage={undefined}
									disabled={!ready}
									onApprove={amount => workflow.confirmStep(index, amount)}
									pending={step.phase === 'pending'}
									pendingLabel={commonCopy.formatApprovingToken(step.approval.tokenSymbol)}
									requiredAmount={step.approval.requiredAmount}
									resetKey={`${contextKey}:${index}`}
									tokenSymbol={step.approval.tokenSymbol}
									tokenUnits={step.approval.tokenUnits}
								/>
							) : (
								<TransactionActionButton
									idleLabel={
										<>
											{step.title}
											{(step.ethValueAttoEth ?? 0n) === 0n ? undefined : (
												<>
													{' '}
													· <EthAmount value={step.ethValueAttoEth} />
												</>
											)}
											{detail === '' ? undefined : <span className='transaction-action-detail'>{detail}</span>}
										</>
									}
									pendingLabel={copy.formatPendingAction(step.title)}
									pending={active && pending}
									onClick={() => {
										if (ready) workflow.confirmStep(index)
									}}
									availability={{ disabled: !ready, reason: step.phase === 'upcoming' ? blockedReason : status }}
									showDisabledReason={false}
									tone={step.approval === undefined ? 'primary' : 'secondary'}
								/>
							)}
						</div>
					)
				})}
			</TransactionActionGroup>
			<div className='actions transaction-step-close'>
				<button className='secondary' type='button' onClick={workflow.cancel} disabled={pending}>
					{completed || error !== undefined ? commonCopy.close : copy.cancelRemaining}
				</button>
			</div>
		</>
	)
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>
				<OperationModal isOpen closeDisabled={pending} title={copy.title} description={completed ? copy.completed : copy.sequenceDetail} onClose={workflow.cancel}>
					<div className='transaction-step-content'>
						{funding.length === 0 ? undefined : (
							<section className='transaction-funding' aria-label={copy.depositAndReturn}>
								<div className='transaction-funding-summary'>
									<h4>{copy.depositAndReturn}</h4>
									<div className='transaction-deposits'>
										{funding.map(token => (
											<strong key={token.amount}>{token.amount}</strong>
										))}
									</div>
									{outcome === undefined ? undefined : <p className='detail'>{outcome.returnToWallet ? copy.coordinatorReturnDetail : copy.standaloneReturnDetail}</p>}
								</div>
								<div className='transaction-funding-summary'>
									<dl className='transaction-costs'>
										<div>
											<dt>{copy.totalEth}</dt>
											<dd>
												<EthAmount value={totalEth} />
											</dd>
										</div>
										{outcome === undefined ? undefined : (
											<>
												<div>
													<dt>{copy.settlementBounty}</dt>
													<dd>
														<EthAmount value={outcome.settlerRewardAttoEth} />
													</dd>
												</div>
												<div>
													<dt>{copy.ethRefund}</dt>
													<dd>
														<EthAmount value={outcome.ethRefundAttoEth} />
													</dd>
												</div>
											</>
										)}
									</dl>
									{outcome === undefined ? undefined : <p className='detail'>{copy.settlementCostDetail}</p>}
								</div>
							</section>
						)}

						{funding.length === 0 || completed ? undefined : <p className='detail transaction-funding-note'>{copy.fundingDetail}</p>}
						<details className='transaction-technical-details'>
							<summary>{copy.technicalDetails}</summary>
							{workflow.steps.map((step, index) => (
								<p key={index} className='detail'>
									<strong>{step.title}: </strong>
									{step.description}
									{step.amount === undefined ? undefined : <span className='transaction-action-detail'>{step.amount}</span>}
								</p>
							))}
							<dl className='transaction-costs'>
								<div>
									<dt>{copy.recipient}</dt>
									<dd>
										<AddressValue address={current.contractAddress} responsiveAbbreviation />
									</dd>
								</div>
								{current.spender === undefined ? undefined : (
									<div>
										<dt>{copy.spender}</dt>
										<dd>
											<AddressValue address={current.spender} responsiveAbbreviation />
										</dd>
									</div>
								)}
							</dl>
							{workflow.steps
								.filter(step => step.hash !== undefined)
								.map((step, index) => (
									<div key={index}>
										<strong>{step.title}</strong>
										{step.hash === undefined ? undefined : <TransactionHashLink hash={step.hash} />}
									</div>
								))}
						</details>
						{error === undefined ? undefined : <ErrorNotice message={error} />}
					</div>
					<div className='transaction-step-actions transaction-approval-editor'>{renderTransactionActions()}</div>
				</OperationModal>
			</TransactionActionButtonLockProvider>
		</GlobalTransactionPresentationProvider>
	)
}
