import * as copy from '../../copy/transactionSteps.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { useEffect } from 'preact/hooks'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { transactionSteps } from './transactionSteps.js'

export function TransactionStepsModal({ contextKey }: { contextKey: string }) {
	useEffect(() => () => transactionSteps.peek()?.cancel(), [contextKey])
	const presentation = useGlobalTransactionPresentation()
	useEffect(() => {
		if (presentation?.tone === 'success') transactionSteps.value?.finish()
	}, [presentation?.tone, presentation?.hash])
	const workflow = transactionSteps.value
	const current = workflow?.steps[workflow.activeIndex]
	if (workflow === undefined || current === undefined) return undefined
	const pending = current.phase === 'pending'
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const outcome = workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome
	const totalEth = workflow.steps.reduce((sum, step) => sum + (step.ethValueAttoEth ?? 0n), 0n)
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<OperationModal isOpen closeDisabled={pending} title={copy.title} description={workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped') ? copy.completed : copy.sequenceDetail} onClose={workflow.cancel}>
				<div className='transaction-step-content'>
					{funding.length === 0 ? undefined : (
						<>
							<TransactionReview
								variant='inline'
								primary={[]}
								details={[
									...funding.map(token => ({ label: copy.depositAndReturn, value: token.amount })),
									{ label: copy.totalEth, value: <CurrencyValue precision='exact' value={totalEth} suffix={commonCopy.eth} /> },
									...(outcome === undefined
										? []
										: [
												{ label: copy.settlementBounty, value: <CurrencyValue precision='exact' value={outcome.settlerRewardAttoEth} suffix={commonCopy.eth} /> },
												{ label: copy.ethRefund, value: <CurrencyValue precision='exact' value={outcome.ethRefundAttoEth} suffix={commonCopy.eth} /> },
											]),
								]}
							/>
							<p className='detail'>{copy.fundingDetail}</p>
							{outcome === undefined ? undefined : (
								<>
									<p className='detail'>{outcome.returnToWallet ? copy.coordinatorReturnDetail : copy.standaloneReturnDetail}</p>
									<p className='detail'>{copy.settlementCostDetail}</p>
								</>
							)}
						</>
					)}
					<ol aria-live='polite'>
						{workflow.steps.map((step, index) => (
							<li key={index} aria-current={index === workflow.activeIndex ? 'step' : undefined}>
								<strong>{step.title}</strong>
								{' — '}
								{{ skipped: copy.skipped, upcoming: step.optional ? copy.ifNeeded : copy.upcoming, review: copy.ready, pending: copy.pending, confirmed: copy.confirmed, failed: copy.notCompleted }[step.phase]}
								<p className='detail'>{step.description}</p>
								{step.amount === undefined ? undefined : <div>{step.amount}</div>}
								{(step.ethValueAttoEth ?? 0n) === 0n ? undefined : <CurrencyValue precision='exact' value={step.ethValueAttoEth} suffix={commonCopy.eth} />}
								{step.hash === undefined ? undefined : (
									<div>
										<TransactionHashLink hash={step.hash} />
									</div>
								)}
							</li>
						))}
					</ol>
					<TransactionReview
						variant='inline'
						primary={[]}
						details={[{ label: copy.recipient, value: <AddressValue address={current.contractAddress} responsiveAbbreviation /> }, ...(current.spender === undefined ? [] : [{ label: copy.spender, value: <AddressValue address={current.spender} responsiveAbbreviation /> }])]}
					/>
					{current.error === undefined ? undefined : <ErrorNotice message={current.error} />}
				</div>
				<div className='actions transaction-step-actions'>
					<button className='secondary' type='button' onClick={workflow.cancel} disabled={pending}>
						{current.phase === 'review' ? copy.cancelRemaining : commonCopy.close}
					</button>
					{current.phase === 'review' || pending ? (
						<button type='button' onClick={workflow.confirm} disabled={pending} aria-busy={pending}>
							{pending ? <LoadingText>{copy.waiting}</LoadingText> : current.title}
						</button>
					) : undefined}
				</div>
			</OperationModal>
		</GlobalTransactionPresentationProvider>
	)
}
