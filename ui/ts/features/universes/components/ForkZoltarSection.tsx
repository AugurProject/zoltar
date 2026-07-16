import * as commonCopy from '../../../copy/common.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import type { Address } from '@zoltar/shared/ethereum'
import { useState } from 'preact/hooks'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { DataGrid } from '../../../components/DataGrid.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { MetricField } from '../../../components/MetricField.js'
import { Question } from '../../markets/components/Question.js'
import { StateHint } from '../../../components/StateHint.js'
import { TokenApprovalControl } from '../../../components/TokenApprovalControl.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionReview } from '../../../components/TransactionReview.js'
import { TransactionNetworkValue } from '../../../components/TransactionNetworkValue.js'
import { WorkflowSubsection } from '../../../components/WorkflowSubsection.js'
import { sameCaseInsensitiveText } from '../../../lib/caseInsensitive.js'
import { resolveLoadableValueState, type LoadableValueState } from '../../../lib/loadState.js'
import { deriveTokenApprovalRequirement, type TokenApprovalState } from '../../../lib/tokenApproval.js'
import { getReportPresentation, getUniversePresentation, getWalletPresentation } from '../../../lib/userCopy.js'
import type { MarketDetails, ZoltarUniverseSummary } from '../../../types/contracts.js'

const FORK_CONFIRMATION = 'FORK'

