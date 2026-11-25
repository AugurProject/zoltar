import { useState } from 'preact/hooks'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'
import { useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import * as collateralCopy from '../../../copy/collateral.js'
import * as recoveryCopy from '../../../copy/forkRecovery.js'
import * as copy from '../../../copy/securityPoolSharedFork.js'
import { tryAgain } from '../../../copy/securityPoolPage.js'
import { designQuestionId } from '../../../lib/routing.js'
import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { statoblastDisplayCache } from '../../../protocol/statoblastPageCache.js'
import { decodeWatchlistRows, parseWatchlistEntity } from '../../../protocol/watchlistRows.js'
import { useStatoblastRefreshError } from '../../useStatoblastPageRefresh.js'
import type { useSecurityPoolSharedFork } from '../hooks/useSecurityPoolSharedFork.js'
import { SecurityPoolButton, SecurityPoolInput, type SecurityPoolActions } from './SecurityPoolControls.js'

type Model = ReturnType<typeof useSecurityPoolSharedFork>
type RecoveryActions = Pick<SecurityPoolActions, 'scope' | 'busy'>

const questionIdOption = 'question-id'

function RecoveryQuestionPicker({ model, snapshot, disabled }: { model: Model; snapshot: SecurityPoolAccountSnapshot | undefined; disabled: boolean }) {
	const [manual, setManual] = useState(false)
	const [draft, setDraft] = useState('')
	const saved = useFavorites('statoblast', 'question')
	const questions = saved.entries.flatMap(item => {
		const entry = parseWatchlistEntity(item.id, 'question')
		return entry?.kind === 'question' && sameAddress(entry.pool, snapshot?.securityPool) ? [{ ...entry, label: item.label }] : []
	})
	const universeId = model.displayedState?.universeId ?? snapshot?.universeId
	const rows = universeId === undefined ? undefined : statoblastDisplayCache(getActiveNetworkProfile(), { universeId, owner: snapshot?.owner, page: 'watchlist' }, decodeWatchlistRows).read()?.value
	const selectedId = designQuestionId(model.questionInput)
	const selectedFromDevice = questions.some(question => question.questionId === selectedId)
	const showIdInput = manual || questions.length === 0 || (selectedId !== undefined && !selectedFromDevice)
	const idInput = draft || model.questionInput
	const id = designQuestionId(idInput.trim())
	return (
		<div className='statoblast-recovery-picker'>
			<label className='field'>
				<span>{recoveryCopy.recoveryQuestion}</span>
				<select
					value={showIdInput ? questionIdOption : model.questionInput}
					disabled={disabled}
					onChange={event => {
						const value = event.currentTarget.value
						if (value === questionIdOption) {
							setManual(true)
							model.setQuestion('')
							return
						}
						setManual(false)
						model.setQuestion(value)
					}}
				>
					<option value=''>{recoveryCopy.chooseRecoveryQuestion}</option>
					{questions.map(question => (
						<option key={question.id} value={formatQuestionIdHex(question.questionId)}>
							{question.label ?? rows?.find(row => row.entity.id === question.id)?.question?.marketDetails.title ?? formatQuestionIdHex(question.questionId)}
						</option>
					))}
					<option value={questionIdOption}>{recoveryCopy.useRecoveryQuestionId}</option>
				</select>
			</label>
			{showIdInput && (
				<form
					onSubmit={event => {
						event.preventDefault()
						if (id === undefined || disabled) return
						setDraft(formatQuestionIdHex(id))
						model.setQuestion(formatQuestionIdHex(id))
					}}
				>
					<SecurityPoolInput
						label={copy.question}
						value={idInput}
						onChange={value => {
							setDraft(value)
							if (designQuestionId(value.trim()) !== selectedId) model.setQuestion('')
						}}
						disabled={disabled}
						hint={recoveryCopy.recoveryQuestionIdHint}
						action={
							<button type='submit' disabled={id === undefined || disabled}>
								{common.openPool}
							</button>
						}
					/>
				</form>
			)}
		</div>
	)
}

function TransferRights({ model, actions }: { model: Model; actions: RecoveryActions }) {
	const disabled = actions.busy !== undefined
	return (
		<>
			<UserMessage detail={copy.transferHint} />
			<SecurityPoolInput label={copy.recipient} value={model.recipientInput} onChange={model.setRecipient} disabled={disabled} />
			<MetricGrid>
				<SecurityPoolInput label={copy.yesTransfer} value={model.yesRightsInput} onChange={model.setYesRights} disabled={disabled} numeric />
				<SecurityPoolInput label={copy.noTransfer} value={model.noRightsInput} onChange={model.setNoRights} disabled={disabled} numeric />
				<SecurityPoolInput label={copy.invalidTransfer} value={model.invalidRightsInput} onChange={model.setInvalidRights} disabled={disabled} numeric />
			</MetricGrid>
			<SecurityPoolButton model={actions} action='transferSecurityPoolRecoveryRights' label={copy.transfer} pendingLabel={copy.transferring} reason={model.transferReason} onClick={model.transfer} />
		</>
	)
}

function RecoveryButtons({ model, actions }: { model: Model; actions: RecoveryActions }) {
	return (
		<>
			<li>
				<SecurityPoolButton model={actions} action='prepareSecurityPoolRecovery' label={copy.prepare} pendingLabel={copy.preparing} reason={model.prepareReason} onClick={model.prepare} />
			</li>
			<li>
				<SecurityPoolButton model={actions} action='recoverSecurityPoolSource' label={copy.recover} pendingLabel={copy.recovering} reason={model.recoverReason} onClick={model.recover} />
			</li>
		</>
	)
}

export function SecurityPoolShareRecovery({ model, actions, snapshot, redesigned }: { model: Model; actions: RecoveryActions; snapshot: SecurityPoolAccountSnapshot | undefined; redesigned: boolean }) {
	const state = model.displayedState
	const branch = state?.branch
	const units = snapshot?.collateral.decimals ?? 18
	const disabled = actions.busy !== undefined
	const recoveryError = useStatoblastRefreshError(model.recoveryError, model.recoveryReadAt)
	const failure = <RetryableNotice message={recoveryError} onRetry={model.retryRecovery} retryLabel={tryAgain} disabled={disabled} />
	if (!redesigned) {
		return (
			<SectionBlock title={recoveryCopy.shareRecovery}>
				<WorkflowSubsection title={copy.basketTitle}>
					<UserMessage detail={copy.basketHint} />
					<MetricGrid>
						<MetricField label={copy.cashRecovery} loading={model.loading}>
							<CurrencyValue value={branch?.parentCash} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={units} />
						</MetricField>
						<MetricField label={copy.repRecovery} loading={model.loading}>
							<CurrencyValue value={branch?.started ? branch.recoveryAttoRep : undefined} suffix={common.rep} />
						</MetricField>
					</MetricGrid>
				</WorkflowSubsection>
				<WorkflowSubsection title={copy.recovery}>
					<UserMessage detail={copy.recoveryHint} />
					<MetricGrid>
						<SecurityPoolInput label={copy.question} value={model.questionInput} onChange={model.setQuestion} disabled={disabled} />
						<SecurityPoolInput label={copy.shares} value={model.sharesInput} onChange={model.setShares} disabled={disabled} numeric />
						<MetricField label={copy.available}>
							<CurrencyValue value={model.recovery?.availableShares} units={units} />
						</MetricField>
					</MetricGrid>
					{failure}
					<ol className='statoblast-fork-steps statoblast-share-recovery-workflow'>
						<RecoveryButtons model={model} actions={actions} />
					</ol>
					<MetricGrid>
						<MetricField label={copy.invalidAvailable}>
							<CurrencyValue value={model.recovery?.rights[0]} units={units} />
						</MetricField>
						<MetricField label={copy.yesAvailable}>
							<CurrencyValue value={model.recovery?.rights[1]} units={units} />
						</MetricField>
						<MetricField label={copy.noAvailable}>
							<CurrencyValue value={model.recovery?.rights[2]} units={units} />
						</MetricField>
					</MetricGrid>
					<TransferRights model={model} actions={actions} />
				</WorkflowSubsection>
			</SectionBlock>
		)
	}
	const maximum = model.recovery?.availableShares
	const opensAt = state !== undefined && state.choiceDeadline > 0n && state.timestamp < state.choiceDeadline ? state.choiceDeadline : undefined
	let badge
	if (opensAt !== undefined)
		badge = (
			<Badge tone='muted'>
				{recoveryCopy.recoveryOpens} <TimestampValue timestamp={opensAt} relative={false} />
			</Badge>
		)
	else if (state !== undefined && state.forkTime > 0n) badge = <Badge tone='ok'>{recoveryCopy.recoveryOpen}</Badge>
	const hasRights = model.recovery !== undefined
	return (
		<SectionBlock title={recoveryCopy.shareRecovery} badge={badge}>
			<UserMessage tone='warning' detail={recoveryCopy.repaymentWarning} />
			<details>
				<summary>{recoveryCopy.recoveryDisclosure}</summary>
				<p>{recoveryCopy.recoveryExplanation}</p>
			</details>
			<MetricField label={recoveryCopy.yourRecoveryRights} loading={model.recoveryLoading && !hasRights}>
				{hasRights && (
					<span className='statoblast-recovery-rights'>
						<CurrencyValue value={model.recovery?.rights[1]} units={units} suffix={common.yes} />
						<CurrencyValue value={model.recovery?.rights[2]} units={units} suffix={common.no} />
						<CurrencyValue value={model.recovery?.rights[0]} units={units} suffix={recoveryCopy.invalid} />
					</span>
				)}
			</MetricField>
			<MetricGrid>
				<RecoveryQuestionPicker key={`${snapshot?.securityPool}:${snapshot?.owner}:${model.sourceInput}`} model={model} snapshot={snapshot} disabled={disabled} />
				<SecurityPoolInput
					label={copy.shares}
					value={model.sharesInput}
					onChange={model.setShares}
					disabled={disabled}
					hint={maximum === undefined ? undefined : recoveryCopy.recoverySetsAvailable(formatUnits(maximum, units))}
					numeric
					action={
						<button type='button' className='secondary' disabled={maximum === undefined || maximum === 0n || model.recoveryLoading || model.recoveryError !== undefined || disabled} onClick={() => maximum !== undefined && model.setShares(formatUnits(maximum, units))}>
							{common.max}
						</button>
					}
				/>
			</MetricGrid>
			{failure}
			<ol className='statoblast-fork-steps statoblast-share-recovery-workflow'>
				<RecoveryButtons model={model} actions={actions} />
			</ol>
			<details className='statoblast-recovery-transfer'>
				<summary>{recoveryCopy.transferRightsDisclosure}</summary>
				<TransferRights model={model} actions={actions} />
			</details>
		</SectionBlock>
	)
}
