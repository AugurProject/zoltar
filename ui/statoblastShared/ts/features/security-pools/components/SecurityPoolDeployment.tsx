import { formatUnits, getAddress, isAddress } from '@zoltar/core-shared/evm/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { useUniverseName } from '@zoltar/ui-core-shared/components/UniverseNames.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { formatUniverseIdHex } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import type { ComponentChildren } from 'preact'
import { useId, useState } from 'preact/hooks'
import * as collateralCopy from '../../../copy/collateral.js'
import * as copy from '../../../copy/securityPool.js'
import * as capitalCopy from '../../../copy/securityPoolCapital.js'
import * as pageCopy from '../../../copy/securityPoolPage.js'
import { statoblastPageHref } from '../../../lib/routing.js'
import type { useSecurityPool } from '../hooks/useSecurityPool.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import { SecurityPoolButton, SecurityPoolInput, type SecurityPoolActions } from './SecurityPoolControls.js'

const deploySteps = [pageCopy.deployCollateralAndPrice, pageCopy.deployQuestionsSection, pageCopy.deployEconomicsSection, pageCopy.deployAndSetup]

type DeployStepProps = { actions: SecurityPoolActions; step?: number | undefined }

function DeploymentFields({ actions, step }: DeployStepProps) {
	const disabled = actions.busy !== undefined || actions.deploymentLocked
	const fixed = actions.admissionMode === 'fixed'
	const validIds = actions.fixedQuestionCount === undefined ? undefined : pageCopy.deployValidQuestionCount(actions.fixedQuestionCount)
	return (
		<>
			{(step === undefined || step === 0) && (
				<>
					<fieldset className='statoblast-deploy-section'>
						<legend>{pageCopy.deployCollateralSection}</legend>
						<ViewTabs
							ariaLabel={collateralCopy.selector}
							variant='segmented'
							value={actions.collateralSymbol}
							onChange={actions.setCollateralSymbol}
							options={[
								{ value: collateralCopy.weth, label: collateralCopy.weth, disabled },
								{ value: collateralCopy.usdc, label: collateralCopy.usdc, disabled },
							]}
						/>
						<SecurityPoolInput label={copy.originPool} hint={copy.originPoolHint} value={actions.originInput} onChange={actions.setOriginInput} disabled={disabled} error={actions.originForked ? copy.originForked : undefined} liveError />
					</fieldset>
					<fieldset className='statoblast-deploy-section'>
						<legend>{pageCopy.deployPriceSection}</legend>
						<SecurityPoolInput label={step === undefined ? collateralCopy.oracleStake(actions.collateral.symbol) : pageCopy.deployMinimumPriceStake(actions.collateral.symbol)} hint={collateralCopy.floorHint} value={actions.reportFloor} onChange={actions.setReportFloor} disabled={disabled} numeric />
						<SecurityPoolInput label={step === undefined ? copy.oraclePriorityFee : pageCopy.deployPricePriorityFee} value={actions.priorityFeeInput} onChange={actions.setPriorityFeeInput} disabled={disabled} numeric />
					</fieldset>
				</>
			)}
			{(step === undefined || step === 1) && (
				<fieldset className='statoblast-deploy-section'>
					<legend>{copy.admissionMode}</legend>
					<ViewTabs
						ariaLabel={copy.admissionMode}
						variant='segmented'
						value={actions.admissionMode}
						onChange={actions.setAdmissionMode}
						options={[
							{ value: 'open', label: copy.admissionOpen, disabled },
							{ value: 'fixed', label: copy.admissionFixed, disabled },
						]}
					/>
					{fixed && <SecurityPoolInput label={copy.fixedQuestionIds} hint={validIds ?? copy.fixedQuestionIdsHint} error={actions.fixedQuestions.trim() === '' ? undefined : actions.fixedQuestionError} value={actions.fixedQuestions} onChange={actions.setFixedQuestions} disabled={disabled} />}
					<UserMessage tone={fixed ? 'warning' : 'neutral'} detail={fixed ? copy.admissionFixedHint : copy.admissionOpenHint} />
					<SecurityPoolInput label={copy.horizon} hint={copy.horizonHint} value={actions.horizonDays} onChange={actions.setHorizonDays} disabled={disabled} numeric />
				</fieldset>
			)}
			{(step === undefined || step === 2) && (
				<fieldset className='statoblast-deploy-section'>
					{step === undefined && <legend>{pageCopy.deployEconomicsSection}</legend>}
					<SecurityPoolInput label={copy.securityMultiplier} hint={copy.securityMultiplierHint} value={actions.multiplierInput} onChange={actions.setMultiplierInput} disabled={disabled} numeric />
					<MetricGrid>
						<SecurityPoolInput label={copy.purchaseFeePercent} value={actions.economicsDraft.purchaseFeePercent} onChange={value => actions.setEconomicsField('purchaseFeePercent', value)} disabled={disabled} numeric />
						<SecurityPoolInput label={collateralCopy.purchaseFee(actions.collateral.symbol)} value={actions.economicsDraft.minimumPurchaseFee} onChange={value => actions.setEconomicsField('minimumPurchaseFee', value)} disabled={disabled} numeric />
						<SecurityPoolInput label={collateralCopy.commitment(actions.collateral.symbol)} hint={capitalCopy.minimumCommitmentHint} value={actions.economicsDraft.minimumCommitment} onChange={value => actions.setEconomicsField('minimumCommitment', value)} disabled={disabled} numeric />
						<SecurityPoolInput label={capitalCopy.rewardVesting} value={actions.economicsDraft.rewardVestingHours} onChange={value => actions.setEconomicsField('rewardVestingHours', value)} disabled={disabled} numeric />
						<SecurityPoolInput label={capitalCopy.annualFee} hint={capitalCopy.annualFeeHint} value={actions.economicsDraft.annualFeePercent} onChange={value => actions.setEconomicsField('annualFeePercent', value)} disabled={disabled} numeric />
						<SecurityPoolInput label={capitalCopy.outcomeRate} hint={capitalCopy.outcomeRateHint} value={actions.economicsDraft.minimumOutcomeRate} onChange={value => actions.setEconomicsField('minimumOutcomeRate', value)} disabled={disabled} numeric />
					</MetricGrid>
				</fieldset>
			)}
		</>
	)
}

