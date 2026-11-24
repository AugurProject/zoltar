import { useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { parseWatchlistEntity, decodeWatchlistRows } from '../../../protocol/watchlistRows.js'
import { statoblastDisplayCache } from '../../../protocol/statoblastPageCache.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import * as pageCopy from '../../../copy/forkRecovery.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import * as collateralCopy from '../../../copy/collateral.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { formatUniverseIdHex } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { OnChainText } from '@zoltar/ui-core-shared/components/OnChainText.js'
import { OutcomeIdentity } from '@zoltar/ui-core-shared/components/OutcomeIdentity.js'
import { SecurityPoolButton, SecurityPoolInput } from './SecurityPoolControls.js'
import { useSecurityPoolSharedFork, type SecurityPoolSharedForkParameters } from '../hooks/useSecurityPoolSharedFork.js'
import { SecurityPoolPriceReport } from './SecurityPoolPriceReport.js'
import { branchPriceTarget } from '../hooks/useSecurityPoolPrice.js'
import { SecurityPoolRepairAuction } from './SecurityPoolRepairAuction.js'
import * as copy from '../../../copy/securityPoolSharedFork.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function SecurityPoolSharedFork({ redesigned = false, forkQuestion, onBranchCommitted, ...parameters }: SecurityPoolSharedForkParameters & { redesigned?: boolean; forkQuestion?: MarketDetails | undefined; onBranchCommitted?: ((committed: boolean) => void) | undefined }) {
	const model = useSecurityPoolSharedFork(parameters)
	const state = model.state
	const saved = useFavorites('statoblast', 'question')
	const recoveryQuestions = saved.entries.flatMap(item => {
		const entry = parseWatchlistEntity(item.id, 'question')
		if (entry?.kind !== 'question' || entry.pool !== parameters.snapshot?.securityPool) return []
		return [{ ...entry, label: item.label }]
	})
	const cached = state === undefined ? undefined : statoblastDisplayCache(getActiveNetworkProfile(), { universeId: state.universeId, owner: parameters.bidder, page: 'watchlist' }, decodeWatchlistRows).read()
	const questionTitle = (id: string, questionId: bigint, label: string | undefined) => label ?? cached?.value.find(row => row.entity.id === id)?.question?.marketDetails.title ?? formatQuestionIdHex(questionId)
	const checkedStep = (done: boolean) => (done && redesigned ? <span className='statoblast-step-done'>{pageCopy.completedStep}</span> : undefined)
	const disabled = parameters.actions.busy !== undefined
	const branch = state?.branch
	const [pricedBranch, setPricedBranch] = useState<bigint>()
	const [finalizedAuctionBranch, setFinalizedAuctionBranch] = useState<bigint>()
	const openedPositionKey = state === undefined || branch === undefined ? undefined : `statoblast:opened-branch-position:${state.chainId}:${state.securityPool}:${state.owner}:${branch.universeId}`
	const rememberOpen = () => {
		if (openedPositionKey !== undefined && model.openReason === undefined) {
			try {
				getBrowserStorage('localStorage')?.setItem(openedPositionKey, 'yes')
			} catch (error) {
				if (!(error instanceof DOMException)) throw error
			}
		}
		model.open()
	}
	let opened = false
	if (openedPositionKey !== undefined) {
		try {
			opened = getBrowserStorage('localStorage')?.getItem(openedPositionKey) === 'yes'
		} catch (error) {
			if (!(error instanceof DOMException)) throw error
		}
	}
	const choices = namedBranchChoices(forkQuestion)
	const priceSection = useRef<HTMLDivElement>(null)
	const auctionSection = useRef<HTMLDivElement>(null)
	const openSection = (section: HTMLDivElement | null) => {
		section?.scrollIntoView({ block: 'start' })
		section?.focus({ preventScroll: true })
	}
	const priceTarget = branchPriceTarget(state)
	const priceReason = priceTarget === undefined ? pageCopy.branchPriceLockedReason : undefined
	const auctionReason = branch?.started !== true ? pageCopy.auctionLockedReason : undefined
	const [confirmedChoice, setConfirmedChoice] = useState(false)
	useEffect(() => setConfirmedChoice(false), [model.outcomeInput, model.sourceInput])
	useEffect(() => {
		if (state !== undefined) onBranchCommitted?.(state.choice.recorded)
	}, [state?.choice.recorded])
	const chooseReason = model.chooseReason ?? (redesigned && !confirmedChoice ? pageCopy.branchConfirmationReason : undefined)
	const committedMessage = redesigned ? pageCopy.branchCommitted : copy.chosen(state?.choice.outcomeIndex ?? 0n)
	let branchState = copy.branchStates.choose
	if (branch !== undefined) {
		branchState = copy.branchStates.unprepared
		if (branch.prepared) branchState = copy.branchStates.chosen
		if (branch.started) branchState = copy.branchStates.waiting
		if (branch.ready) branchState = copy.branchStates.active
	}
	return (
		<div className='route-view-flow'>
			<SectionBlock title={redesigned ? pageCopy.forkRecovery : copy.title} description={redesigned ? undefined : copy.description}>
				{redesigned && state !== undefined && state.forkTime > 0n && (
					<div className='statoblast-fork-diagram'>
						<strong>
							{pageCopy.parentUniverse} <IdentifierValue abbreviated value={formatUniverseIdHex(state.universeId)} />
						</strong>
						<span aria-hidden='true'>↓</span>
						{choices.length > 0 ? (
							<ul>
								{choices.map(({ label, outcome }) => (
									<li key={outcome} data-chosen={state.choice.recorded && state.choice.outcomeIndex.toString() === outcome}>
										<OnChainText text={label} />
										{branch?.outcomeIndex.toString() === outcome && <IdentifierValue abbreviated value={formatUniverseIdHex(branch.universeId)} />}
									</li>
								))}
							</ul>
						) : (
							<span>{model.outcome?.outcomeLabel ?? pageCopy.branchTitle}</span>
						)}
					</div>
				)}
				{redesigned ? (
					<BranchChoices question={forkQuestion} value={model.outcomeInput} onChange={model.setOutcome} disabled={disabled || state?.choice.recorded === true} />
				) : (
					<MetricGrid>
						<SecurityPoolInput label={copy.universe} value={model.sourceInput} onChange={model.setSource} disabled={disabled} />
						<SecurityPoolInput label={copy.outcome} hint={copy.outcomeHint} value={model.outcomeInput} onChange={model.setOutcome} disabled={disabled} />
					</MetricGrid>
				)}
				{model.error === undefined ? undefined : <UserMessage tone='error' detail={model.error} />}
				{state?.forkTime === 0n ? <UserMessage detail={copy.noFork} /> : undefined}
				{model.outcome?.outcomeLabel === undefined ? undefined : (
					<UserMessage
						detail={
							<>
								<OnChainText text={model.outcome.questionTitle} />
								{copy.questionOutcomeSeparator}
								<OnChainText text={model.outcome.outcomeLabel} />
								{redesigned || branch === undefined ? undefined : <OutcomeIdentity label={model.outcome.outcomeLabel} outcomeIndex={branch.outcomeIndex} />}
							</>
						}
					/>
				)}
				<MetricGrid>
					<MetricField label={copy.choiceDeadline} loading={model.loading}>
						{state === undefined || state.choiceDeadline === 0n ? undefined : formatTimestamp(state.choiceDeadline)}
					</MetricField>
					<MetricField label={redesigned ? pageCopy.recapitalizationDeadline : copy.activationDeadline} loading={model.loading}>
						{state === undefined || state.activationDeadline === 0n ? undefined : formatTimestamp(state.activationDeadline)}
					</MetricField>
					<MetricField label={copy.child} loading={model.loading}>
						{branch === undefined ? undefined : <IdentifierValue abbreviated value={formatUniverseIdHex(branch.universeId)} />}
					</MetricField>
					<MetricField label={copy.forkQuestionId} loading={model.loading}>
						{model.outcome === undefined ? undefined : <IdentifierValue abbreviated value={formatQuestionIdHex(model.outcome.questionId)} />}
					</MetricField>
					<MetricField label={copy.state} loading={model.loading}>
						{branchState}
					</MetricField>
				</MetricGrid>
				<UserMessage tone='warning' detail={copy.choiceHint} />
				<UserMessage detail={state?.choice.recorded ? committedMessage : copy.unchosen} />
				{redesigned && state?.choice.recorded !== true && (
					<label className='statoblast-choice-confirmation'>
						<input type='checkbox' checked={confirmedChoice} disabled={disabled} onChange={event => setConfirmedChoice(event.currentTarget.checked)} />
						{pageCopy.branchConfirmation}
					</label>
				)}
				<ol className='statoblast-fork-steps'>
					<li>
						<SecurityPoolButton model={parameters.actions} action='prepareSecurityPoolFork' label={copy.prepareBranch} pendingLabel={copy.preparingBranch} reason={model.prepareBranchReason} onClick={model.prepareBranch} />
						{checkedStep(branch?.prepared === true)}
					</li>
					<li>
						<SecurityPoolButton model={parameters.actions} action='chooseSecurityPoolFork' label={copy.choice} pendingLabel={copy.choosing} reason={chooseReason} onClick={model.choose} />
						{checkedStep(state?.choice.recorded === true)}
					</li>
					<li>
						<SecurityPoolButton model={parameters.actions} action='startSecurityPoolFork' label={copy.start} pendingLabel={copy.starting} reason={model.startReason} onClick={model.start} />
						{checkedStep(branch?.started === true)}
					</li>
					{redesigned && (
						<li>
							<ActionLauncherButton tone='secondary' idleLabel={pageCopy.branchRepPrice} pendingLabel={pageCopy.branchRepPrice} availability={{ disabled: priceReason !== undefined, reason: priceReason }} onClick={() => openSection(priceSection.current)} />
							{checkedStep(branch !== undefined && pricedBranch === branch.universeId)}
						</li>
					)}
					{redesigned && (
						<li>
							<ActionLauncherButton tone='secondary' idleLabel={pageCopy.repairAuction} pendingLabel={pageCopy.repairAuction} availability={{ disabled: auctionReason !== undefined, reason: auctionReason }} onClick={() => openSection(auctionSection.current)} />
							{checkedStep(branch !== undefined && finalizedAuctionBranch === branch.universeId)}
						</li>
					)}
					<li>
						<SecurityPoolButton model={parameters.actions} action='finalizeSecurityPoolFork' label={copy.finalize} pendingLabel={copy.finalizing} reason={model.finalizeReason} onClick={model.finalize} />
						{checkedStep(branch?.ready === true)}
					</li>
					<li>
						<ActionLauncherButton tone='secondary' idleLabel={copy.open} pendingLabel={copy.loading} availability={{ disabled: disabled || model.openReason !== undefined, reason: disabled ? copy.busy : model.openReason }} onClick={rememberOpen} />
						{checkedStep(opened)}
					</li>
				</ol>
			</SectionBlock>
			<div ref={priceSection} tabIndex={-1}>
				<SecurityPoolPriceReport hideReportingDeadline={redesigned} scope='branch' target={priceTarget} displayTarget={priceTarget ?? model.savedBranch} actions={parameters.actions} bidder={parameters.bidder} referencePrice={parameters.snapshot?.acceptedPrice} onPriceAccepted={setPricedBranch} />
			</div>
			<div ref={auctionSection} tabIndex={-1}>
				<SecurityPoolRepairAuction fork={state} savedBranch={model.savedBranch} actions={parameters.actions} bidder={parameters.bidder} openVault={parameters.openVault} onAuctionFinalized={setFinalizedAuctionBranch} />
			</div>
			<SectionBlock title={pageCopy.shareRecovery}>
				<WorkflowSubsection title={copy.basketTitle}>
					<UserMessage detail={copy.basketHint} />
					<MetricGrid>
						<MetricField label={copy.cashRecovery} loading={model.loading}>
							<CurrencyValue value={branch?.parentCash} suffix={parameters.snapshot?.collateral.symbol ?? collateralCopy.fallback} units={parameters.snapshot?.collateral.decimals ?? 0} />
						</MetricField>
						<MetricField label={copy.repRecovery} loading={model.loading}>
							<CurrencyValue value={branch?.started ? branch.recoveryAttoRep : undefined} suffix={common.rep} />
						</MetricField>
					</MetricGrid>
				</WorkflowSubsection>
				<WorkflowSubsection title={copy.recovery}>
					<UserMessage detail={copy.recoveryHint} />
					<MetricGrid>
						{redesigned ? (
							<label className='field'>
								<span>{copy.question}</span>
								<select value={model.questionInput} disabled={disabled || recoveryQuestions.length === 0} onChange={event => model.setQuestion(event.currentTarget.value)}>
									<option value=''>{pageCopy.chooseRecoveryQuestion}</option>
									{recoveryQuestions.map(({ id, questionId, label }) => (
										<option key={id} value={formatQuestionIdHex(questionId)}>
											{questionTitle(id, questionId, label)}
										</option>
									))}
								</select>
								{recoveryQuestions.length === 0 && <small>{pageCopy.noSavedRecoveryQuestions}</small>}
							</label>
						) : (
							<SecurityPoolInput label={copy.question} value={model.questionInput} onChange={model.setQuestion} disabled={disabled} />
						)}
						<SecurityPoolInput label={copy.shares} value={model.sharesInput} onChange={model.setShares} disabled={disabled} numeric />
						<MetricField label={copy.available}>
							<CurrencyValue value={model.recovery?.availableShares} units={parameters.snapshot?.collateral.decimals ?? 0} />
						</MetricField>
					</MetricGrid>
					<div className='actions'>
						<SecurityPoolButton model={parameters.actions} action='prepareSecurityPoolRecovery' label={copy.prepare} pendingLabel={copy.preparing} reason={model.prepareReason} onClick={model.prepare} />
						<SecurityPoolButton model={parameters.actions} action='recoverSecurityPoolSource' label={copy.recover} pendingLabel={copy.recovering} reason={model.recoverReason} onClick={model.recover} />
					</div>
					<MetricGrid>
						<MetricField label={copy.invalidAvailable}>
							<CurrencyValue value={model.recovery?.rights[0]} units={parameters.snapshot?.collateral.decimals ?? 0} />
						</MetricField>
						<MetricField label={copy.yesAvailable}>
							<CurrencyValue value={model.recovery?.rights[1]} units={parameters.snapshot?.collateral.decimals ?? 0} />
						</MetricField>
						<MetricField label={copy.noAvailable}>
							<CurrencyValue value={model.recovery?.rights[2]} units={parameters.snapshot?.collateral.decimals ?? 0} />
						</MetricField>
					</MetricGrid>
					<UserMessage detail={copy.transferHint} />
					<SecurityPoolInput label={copy.recipient} value={model.recipientInput} onChange={model.setRecipient} disabled={disabled} />
					<MetricGrid>
						<SecurityPoolInput label={copy.invalidTransfer} value={model.invalidRightsInput} onChange={model.setInvalidRights} disabled={disabled} numeric />
						<SecurityPoolInput label={copy.yesTransfer} value={model.yesRightsInput} onChange={model.setYesRights} disabled={disabled} numeric />
						<SecurityPoolInput label={copy.noTransfer} value={model.noRightsInput} onChange={model.setNoRights} disabled={disabled} numeric />
					</MetricGrid>
					<SecurityPoolButton model={parameters.actions} action='transferSecurityPoolRecoveryRights' label={copy.transfer} pendingLabel={copy.transferring} reason={model.transferReason} onClick={model.transfer} />
				</WorkflowSubsection>
			</SectionBlock>
		</div>
	)
}

