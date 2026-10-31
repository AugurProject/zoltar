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
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function PortfolioPurchasePanel({ model, purchase, actions }: { model: ReturnType<typeof usePortfolio>; purchase: ReturnType<typeof usePortfolioPurchase>; actions: PortfolioActions }) {
	const snapshot = model.snapshot
	const id = useId()
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
						<CurrencyValue value={snapshot?.economics.minimumPurchaseFeeAttoEth} suffix={common.eth} />
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
								{toHex(questionId)}
							</option>
						))}
					</select>
				</div>
				<PaginationControls hasPreviousPage={(snapshot?.questionStart ?? 0n) > 0n} hasNextPage={snapshot !== undefined && snapshot.questionStart + 64n < snapshot.questionCount} loading={model.loading} onPreviousPage={() => void model.previousQuestionPage()} onNextPage={() => void model.nextQuestionPage()} />
				<PortfolioInput label={copy.questionId} value={purchase.questionInput} onChange={purchase.setQuestionInput} disabled={actions.busy !== undefined} />
				{purchase.position === undefined ? undefined : <a href={buildPoolsRouteHash({ view: 'operate', securityPoolAddress: purchase.position.pool, tab: 'vaults' })}>{copy.openPrice}</a>}
				<MetricGrid>
					<PortfolioInput label={copy.mintAmount} value={purchase.mintAmount} onChange={purchase.setMintAmount} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.maximumPurchaseFee} hint={copy.maximumPurchaseFeeHint} value={purchase.maximumFee} onChange={purchase.setMaximumFee} disabled={actions.busy !== undefined} numeric />
					<PortfolioInput label={copy.minimumShares} value={purchase.minimumShares} onChange={purchase.setMinimumShares} disabled={actions.busy !== undefined} numeric />
				</MetricGrid>
				<MetricField label={copy.estimatedPurchaseFee} loading={purchase.quoteLoading}>
					<CurrencyValue value={purchase.quote?.purchaseFeeAttoEth} suffix={common.eth} />
				</MetricField>
				<PortfolioButton model={actions} action='mintPortfolioCompleteSets' label={copy.mint} pendingLabel={copy.minting} reason={purchase.reason} onClick={purchase.buy} />
			</SectionBlock>
		</>
	)
}
