import { TransactionActionGroup, TransactionActionButtonLockProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import * as copy from '../../copy/transactionSteps.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { useEffect, useState } from 'preact/hooks'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { transactionSteps } from './transactionSteps.js'

function EthAmount({ value }: { value: bigint | undefined }) {
	const useGwei = value !== undefined && value > 0n && value < 10n ** 15n
	return <CurrencyValue precision='exact' copyable={false} value={value} units={useGwei ? 9 : 18} suffix={useGwei ? copy.gwei : commonCopy.eth} />
}

export function TransactionStepsModal({ contextKey }: { contextKey: string }) {
	useEffect(() => () => transactionSteps.peek()?.cancel(), [contextKey])
	const presentation = useGlobalTransactionPresentation()
	useEffect(() => {
		if (presentation?.tone === 'success') transactionSteps.value?.finish()
	}, [presentation?.tone, presentation?.hash])
	const [editingApproval, setEditingApproval] = useState(false)
	const workflow = transactionSteps.value
	useEffect(() => setEditingApproval(false), [contextKey, workflow?.activeIndex])
	const current = workflow?.steps[workflow.activeIndex]
	if (workflow === undefined || current === undefined) return undefined
	const pending = current.phase === 'pending'
	const completed = workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const outcome = workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome
	const totalEth = workflow.steps.reduce((sum, step) => sum + (step.ethValueAttoEth ?? 0n), 0n)
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>
				<OperationModal isOpen closeDisabled={pending} title={copy.title} description={completed ? copy.completed : copy.sequenceDetail} onClose={workflow.cancel}>
					<div className='transaction-step-content'>
						<div className='transaction-plan-grid'>
							{funding.length === 0 || editingApproval ? undefined : (
								<section className='transaction-funding' aria-label={copy.depositAndReturn}>
									<h4>{copy.depositAndReturn}</h4>
									<div className='transaction-deposits'>
										{funding.map(token => (
											<strong key={token.amount}>{token.amount}</strong>
										))}
									</div>
									{outcome === undefined ? undefined : <p className='detail'>{outcome.returnToWallet ? copy.coordinatorReturnDetail : copy.standaloneReturnDetail}</p>}
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
								</section>
							)}
							<ol className='transaction-plan-list' aria-live='polite'>
								{workflow.steps.map((step, index) => (
									<li key={index} aria-current={index === workflow.activeIndex ? 'step' : undefined}>
										<div className='transaction-step-heading'>
											<strong>{step.title}</strong>
											<span className='detail'>{{ skipped: copy.skipped, upcoming: step.optional ? copy.ifNeeded : copy.upcoming, review: copy.ready, pending: copy.pending, confirmed: copy.confirmed, failed: copy.notCompleted }[step.phase]}</span>
										</div>
										{step.amount === undefined ? undefined : (
											<div className='transaction-step-amount'>
												{step.approval !== undefined && (step.phase === 'review' || step.phase === 'upcoming') ? <>{copy.requiredApproval} </> : undefined}
												{step.amount}
											</div>
										)}
										{(step.ethValueAttoEth ?? 0n) === 0n ? undefined : <EthAmount value={step.ethValueAttoEth} />}
										{step.spender === undefined ? <p className='detail'>{step.description}</p> : undefined}
									</li>
								))}
							</ol>
						</div>
						{funding.length === 0 || editingApproval || completed ? undefined : <p className='detail transaction-funding-note'>{copy.fundingDetail}</p>}
						<details className='transaction-technical-details'>
							<summary>{copy.technicalDetails}</summary>
							{workflow.steps.map((step, index) => (
								<p key={index} className='detail'>
									<strong>{step.title}: </strong>
									{step.description}
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
						{current.error === undefined ? undefined : <ErrorNotice message={current.error} />}
					</div>
					{editingApproval && current.approval !== undefined && (current.phase === 'review' || pending) ? (
						<div className='transaction-step-actions transaction-approval-editor'>
							<TokenApprovalControl
								actionLabel={copy.fundReport}
								allowanceError={undefined}
								allowanceLoading={false}
								approvedAmount={current.approval.approvedAmount}
								guardMessage={undefined}
								onApprove={amount => workflow.confirm(amount)}
								pending={pending}
								pendingLabel={copy.waiting}
								requiredAmount={current.approval.requiredAmount}
								resetKey={`${contextKey}:${workflow.activeIndex}`}
								tokenSymbol={current.approval.tokenSymbol}
								tokenUnits={current.approval.tokenUnits}
								renderActions={({ button, notice, noticeId }) => (
									<TransactionActionGroup id={noticeId} message={notice}>
										<button className='secondary' type='button' onClick={() => setEditingApproval(false)} disabled={pending}>
											{copy.backToPlan}
										</button>
										{button}
									</TransactionActionGroup>
								)}
							/>
						</div>
					) : (
						<div className='actions transaction-step-actions'>
							<button className='secondary' type='button' onClick={workflow.cancel} disabled={pending}>
								{current.phase === 'review' ? copy.cancelRemaining : commonCopy.close}
							</button>
							{current.phase === 'review' || pending ? (
								<button type='button' onClick={() => (current.approval === undefined ? workflow.confirm() : setEditingApproval(true))} disabled={pending} aria-busy={pending}>
									{pending ? <LoadingText>{copy.waiting}</LoadingText> : current.title}
								</button>
							) : undefined}
						</div>
					)}
				</OperationModal>
			</TransactionActionButtonLockProvider>
		</GlobalTransactionPresentationProvider>
	)
}