function BranchChoices({ question, value, onChange, disabled }: { question: MarketDetails | undefined; value: string; onChange: (outcome: string) => void; disabled: boolean }) {
	if (question === undefined) return undefined
	if (question.marketType === 'scalar') {
		const outcome = /^\d+$/u.test(value) ? BigInt(value) : undefined
		const selection = outcome === undefined ? undefined : getScalarOutcomeIndexDescriptor(question, outcome)
		const tick = selection?.kind === 'tick' ? selection.tickIndex : undefined
		const fallback = outcome === 0n ? pageCopy.invalid : common.none
		return (
			<ScalarOutcomePicker
				details={{ ...question, minValueLabel: formatScalarOutcomeLabel(question, 0n), maxValueLabel: formatScalarOutcomeLabel(question, question.numTicks) }}
				disabled={disabled}
				isInvalid={outcome === 0n}
				label={pageCopy.branchTitle}
				onInvalidChange={invalid => onChange(invalid ? '0' : '')}
				onSelectedTickChange={input => {
					const selected = /^\d+$/u.test(input) ? BigInt(input) : undefined
					onChange(selected !== undefined && selected <= question.numTicks ? getScalarOutcomeIndex(question, selected).toString() : '')
				}}
				selectedOutcomeLabel={tick === undefined ? fallback : formatScalarOutcomeLabel(question, tick)}
				selectedTick={tick?.toString() ?? ''}
			/>
		)
	}
	const outcomes = namedBranchChoices(question)
	return (
		<fieldset className='statoblast-branch-choices'>
			<legend>{pageCopy.branchTitle}</legend>
			{outcomes.map(({ label, outcome }) => (
				<label key={outcome}>
					<input type='radio' name='statoblast-fork-branch' checked={value === outcome} disabled={disabled} onChange={() => onChange(outcome)} />
					<OnChainText text={label} />
				</label>
			))}
		</fieldset>
	)
}

function namedBranchChoices(question: MarketDetails | undefined) {
	if (question === undefined || question.marketType === 'scalar') return []
	return [...question.outcomeLabels.map((label, index) => ({ label, outcome: String(index + 1) })), { label: pageCopy.invalid, outcome: '0' }]
}