function DeploymentActions({ actions, setupStage, setupVerificationPending, progressList = false }: { actions: SecurityPoolActions; setupStage?: number | undefined; setupVerificationPending?: boolean; progressList?: boolean }) {
	const originReasonId = useId()
	const setupReasonId = useId()
	const sharedSetupReason = setupVerificationPending ? actions.preparationReason(1) : undefined
	const deployActions = [
		{ action: 'deploySecurityPoolAdmission', label: copy.deployAdmission, pendingLabel: copy.deployingAdmission, reason: actions.admissionDeployReason, onClick: actions.deployAdmission, address: actions.admissionAddress },
		{ action: 'deploySecurityPool', label: copy.deploy, pendingLabel: copy.deploying, reason: actions.deployReason, onClick: actions.deploy, address: actions.deploymentPool },
	] as const
	const originReason = deployActions.some(action => action.reason === copy.originForked) ? (
		<div className='tx-action-feedback shared-action-reason'>
			<InlineHint id={originReasonId} message={copy.originForkedAction} />
		</div>
	) : undefined
	const deployButton = (stage: (typeof deployActions)[number]) => <SecurityPoolButton model={actions} action={stage.action} label={stage.label} pendingLabel={stage.pendingLabel} reason={stage.reason} sharedReasonId={stage.reason === copy.originForked ? originReasonId : undefined} onClick={stage.onClick} />
	if (!progressList)
		return (
			<>
				<UserMessage detail={copy.immutableEconomics} />
				{actions.creationError === undefined ? undefined : <UserMessage tone='error' detail={actions.creationError} />}
				{deployButton(deployActions[0])}
				{actions.admissionAddress === undefined ? undefined : <AddressValue address={actions.admissionAddress} longAbbreviation />}
				{deployButton(deployActions[1])}
				{originReason}
			</>
		)
	return (
		<>
			<ol className='statoblast-deploy-transactions' aria-label={pageCopy.deployTransactions}>
				{deployActions.map((stage, index) => (
					<DeploymentTransaction key={stage.action} index={index} label={stage.label} done={stage.address !== undefined} current={stage.reason === undefined || actions.busy === stage.action} detail={stage.address === undefined ? undefined : <AddressValue address={stage.address} longAbbreviation />}>
						{deployButton(stage)}
					</DeploymentTransaction>
				))}
				{capitalCopy.prepareStages.map((label, index) => {
					const action = 'prepareSecurityPool' + (index + 1)
					const done = setupStage !== undefined && setupStage > index
					const reason = done ? pageCopy.deployComplete : actions.deploymentPool === undefined ? copy.setupPoolRequired : actions.preparationReason(index + 1)
					const detail = index === capitalCopy.prepareStages.length - 1 ? (done ? pageCopy.deployReady : pageCopy.deploySaveToWatchlist) : pageCopy.sharedSetupStep
					return (
						<DeploymentTransaction key={label} label={label} index={index + deployActions.length} done={done} current={reason === undefined || actions.busy === action} detail={detail}>
							<SecurityPoolButton model={actions} action={action} label={label} pendingLabel={capitalCopy.preparing} reason={reason} sharedReasonId={sharedSetupReason === undefined || done ? undefined : setupReasonId} onClick={() => actions.prepare(index + 1)} />
						</DeploymentTransaction>
					)
				})}
			</ol>
			{originReason}
			{sharedSetupReason === undefined ? undefined : <InlineHint id={setupReasonId} message={sharedSetupReason} />}
		</>
	)
}