type ForkZoltarSectionProps = {
	accountAddress: Address | undefined
	hasLoadedZoltarQuestions: boolean
	isMainnet: boolean
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
}
export function ForkZoltarSection({
	accountAddress,
	hasLoadedZoltarQuestions,
	isMainnet,
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
}: ForkZoltarSectionProps) {
	const [forkConfirmation, setForkConfirmation] = useState({ questionId: '', value: '' })
	const rootUniverse = zoltarUniverse
	const universeMissing = zoltarUniverseState === 'missing'
	const hasForked = rootUniverse?.hasForked === true
	const hasEnoughRep = rootUniverse !== undefined && zoltarForkRepBalance !== undefined && zoltarForkRepBalance >= rootUniverse.forkThreshold
	const approvalRequirement = deriveTokenApprovalRequirement(rootUniverse?.forkThreshold, zoltarForkApproval.value)
	const hasEnoughApproval = rootUniverse !== undefined && approvalRequirement.hasSufficientApproval
	const hasForkEconomics = rootUniverse?.forkBurnDivisor !== undefined && rootUniverse.forkBurnDivisor > 1n && rootUniverse.zoltarAddress !== undefined
	const selectedQuestionId = zoltarForkQuestionId.trim()
	const hasSelectedQuestionId = selectedQuestionId !== ''
	const confirmationValue = forkConfirmation.questionId === selectedQuestionId ? forkConfirmation.value : ''
	const hasConfirmedFork = confirmationValue.trim() === FORK_CONFIRMATION
	const selectedQuestion = selectedQuestionId === '' ? undefined : zoltarQuestions.find(question => sameCaseInsensitiveText(question.questionId, selectedQuestionId))
	const selectedQuestionLookupState = resolveLoadableValueState({
		isLoading: loadingZoltarQuestions,
		isMissing: hasSelectedQuestionId && hasLoadedZoltarQuestions && selectedQuestion === undefined,
		value: selectedQuestion,
	})
	const selectedQuestionPresentation = hasSelectedQuestionId && selectedQuestionLookupState !== 'ready' ? getReportPresentation({ kind: 'question', state: selectedQuestionLookupState }) : undefined
	const canFork = accountAddress !== undefined && isMainnet && rootUniverse !== undefined && !hasForked && !zoltarForkPending && selectedQuestion !== undefined && hasEnoughRep && hasEnoughApproval && hasForkEconomics && hasConfirmedFork
	const resultingRepBalance = rootUniverse === undefined || zoltarForkRepBalance === undefined || zoltarForkRepBalance < rootUniverse.forkThreshold ? undefined : zoltarForkRepBalance - rootUniverse.forkThreshold
	const permanentRepBurn = rootUniverse?.forkBurnDivisor === undefined || rootUniverse.forkBurnDivisor <= 1n ? undefined : rootUniverse.forkThreshold / rootUniverse.forkBurnDivisor
	const migrationCustodyCredit = rootUniverse === undefined || permanentRepBurn === undefined ? undefined : rootUniverse.forkThreshold - permanentRepBurn
	const approvalGuardMessage = (() => {
		const walletPresentation = getWalletPresentation({ accountAddress, isMainnet })
		if (walletPresentation !== undefined) return walletPresentation.detail
		if (rootUniverse === undefined) return undefined
		if (hasForked) return zoltarCopy.alreadyForkedReason
		if (selectedQuestion === undefined) return zoltarCopy.forkQuestionRequiredReason
		return undefined
	})()
	const forkGuardMessage =
		accountAddress === undefined
			? zoltarCopy.forkWalletRequiredReason
			: (() => {
					if (!isMainnet) return commonCopy.mainnetRequiredReason
					if (rootUniverse === undefined) return zoltarCopy.forkDataRequiredReason

					return (() => {
						if (hasForked) return zoltarCopy.alreadyForkedReason
						if (selectedQuestion === undefined) return zoltarCopy.forkQuestionRequiredReason
						if (!hasForkEconomics) return zoltarCopy.forkEconomicsRequiredReason

						return (() => {
							if (!hasEnoughRep) return zoltarCopy.forkRepInsufficientReason
							if (!hasEnoughApproval) return zoltarCopy.forkRepApprovalRequiredReason
							if (!hasConfirmedFork) return zoltarCopy.forkConfirmationRequiredReason

							return undefined
						})()
					})()
				})()

	if (universeMissing) {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return (
			<>
				{presentation === undefined ? undefined : <StateHint presentation={presentation} title={zoltarCopy.forkZoltar} />}
				<ErrorNotice message={zoltarForkError} />
			</>
		)
	}
	return (
		<>
			<DataGrid>
				<MetricField label={commonCopy.forkThreshold}>
					<CurrencyValue loading={loadingZoltarForkAccess || rootUniverse === undefined} value={rootUniverse?.forkThreshold} suffix={commonCopy.rep} />
				</MetricField>
			</DataGrid>

			<div className='form-grid'>
				{hasForked ? undefined : (
					<TokenApprovalControl
						actionLabel={zoltarCopy.forkingActionLabel}
						allowanceError={zoltarForkApproval.error}
						allowanceLoading={zoltarForkApproval.loading}
						approvedAmount={zoltarForkApproval.value}
						disabled={!isMainnet}
						guardMessage={approvalGuardMessage}
						onApprove={amount => onApproveZoltarForkRep(amount)}
						pending={zoltarForkActiveAction === 'approve'}
						pendingLabel={zoltarCopy.forkRepApprovalPending}
						requiredAmount={rootUniverse?.forkThreshold}
						resetKey={`${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${rootUniverse?.forkThreshold.toString() ?? ''}`}
						tokenSymbol='REP'
						tokenUnits={18}
					/>
				)}

				<label className='field'>
					<span>{zoltarCopy.forkQuestionId}</span>
					<FormInput value={zoltarForkQuestionId} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder={commonCopy.hexValuePlaceholder} disabled={hasForked || zoltarForkPending} />
				</label>

				{selectedQuestion === undefined ? undefined : (
					<WorkflowSubsection title={commonCopy.question}>
						<Question question={selectedQuestion} />
					</WorkflowSubsection>
				)}
				{selectedQuestionPresentation === undefined ? undefined : <StateHint presentation={selectedQuestionPresentation} />}

				<TransactionReview
					primary={[
						{ label: transactionReviewCopy.youPay, value: <CurrencyValue value={rootUniverse?.forkThreshold} suffix={commonCopy.rep} /> },
						{ label: zoltarCopy.migrationCustodyCredit, value: <CurrencyValue value={migrationCustodyCredit} suffix={commonCopy.rep} /> },
					]}
					details={[
						{ label: zoltarCopy.permanentRepBurn, value: <CurrencyValue value={permanentRepBurn} suffix={commonCopy.rep} /> },
						{ label: transactionReviewCopy.resultingRepBalance, value: <CurrencyValue value={resultingRepBalance} suffix={commonCopy.rep} /> },
						{ label: zoltarCopy.zoltarContract, value: rootUniverse?.zoltarAddress === undefined ? commonCopy.unavailable : <AddressValue address={rootUniverse.zoltarAddress} /> },
						{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
					]}
					risks={[zoltarCopy.forkIrreversibleRisk, zoltarCopy.forkMigrationRisk]}
				/>

				<label className='field'>
					<span>{zoltarCopy.forkConfirmationLabel}</span>
					<FormInput aria-label={zoltarCopy.forkConfirmationLabel} autoComplete='off' disabled={hasForked || zoltarForkPending || selectedQuestion === undefined} onInput={event => setForkConfirmation({ questionId: selectedQuestionId, value: event.currentTarget.value })} value={confirmationValue} />
					<p className='field-help'>{zoltarCopy.forkConfirmationHelp}</p>
				</label>

				<div className='actions'>
					<TransactionActionButton
						idleLabel={zoltarCopy.forkZoltar}
						pendingLabel={zoltarCopy.forkSubmissionPending}
						onClick={() => {
							if (selectedQuestionId === '') return
							onForkZoltar()
						}}
						pending={zoltarForkActiveAction === 'fork'}
						availability={{ disabled: !canFork, reason: forkGuardMessage }}
					/>
				</div>
			</div>

			<ErrorNotice message={zoltarForkError} />
		</>
	)
}
