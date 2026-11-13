import * as collateralCopy from '../../../copy/collateral.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { tokenRequiresAllowanceReset } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { usePortfolioQuestionDetails } from '../hooks/usePortfolioQuestionDetails.js'
import { useId } from 'preact/hooks'
import { toHex, formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { PortfolioButton, PortfolioInput, type PortfolioActions } from './PortfolioControls.js'
import { buildPoolsRouteHash } from '../../../lib/statoblastLocation.js'
import type { usePortfolio } from '../hooks/usePortfolio.js'
import type { usePortfolioPurchase } from '../hooks/usePortfolioPurchase.js'
import * as copy from '../../../copy/portfolio.js'
import * as capitalCopy from '../../../copy/portfolioCapital.js'

export function PortfolioPurchasePanel({ model, purchase, actions }: { model: ReturnType<typeof usePortfolio>; purchase: ReturnType<typeof usePortfolioPurchase>; actions: PortfolioActions }) {
	const snapshot = model.snapshot
	const id = useId()
	const details = usePortfolioQuestionDetails(snapshot, purchase.questionInput)
	const admission = snapshot?.admission
	const admissionLabels = { open: copy.admissionOpen, fixed: copy.admissionFixed, custom: copy.admissionCustom }
	const selected = snapshot?.questions.find(value => String(value) === purchase.questionInput || toHex(value) === purchase.questionInput)
	return (
		<>
			<SectionBlock title={copy.addQuestion} description={copy.questionHint}>
				<MetricGrid>
					<MetricField label={copy.admissionMode}>{admission === undefined ? undefined : admissionLabels[admission.mode]}</MetricField>
					<MetricField label={capitalCopy.annualFee}>{snapshot === undefined ? undefined : `${formatUnits(snapshot.economics.annualFeeBps, 2)}%`}</MetricField>
					<MetricField label={copy.purchaseFeePercent}>{snapshot === undefined ? undefined : `${formatUnits(snapshot.economics.purchaseFeeBps, 2)}%`}</MetricField>
					<MetricField label={copy.minimumPurchaseFee}>
						<CurrencyValue value={snapshot?.economics.minimumPurchaseFeeAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
					</MetricField>
				</MetricGrid>
				{admission?.mode === 'custom' ? <UserMessage tone='warning' detail={copy.unsupportedAdmission} /> : undefined}
				{admission?.mode === 'fixed' ? (
					<details>
						<summary>{copy.fixedQuestionIds}</summary>
						<UserMessage detail={copy.approvedQuestionCount(admission.questionCount)} />
						<ul>
							{admission.questions.map(questionId => (
								<li key={String(questionId)}>
									<code>{toHex(questionId)}</code>
								</li>
							))}
						</ul>
						<PaginationControls hasPreviousPage={admission.questionStart > 0n} hasNextPage={admission.questionStart + 64n < admission.questionCount} loading={model.loading} onPreviousPage={() => void model.previousApprovedQuestionPage()} onNextPage={() => void model.nextApprovedQuestionPage()} />
					</details>
				) : undefined}
				<PortfolioInput label={copy.questionId} value={actions.questionInput} onChange={actions.setQuestionInput} disabled={actions.busy !== undefined} />
				<PortfolioButton model={actions} action='registerPortfolioQuestion' label={copy.addQuestion} pendingLabel={copy.addingQuestion} reason={actions.registerReason} onClick={actions.register} />
			</SectionBlock>
			<SectionBlock title={copy.mint} description={copy.mintHint}>
				<div className='field'>
					<label htmlFor={id}>{copy.registeredQuestions}</label>
					<select id={id} value={selected === undefined ? '' : toHex(selected)} disabled={actions.busy !== undefined || model.loading} onChange={event => purchase.setQuestionInput(event.currentTarget.value)}>
						<option value=''>{copy.chooseRegisteredQuestion}</option>
						{snapshot?.questions.map(questionId => (
							<option key={String(questionId)} value={toHex(questionId)}>
								{details.entries?.get(questionId)?.question === undefined ? toHex(questionId) : getQuestionTitle(details.entries.get(questionId)?.question ?? { title: '' })}
							</option>
						))}
					</select>
				</div>
				<PaginationControls hasPreviousPage={(snapshot?.questionStart ?? 0n) > 0n} hasNextPage={snapshot !== undefined && snapshot.questionStart + 64n < snapshot.questionCount} loading={model.loading} onPreviousPage={() => void model.previousQuestionPage()} onNextPage={() => void model.nextQuestionPage()} />
				<details>
					<summary>{copy.findQuestionById}</summary>
					<PortfolioInput label={copy.questionId} value={purchase.questionInput} onChange={purchase.setQuestionInput} disabled={actions.busy !== undefined} />
				</details>
				{details.selected?.error === undefined ? undefined : <UserMessage tone='error' detail={details.selected.error} />}
				{details.selectedId !== undefined && details.selected?.error === undefined && <Question question={details.selected?.question} loading={details.selected?.question === undefined} abbreviateIdentifier={false} />}
				{[...(details.entries?.values() ?? [])].some(entry => entry.error !== undefined) ? (
					<button type='button' onClick={details.retry}>
						{copy.retryQuestionDetails}
					</button>
				) : undefined}
				{purchase.position === undefined ? undefined : <a href={buildPoolsRouteHash({ view: 'operate', securityPoolAddress: purchase.position.pool, tab: 'vaults' })}>{copy.openPrice}</a>}
				<MetricGrid>
					<PortfolioInput label={collateralCopy.amount(copy.mintAmount, snapshot?.collateral.symbol ?? collateralCopy.token)} value={purchase.mintAmount} onChange={purchase.setMintAmount} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={collateralCopy.amount(copy.maximumPurchaseFee, snapshot?.collateral.symbol ?? collateralCopy.token)} hint={copy.maximumPurchaseFeeHint} value={purchase.maximumFee} onChange={purchase.setMaximumFee} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.minimumShares} value={purchase.minimumShares} onChange={purchase.setMinimumShares} disabled={actions.busy !== undefined} numeric />
				</MetricGrid>
				<MetricField label={copy.estimatedPurchaseFee} loading={purchase.quoteLoading}>
					<CurrencyValue value={purchase.quote?.purchaseFeeAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
				</MetricField>
				{snapshot !== undefined && tokenRequiresAllowanceReset(snapshot.collateralToken) ? (
					<PortfolioButton model={actions} action='resetPurchaseCollateral' label={collateralCopy.reset} pendingLabel={collateralCopy.resetting} reason={actions.ownerReason ?? (snapshot.collateralAllowance === 0n ? collateralCopy.notNeeded : undefined)} onClick={() => purchase.approve(0n)} />
				) : undefined}
				<TokenApprovalControl
					actionLabel={copy.mint}
					allowanceError={model.error}
					allowanceLoading={model.loading}
					approvedAmount={snapshot?.collateralAllowance}
					disabled={actions.busy !== undefined}
					guardMessage={actions.ownerReason}
					requiresAllowanceReset={tokenRequiresAllowanceReset(snapshot?.collateralToken)}
					onApprove={amount => {
						if (amount !== undefined) void purchase.approve(amount)
					}}
					pending={actions.busy === 'approvePurchaseCollateral'}
					pendingLabel={collateralCopy.approving}
					requiredAmount={purchase.requiredCollateral}
					resetKey={`${snapshot?.portfolio}:${snapshot?.owner}:${purchase.requiredCollateral}`}
					tokenSymbol={snapshot?.collateral.symbol ?? collateralCopy.fallback}
					tokenUnits={snapshot?.collateral.decimals ?? 18}
				/>
				<PortfolioButton model={actions} action='mintPortfolioCompleteSets' label={copy.mint} pendingLabel={copy.minting} reason={purchase.reason ?? (details.selected?.question === undefined ? copy.reviewQuestionDetails : undefined)} onClick={purchase.buy} />
			</SectionBlock>
		</>
	)
}