function DeploymentTransaction({ label, index, done, current, detail, children }: { label: string; index: number; done: boolean; current: boolean; detail: ComponentChildren; children: ComponentChildren }) {
	return (
		<li className='statoblast-deploy-transaction' data-done={done} aria-current={current ? 'step' : undefined}>
			<span className='statoblast-deploy-transaction-mark' aria-hidden='true'>
				{done ? pageCopy.deployCheck : index + 1}
			</span>
			<div className='statoblast-deploy-transaction-summary'>
				<strong>{label}</strong>
				{detail === undefined ? undefined : <span>{detail}</span>}
			</div>
			{children}
		</li>
	)
}

/** The legacy pool screen opens the same defaults and deploy actions in a single disclosure. */
export function SecurityPoolDeploymentForm({ actions }: { actions: SecurityPoolActions }) {
	return (
		<div className='form-grid security-pool-creation-form'>
			<DeploymentFields actions={actions} />
			<DeploymentActions actions={actions} />
		</div>
	)
}

function DeploymentSummary({ actions, economicsOnly = false }: { actions: SecurityPoolActions; economicsOnly?: boolean }) {
	const { collateral, economicsDraft } = actions
	const universeId = securityPoolUnsignedId(actions.originInput, 248)
	const universeName = useUniverseName(universeId ?? 0n)
	const questions = actions.admissionMode === 'open' ? copy.admissionOpen : actions.fixedQuestionCount === undefined ? copy.admissionFixed : pageCopy.deployQuestionListCount(actions.fixedQuestionCount)
	const amount = (value: string) => (value === '' ? undefined : `${value} ${collateral.symbol}`)
	const minimumOutcomeRate = securityPoolAmountOrUndefined(economicsDraft.minimumOutcomeRate)
	const purchaseFee = economicsDraft.purchaseFeePercent && economicsDraft.minimumPurchaseFee ? pageCopy.deploySummaryPurchaseFee(economicsDraft.purchaseFeePercent, economicsDraft.minimumPurchaseFee, collateral.symbol) : undefined
	const economics = [
		[copy.securityMultiplier, actions.multiplierInput && pageCopy.formatMultiplier(actions.multiplierInput)],
		[pageCopy.purchaseFee, purchaseFee],
		[pageCopy.holdingFee, economicsDraft.annualFeePercent && pageCopy.formatAnnualFee(economicsDraft.annualFeePercent)],
		[pageCopy.deploySummaryCommitment, amount(economicsDraft.minimumCommitment)],
		[pageCopy.deploySummaryOutcomeRate, minimumOutcomeRate === undefined ? undefined : pageCopy.formatMultiplier(formatUnits(minimumOutcomeRate, 16))],
		[pageCopy.deploySummaryRewardVesting, economicsDraft.rewardVestingHours && pageCopy.deploySummaryVesting(economicsDraft.rewardVestingHours)],
	] as const
	return (
		<dl className='statoblast-deploy-summary-fields'>
			{!economicsOnly && (
				<>
					<div>
						<dt>{collateralCopy.selector}</dt>
						<dd>{collateral.symbol}</dd>
					</div>
					<div>
						<dt>{copy.originPool}</dt>
						<dd>
							{universeId === undefined ? (
								'—'
							) : (
								<>
									{universeName}
									<IdentifierValue abbreviated value={formatUniverseIdHex(universeId)} />
								</>
							)}
						</dd>
					</div>
					<div>
						<dt>{pageCopy.deploySummaryPriceStake}</dt>
						<dd>{amount(actions.reportFloor) ?? '—'}</dd>
					</div>
					<div>
						<dt>{pageCopy.deployQuestionsSection}</dt>
						<dd>{questions}</dd>
					</div>
				</>
			)}
			{economics.map(([label, value]) => (
				<div key={label}>
					<dt>{label}</dt>
					<dd>{value || '—'}</dd>
				</div>
			))}
		</dl>
	)
}

