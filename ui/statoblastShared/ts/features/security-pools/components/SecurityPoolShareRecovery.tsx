import { useState } from 'preact/hooks'
import { formatUnits, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'
import { useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { abbreviateAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import * as recoveryCopy from '../../../copy/forkRecovery.js'
import * as copy from '../../../copy/securityPoolSharedFork.js'
import { tryAgain } from '../../../copy/securityPoolPage.js'
import { designQuestionId } from '../../../lib/routing.js'
import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { statoblastDisplayCache } from '../../../protocol/statoblastPageCache.js'
import { decodeWatchlistRows, parseWatchlistEntity } from '../../../protocol/watchlistRows.js'
import { useOldActionDataNotice, useStatoblastRefreshError } from '../../useStatoblastPageRefresh.js'
import type { useSecurityPoolSharedFork } from '../hooks/useSecurityPoolSharedFork.js'
import { SecurityPoolButton, SecurityPoolInput, type SecurityPoolActions } from './SecurityPoolControls.js'

type Model = ReturnType<typeof useSecurityPoolSharedFork>
type RecoveryActions = Pick<SecurityPoolActions, 'scope' | 'busy'>
type ForkQuestionTitle = Pick<MarketDetails, 'questionId' | 'title'>

const questionIdOption = 'question-id'

function RecoveryQuestionPicker({ model, snapshot, disabled, forkQuestion }: { model: Model; snapshot: SecurityPoolAccountSnapshot | undefined; disabled: boolean; forkQuestion: ForkQuestionTitle | undefined }) {
	const [manual, setManual] = useState(false)
	const [draft, setDraft] = useState('')
	const saved = useFavorites('statoblast', 'question')
	const questions = saved.entries.flatMap(item => {
		const entry = parseWatchlistEntity(item.id, 'question')
		return entry?.kind === 'question' && sameAddress(entry.pool, snapshot?.securityPool) ? [{ ...entry, label: item.label }] : []
	})
	const universeId = model.displayedState?.universeId ?? snapshot?.universeId
	const owner = snapshot?.owner === zeroAddress ? undefined : snapshot?.owner
	const rows = universeId === undefined ? undefined : statoblastDisplayCache(getActiveNetworkProfile(), { universeId, owner, page: 'watchlist' }, decodeWatchlistRows).read()?.value
	const forkQuestionId = forkQuestion === undefined ? undefined : designQuestionId(forkQuestion.questionId)
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
					{questions.map(question => {
						const questionId = formatQuestionIdHex(question.questionId)
						const cachedTitle = rows?.find(row => row.entity.id === question.id)?.question?.marketDetails.title
						const knownForkTitle = question.questionId === forkQuestionId ? forkQuestion?.title : undefined
						return (
							<option key={question.id} value={questionId}>
								{question.label || cachedTitle || knownForkTitle || abbreviateAddress(questionId, 12, 10)}
							</option>
						)
					})}
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

export function SecurityPoolShareRecovery({ model, actions, snapshot, forkQuestion }: { model: Model; actions: RecoveryActions; snapshot: SecurityPoolAccountSnapshot | undefined; forkQuestion?: ForkQuestionTitle | undefined }) {
	const state = model.displayedState
	const units = snapshot?.collateral.decimals ?? 18
	const disabled = actions.busy !== undefined
	const recoveryError = useStatoblastRefreshError(model.recoveryError, model.recoveryReadAt)
	const actionDataNotice = useOldActionDataNotice(model.recoveryReadAt)
	const failure = <RetryableNotice message={recoveryError} onRetry={model.retryRecovery} retryLabel={tryAgain} disabled={disabled} />
	const maximum = model.recovery?.availableShares
	const deadline = state?.choiceDeadline ?? snapshot?.forkChoiceDeadline
	const timestamp = state?.timestamp ?? snapshot?.timestamp
	const forkTime = state?.forkTime ?? snapshot?.forkTime ?? 0n
	const opensAt = deadline !== undefined && timestamp !== undefined && deadline > 0n && timestamp < deadline ? deadline : undefined
	let badge
	if (opensAt !== undefined)
		badge = (
			<Badge tone='muted'>
				{recoveryCopy.recoveryOpens} <TimestampValue timestamp={opensAt} relative={false} />
			</Badge>
		)
	else if (forkTime > 0n) badge = <Badge tone='ok'>{recoveryCopy.recoveryOpen}</Badge>
	const hasRights = model.recovery !== undefined
	return (
		<SectionBlock title={recoveryCopy.shareRecovery} description={actionDataNotice} badge={badge}>
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
				<RecoveryQuestionPicker key={`${snapshot?.securityPool}:${snapshot?.owner}:${model.sourceInput}`} model={model} snapshot={snapshot} disabled={disabled} forkQuestion={forkQuestion} />
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
