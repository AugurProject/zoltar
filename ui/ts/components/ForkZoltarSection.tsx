import type { Address } from 'viem'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { resolveLoadableValueState, type LoadableValueState } from '../lib/loadState.js'
import { deriveTokenApprovalRequirement, type TokenApprovalState } from '../lib/tokenApproval.js'
import { getReportPresentation, getUniversePresentation, getWalletPresentation } from '../lib/userCopy.js'
import type { MarketDetails, ZoltarUniverseSummary } from '../types/contracts.js'

type ForkZoltarSectionProps = {
	activeNetworkLabel: string
	accountAddress: Address | undefined
	hasLoadedZoltarQuestions: boolean
	loadingZoltarForkAccess: boolean
	loadingZoltarQuestions: boolean
	onApproveZoltarForkRep: (amount?: bigint) => void
	onForkZoltar: () => void
	onZoltarForkQuestionIdChange: (questionId: string) => void
	zoltarForkActiveAction: 'approve' | 'fork' | undefined
	zoltarForkApproval: TokenApprovalState
	zoltarForkError: string | undefined
	zoltarForkPending: boolean
	zoltarForkQuestionId: string
	zoltarForkRepBalance: bigint | undefined
	zoltarQuestions: MarketDetails[]
	zoltarUniverse: ZoltarUniverseSummary | undefined
	zoltarUniverseState: LoadableValueState
	walletMatchesActiveNetwork: boolean
}

export function ForkZoltarSection({
	activeNetworkLabel,
	accountAddress,
	hasLoadedZoltarQuestions,
	loadingZoltarForkAccess,
	loadingZoltarQuestions,
	onApproveZoltarForkRep,
	onForkZoltar,
	onZoltarForkQuestionIdChange,
	zoltarForkActiveAction,
	zoltarForkApproval,
	zoltarForkError,
	zoltarForkPending,
	zoltarForkQuestionId,
	zoltarForkRepBalance,
	zoltarQuestions,
	zoltarUniverse,
	zoltarUniverseState,
	walletMatchesActiveNetwork,
}: ForkZoltarSectionProps) {
	const rootUniverse = zoltarUniverse
	const universeMissing = zoltarUniverseState === 'missing'
	const hasForked = rootUniverse?.hasForked === true
	const hasEnoughRep = rootUniverse !== undefined && zoltarForkRepBalance !== undefined && zoltarForkRepBalance >= rootUniverse.forkThreshold
	const approvalRequirement = deriveTokenApprovalRequirement(rootUniverse?.forkThreshold, zoltarForkApproval.value)
	const hasEnoughApproval = rootUniverse !== undefined && approvalRequirement.hasSufficientApproval
	const selectedQuestionId = zoltarForkQuestionId.trim()
	const hasSelectedQuestionId = selectedQuestionId !== ''
	const selectedQuestion = selectedQuestionId === '' ? undefined : zoltarQuestions.find(question => sameCaseInsensitiveText(question.questionId, selectedQuestionId))
	const selectedQuestionLookupState = resolveLoadableValueState({
		isLoading: loadingZoltarQuestions,
		isMissing: hasSelectedQuestionId && hasLoadedZoltarQuestions && selectedQuestion === undefined,
		value: selectedQuestion,
	})
	const selectedQuestionPresentation = hasSelectedQuestionId && selectedQuestionLookupState !== 'ready' ? getReportPresentation({ kind: 'question', state: selectedQuestionLookupState }) : undefined
	const canFork = accountAddress !== undefined && walletMatchesActiveNetwork && rootUniverse !== undefined && !hasForked && !zoltarForkPending && selectedQuestion !== undefined && hasEnoughRep && hasEnoughApproval
	const approvalGuardMessage = (() => {
		const walletPresentation = getWalletPresentation({ accountAddress, activeNetworkLabel, walletMatchesActiveNetwork })
		if (walletPresentation !== undefined) return walletPresentation.detail
		if (rootUniverse === undefined) return undefined
		if (hasForked) return 'Zoltar is already forked.'
		return undefined
	})()

	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				<EntityCard title='Fork Zoltar'>{presentation === undefined ? undefined : <StateHint presentation={presentation} />}</EntityCard>
				<ErrorNotice message={zoltarForkError} />
			</>
		)
	}

	return (
		<>
			<EntityCard title='Fork Zoltar' badge={hasForked ? <span className='badge blocked'>Forked</span> : undefined}>
				<div className='workflow-metric-grid'>
					<MetricField label='Fork Threshold'>
						<CurrencyValue loading={loadingZoltarForkAccess || rootUniverse === undefined} value={rootUniverse?.forkThreshold} suffix='REP' />
					</MetricField>
				</div>

				<div className='form-grid'>
					{hasForked ? undefined : (
						<TokenApprovalControl
							actionLabel='forking Zoltar'
							allowanceError={zoltarForkApproval.error}
							allowanceLoading={zoltarForkApproval.loading}
							approvedAmount={zoltarForkApproval.value}
							guardMessage={approvalGuardMessage}
							onApprove={amount => onApproveZoltarForkRep(amount)}
							pending={zoltarForkActiveAction === 'approve'}
							pendingLabel='Approving REP Threshold...'
							requiredAmount={rootUniverse?.forkThreshold}
							resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${rootUniverse?.forkThreshold.toString() ?? ''}`}
							tokenSymbol='REP'
							tokenUnits={18}
						/>
					)}

					<label className='field'>
						<span>Fork Question ID</span>
						<input value={zoltarForkQuestionId} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder='0x...' disabled={hasForked || zoltarForkPending} />
					</label>

					{selectedQuestion === undefined ? undefined : (
						<div className='entity-card-subsection'>
							<div className='entity-card-subsection-header'>
								<h4>Question</h4>
							</div>
							<Question question={selectedQuestion} />
						</div>
					)}
					{selectedQuestionPresentation === undefined ? undefined : <StateHint presentation={selectedQuestionPresentation} />}

					<div className='actions'>
						<button
							className='primary'
							onClick={() => {
								if (selectedQuestionId === '') return
								onForkZoltar()
							}}
							disabled={!canFork}
						>
							{zoltarForkActiveAction === 'fork' ? <LoadingText>Forking Zoltar...</LoadingText> : 'Fork Zoltar'}
						</button>
					</div>
				</div>
			</EntityCard>

			<ErrorNotice message={zoltarForkError} />
		</>
	)
}