export function SecurityPoolDeployment({ actions, model }: { actions: SecurityPoolActions; model: ReturnType<typeof useSecurityPool> }) {
	const [selectedStep, selectStep] = useState<number>()
	const activeStep = selectedStep ?? (actions.deploymentLocked ? 3 : 0)
	const currentDeployment = actions.deploymentPool !== undefined && actions.deploymentPool === model.managerInput
	const verifiedSetupStage = model.setup?.securityPool === actions.deploymentPool ? model.setup?.stage : undefined
	const setupStage = verifiedSetupStage ?? (actions.deploymentActivated ? 4 : currentDeployment ? model.savedSetupStage : undefined)
	const completedCount = Number(actions.admissionAddress !== undefined) + Number(actions.deploymentPool !== undefined) + (setupStage ?? 0)
	const transactionProgress = completedCount === 0 && activeStep < 3 ? pageCopy.deployTransactionCount : completedCount === 6 ? pageCopy.deployAllTransactionsDone : pageCopy.deployTransactionProgress(completedCount)
	const questionList = actions.admissionMode === 'open' ? copy.admissionOpen : actions.fixedQuestionCount === undefined ? copy.admissionFixed : pageCopy.deployQuestionListCount(actions.fixedQuestionCount)
	const progressLabels = [actions.collateral.symbol, questionList, activeStep > 2 ? pageCopy.deployReviewed : pageCopy.deployDefaults, transactionProgress]
	const showTransactions = actions.deploymentLocked || activeStep === 3
	const showLockedEconomics = actions.deploymentLocked && activeStep >= 2
	const leftStep = activeStep === 3 ? 2 : activeStep
	const previousPool = actions.deploymentPool === undefined && (model.setup?.stage ?? model.savedSetupStage ?? 4) < 4 && isAddress(model.managerInput) ? getAddress(model.managerInput) : undefined
	const openPool = setupStage === 4 ? actions.deploymentPool : undefined
	return (
		<>
			<nav className='statoblast-breadcrumbs' aria-label={pageCopy.breadcrumbs}>
				<a href={statoblastPageHref({ kind: 'watchlist' })}>{pageCopy.watchlist}</a>
				<span aria-hidden='true'>›</span>
				<span aria-current='page'>{pageCopy.deployPool}</span>
			</nav>
			<RouteHeader title={pageCopy.deployPool} description={pageCopy.deploySettingsPermanent} actions={<UpdatedAgo updatedAt={model.displayedAt} refreshing={model.loading} />} />
			<ol className='statoblast-deploy-progress' aria-label={pageCopy.deployProgress}>
				{deploySteps.map((label, index) => (
					<li key={label} data-done={index < activeStep || (actions.deploymentLocked && index < 3)}>
						<button type='button' className='secondary' aria-current={index === activeStep ? 'step' : undefined} onClick={() => selectStep(index)}>
							<strong>{pageCopy.deployStepNumber(index, label)}</strong>
							<span>{index === activeStep && index < 3 && !actions.deploymentLocked ? pageCopy.deployEditing : progressLabels[index]}</span>
						</button>
					</li>
				))}
			</ol>
			{previousPool === undefined ? undefined : <a href={statoblastPageHref({ kind: 'pool', pool: previousPool, tab: 'capital' })}>{pageCopy.resumePreviousSetup}</a>}
			<div className='statoblast-deploy-layout' data-transactions={showTransactions}>
				<SectionBlock title={pageCopy.deployStepNumber(leftStep, deploySteps[leftStep] ?? '')} headingLevel={2} badge={actions.deploymentLocked ? <Badge>{pageCopy.deployLocked}</Badge> : undefined}>
					{showLockedEconomics ? <DeploymentSummary actions={actions} economicsOnly /> : <DeploymentFields actions={actions} step={leftStep} />}
					{actions.deploymentLocked && <UserMessage detail={pageCopy.deploySettingsLocked} />}
					{!actions.deploymentLocked && activeStep < 3 && (
						<div className='actions statoblast-deploy-navigation'>
							{activeStep > 0 && (
								<button type='button' className='secondary' onClick={() => selectStep(activeStep - 1)}>
									{pageCopy.deployBack}
								</button>
							)}
							<button type='button' onClick={() => selectStep(activeStep + 1)}>
								{pageCopy.deployContinue(deploySteps[activeStep + 1] ?? '')}
							</button>
						</div>
					)}
				</SectionBlock>
				{showTransactions ? (
					<SectionBlock title={pageCopy.deployStepNumber(3, pageCopy.deployAndSetup)} headingLevel={2} description={pageCopy.deployProgressSaved} className='security-pool-creation-form'>
						{actions.creationError === undefined ? undefined : <UserMessage tone='error' detail={actions.creationError} />}
						<DeploymentActions actions={actions} setupStage={setupStage} progressList setupVerificationPending={verifiedSetupStage === undefined && setupStage !== undefined && setupStage < 4} />
						{openPool === undefined ? undefined : (
							<div className='actions'>
								<a className='button-link' href={statoblastPageHref({ kind: 'pool', pool: openPool, tab: 'capital' })}>
									{pageCopy.openSecurityPool}
								</a>
								<button
									type='button'
									className='secondary'
									onClick={() => {
										actions.startNewDeployment()
										selectStep(0)
									}}
								>
									{pageCopy.deployAnother}
								</button>
							</div>
						)}
					</SectionBlock>
				) : (
					<SectionBlock title={pageCopy.deploySummary} className='statoblast-deploy-summary'>
						<DeploymentSummary actions={actions} />
						<p>{pageCopy.deploySummaryTransactionCount}</p>
					</SectionBlock>
				)}
			</div>
		</>
	)
}
