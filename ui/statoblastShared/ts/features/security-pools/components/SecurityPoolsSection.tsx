import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import * as pageCopy from '../../../copy/securityPoolPage.js'
import { useStatoblastPageRefresh, type RegisterStatoblastPageRefresh, type ReportStatoblastReadStatus } from '../../useStatoblastPageRefresh.js'
import { SecurityPoolQuestionsPanel } from './SecurityPoolQuestionsPanel.js'
import { StatoblastPoolHead } from './StatoblastPoolHead.js'
import { statoblastPageHref, type StatoblastPoolPage } from '../../../lib/routing.js'
import { useSecurityPoolPriceDeadline } from '../hooks/useSecurityPoolPriceDeadline.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import * as collateralCopy from '../../../copy/collateral.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { getAddress, isAddress } from '@zoltar/core-shared/evm/ethereum'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { TransactionScopeProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { useSecurityPool } from '../hooks/useSecurityPool.js'
import { useSecurityPoolActions } from '../hooks/useSecurityPoolActions.js'
import { useSecurityPoolAggregate } from '../hooks/useSecurityPoolAggregate.js'
import { useSecurityPoolPurchase } from '../hooks/useSecurityPoolPurchase.js'
import { SecurityPoolTakeover } from './SecurityPoolTakeover.js'
import { SecurityPoolAggregatePanel } from './SecurityPoolAggregatePanel.js'
import { SecurityPoolSharedFork } from './SecurityPoolSharedFork.js'
import { SecurityPoolPurchasePanel } from './SecurityPoolPurchasePanel.js'
import { SecurityPoolPriceReport } from './SecurityPoolPriceReport.js'
import { accountPriceTarget } from '../hooks/useSecurityPoolPrice.js'
import { SecurityPoolButton, SecurityPoolInput } from './SecurityPoolControls.js'
import * as copy from '../../../copy/securityPool.js'
import * as capitalCopy from '../../../copy/securityPoolCapital.js'

/** `walletConnected` reports a wallet on any network; `parameters.accountAddress` is set only on the app's network. */
export function SecurityPoolsSection({
	parameters,
	walletConnected,
	enabled,
	environmentKey,
	activeUniverseId,
	cacheReads = false,
	page,
	deploying = false,
	forkQuestion,
	onBranchCommitted,
	onSelectUniverse,
	openOracleHref,
	registerPageRefresh,
	onReadStatus,
}: {
	registerPageRefresh?: RegisterStatoblastPageRefresh | undefined
	onReadStatus?: ReportStatoblastReadStatus | undefined
	cacheReads?: boolean
	forkQuestion?: MarketDetails | undefined
	onBranchCommitted?: ((committed: boolean) => void) | undefined
	onSelectUniverse?: ((id: bigint) => void) | undefined
	openOracleHref?: string | undefined
	page?: StatoblastPoolPage | undefined
	deploying?: boolean
	parameters: WriteOperationsParameters
	walletConnected: boolean
	enabled: boolean
	environmentKey: number
	activeUniverseId: bigint
}) {
	const [fundsRemain, setFundsRemain] = useState(false)
	const [deployStep, setDeployStep] = useState(0)
	const deploySteps = [pageCopy.deployCollateralAndPrice, pageCopy.deployQuestionsSection, pageCopy.deployEconomicsSection, pageCopy.deployAndSetup]
	const model = useSecurityPool({ accountAddress: parameters.accountAddress, enabled, environmentKey, activeUniverseId, cacheReads: cacheReads && !deploying, resumeSetup: deploying, securityPoolAddress: page?.pool })
	useStatoblastPageRefresh(registerPageRefresh, model.refresh)
	useEffect(() => onReadStatus?.(model.displayedAt, undefined), [model.displayedAt, onReadStatus])
	const actions = useSecurityPoolActions(model, parameters)
	const priceDeadline = useSecurityPoolPriceDeadline(model.presentationSnapshot, model.displayedAt, model.refresh)
	const capital = useSecurityPoolAggregate(model, actions, parameters.accountAddress)
	const purchase = useSecurityPoolPurchase(model, actions)
	// Only once the page can read the chain, so a wallet still starting up is not told to connect.
	const ownerMissing = enabled && isAddress(model.managerInput.trim()) && !isAddress(model.ownerInput.trim())
	let ownerMessage: string | undefined
	// Only a visitor with no wallet at all is asked to connect one; a wallet on another network is flagged in the header.
	if (ownerMissing) ownerMessage = walletConnected ? copy.ownerAddressNeeded : copy.ownerNeeded
	const disabled = actions.busy !== undefined
	const isPresentationOnly = model.snapshot === undefined && model.presentationSnapshot !== undefined
	const shown = model.presentationSnapshot
	const deployReasonId = useId()
	// Once an account has been shown, its price report stays mounted through a failed refresh so typed drafts survive;
	// only opening another security pool, owner or universe replaces it.
	const accountIdentity = `${model.managerInput.trim().toLowerCase()}:${model.ownerInput.trim().toLowerCase()}:${model.universeInput.trim()}`
	const shownAccount = useRef<string>()
	if (model.presentationSnapshot !== undefined) shownAccount.current = accountIdentity
	const creationForm = (
		<>
			{deploying && (
				<ol className='statoblast-deploy-progress' aria-label={pageCopy.deployProgress}>
					{deploySteps.map((label, step) => (
						<li key={label} data-done={step < deployStep}>
							<button type='button' className='secondary' aria-current={step === deployStep ? 'step' : undefined} onClick={() => setDeployStep(step)}>
								{label}
							</button>
						</li>
					))}
				</ol>
			)}
			<div className='statoblast-deploy-layout'>
				<div className='form-grid security-pool-creation-form'>
					{(!deploying || deployStep === 0) && (
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

								<SecurityPoolInput label={collateralCopy.oracleStake(actions.collateral.symbol)} hint={collateralCopy.floorHint} value={actions.reportFloor} onChange={actions.setReportFloor} disabled={disabled} numeric />
								<SecurityPoolInput label={copy.oraclePriorityFee} value={actions.priorityFeeInput} onChange={actions.setPriorityFeeInput} disabled={disabled} />
							</fieldset>
						</>
					)}
					{(!deploying || deployStep === 1) && (
						<fieldset className='statoblast-deploy-section'>
							<legend>{pageCopy.deployQuestionsSection}</legend>

							<ViewTabs
								ariaLabel={copy.admissionMode}
								variant='segmented'
								value={actions.admissionMode}
								onChange={actions.setAdmissionMode}
								options={[
									{ value: 'open', label: copy.admissionOpen },
									{ value: 'fixed', label: copy.admissionFixed },
								]}
							/>
							<UserMessage detail={actions.admissionMode === 'open' ? copy.admissionOpenHint : copy.admissionFixedHint} />
							{actions.admissionMode === 'fixed' ? <SecurityPoolInput label={copy.fixedQuestionIds} hint={copy.fixedQuestionIdsHint} value={actions.fixedQuestions} onChange={actions.setFixedQuestions} disabled={disabled} /> : undefined}
							<SecurityPoolInput label={copy.horizon} hint={copy.horizonHint} value={actions.horizonDays} onChange={actions.setHorizonDays} disabled={disabled} numeric />
						</fieldset>
					)}
					{(!deploying || deployStep === 2) && (
						<fieldset className='statoblast-deploy-section'>
							<legend>{pageCopy.deployEconomicsSection}</legend>

							<SecurityPoolInput label={copy.securityMultiplier} hint={copy.securityMultiplierHint} value={actions.multiplierInput} onChange={actions.setMultiplierInput} disabled={disabled} />
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
					{(!deploying || deployStep === 3) && (
						<>
							<UserMessage detail={copy.immutableEconomics} />
							{actions.creationError === undefined ? undefined : <UserMessage tone='error' detail={actions.creationError} />}
							<SecurityPoolButton
								model={actions}
								action='deploySecurityPoolAdmission'
								label={copy.deployAdmission}
								pendingLabel={copy.deployingAdmission}
								reason={actions.admissionDeployReason}
								sharedReasonId={actions.admissionDeployReason === copy.originForked ? deployReasonId : undefined}
								onClick={actions.deployAdmission}
							/>
							{actions.admissionAddress === undefined ? undefined : <AddressValue address={actions.admissionAddress} longAbbreviation />}
							<SecurityPoolButton model={actions} action='deploySecurityPool' label={copy.deploy} pendingLabel={copy.deploying} reason={actions.deployReason} sharedReasonId={actions.deployReason === copy.originForked ? deployReasonId : undefined} onClick={actions.deploy} />
							{actions.originForked ? (
								<div className='tx-action-feedback shared-action-reason'>
									<InlineHint id={deployReasonId} message={copy.originForkedAction} />
								</div>
							) : undefined}
						</>
					)}
					{deploying && (
						<div className='actions statoblast-deploy-navigation'>
							{deployStep > 0 && (
								<button className='secondary' type='button' onClick={() => setDeployStep(deployStep - 1)}>
									{pageCopy.deployBack}
								</button>
							)}
							{deployStep < deploySteps.length - 1 && (
								<button type='button' onClick={() => setDeployStep(deployStep + 1)}>
									{pageCopy.deployContinue(deploySteps[deployStep + 1] ?? '')}
								</button>
							)}
						</div>
					)}
				</div>
				{deploying && (
					<aside className='statoblast-deploy-summary' aria-label={pageCopy.deploySummary}>
						<h3>{pageCopy.deploySummary}</h3>
						<MetricGrid>
							<MetricField label={pageCopy.deployCollateralSection}>{actions.collateral.symbol}</MetricField>
							<MetricField label={copy.originPool}>{actions.originInput || undefined}</MetricField>
							<MetricField label={pageCopy.deployQuestionsSection}>{actions.admissionMode === 'open' ? copy.admissionOpen : copy.admissionFixed}</MetricField>
							<MetricField label={copy.securityMultiplier}>{actions.multiplierInput ? pageCopy.formatMultiplier(actions.multiplierInput) : undefined}</MetricField>
							<MetricField label={capitalCopy.annualFee}>{actions.economicsDraft.annualFeePercent ? pageCopy.formatMultiplier(actions.economicsDraft.annualFeePercent) : undefined}</MetricField>
							<MetricField label={copy.purchaseFeePercent}>{actions.economicsDraft.purchaseFeePercent ? pageCopy.formatMultiplier(actions.economicsDraft.purchaseFeePercent) : undefined}</MetricField>
						</MetricGrid>
					</aside>
				)}
			</div>
		</>
	)

	return (
		<div className='security-pool-flow'>
			{page === undefined ? (
				<RouteHeader title={deploying ? pageCopy.deployPool : pageCopy.securityPool} actions={<UpdatedAgo updatedAt={model.displayedAt} refreshing={model.loading} />} />
			) : (
				<StatoblastPoolHead page={page} model={model} wallet={parameters.accountAddress} priceChecking={priceDeadline.status !== undefined} fundsRemain={fundsRemain} />
			)}
			{page === undefined && (
				<SectionBlock title={deploying ? pageCopy.securityPoolSettings : copy.setup}>
					{!deploying && (
						<MetricGrid>
							<SecurityPoolInput label={copy.manager} value={model.managerInput} onChange={model.setManagerInput} disabled={disabled} />
							<SecurityPoolInput label={copy.owner} value={model.ownerInput} onChange={model.setOwnerInput} hint={ownerMissing ? undefined : copy.ownerHint} error={ownerMessage} liveError disabled={disabled} />
							<SecurityPoolInput label={copy.universe} value={model.universeInput} onChange={model.setUniverseInput} disabled={disabled} />
						</MetricGrid>
					)}
					{deploying ? (
						creationForm
					) : (
						<details>
							<summary>{copy.deploy}</summary>
							{creationForm}
						</details>
					)}
				</SectionBlock>
			)}
			{((deploying && (deployStep === 3 || model.setup !== undefined)) || (!deploying && (page === undefined || (model.setup?.stage !== undefined && model.setup.stage < 4)))) && (
				<SectionBlock title={capitalCopy.prepareTitle} description={actions.setupStage === 4 ? undefined : capitalCopy.prepareHint}>
					<UserMessage tone={actions.setupStage === 4 ? 'success' : 'neutral'} detail={actions.setupStage === undefined ? capitalCopy.prepareProgressUnknown : capitalCopy.prepareProgress(actions.setupStage)} />
					<ol className='statoblast-fork-steps'>
						{capitalCopy.prepareStages.map((label, index) => (
							<li key={label}>
								<SecurityPoolButton model={actions} action={`prepareSecurityPool${index + 1}`} label={label} pendingLabel={capitalCopy.preparing} reason={actions.preparationReason(index + 1)} onClick={() => actions.prepare(index + 1)} />
								<span>{(model.setup?.stage ?? 0) > index ? pageCopy.stepDone : pageCopy.sharedSetupStep}</span>
							</li>
						))}
					</ol>
				</SectionBlock>
			)}
			{priceDeadline.status === 'checking' && <UserMessage placement='section' announcement='polite' detail={pageCopy.priceWindowEndedChecking} />}
			{priceDeadline.status === 'failed' && (
				<button type='button' onClick={priceDeadline.retry}>
					{pageCopy.tryAgain}
				</button>
			)}
			{model.error === undefined ? undefined : (
				<UserMessage
					placement='section'
					tone='error'
					announcement='polite'
					actions={
						<button className='secondary' type='button' onClick={() => void model.refresh()}>
							{pageCopy.tryAgain}
						</button>
					}
					detail={
						isPresentationOnly ? (
							<>
								{pageCopy.staleDataLead}
								{model.error}
							</>
						) : (
							model.error
						)
					}
				/>
			)}
			{actions.error === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={actions.error} />}
			{actions.feedback === undefined ? undefined : <UserMessage placement='section' tone='success' announcement='polite' detail={actions.feedback} />}
			{deploying && isAddress(model.managerInput) && <a href={statoblastPageHref({ kind: 'pool', pool: getAddress(model.managerInput), tab: 'capital' })}>{pageCopy.openSecurityPool}</a>}
			{!deploying && (
				<TransactionScopeProvider scope={actions.scope}>
					{(page === undefined || page.tab === 'capital') && (
						<SecurityPoolAggregatePanel
							redesigned={page !== undefined}
							model={capital}
							priceDeadlineChecking={priceDeadline.status !== undefined}
							actions={actions}
							priceReport={page === undefined && shownAccount.current === accountIdentity ? unfolded => <SecurityPoolPriceReport scope='universe' target={unfolded ? accountPriceTarget(model.snapshot) : undefined} actions={actions} bidder={parameters.accountAddress} /> : undefined}
						/>
					)}
					{(page === undefined || (page.tab === 'liquidations' && (shown?.forkTime ?? 0n) === 0n)) && <SecurityPoolTakeover model={model} actions={actions} redesigned={page !== undefined} />}
					{page === undefined && <SecurityPoolPurchasePanel model={model} purchase={purchase} actions={actions} />}
					{page?.tab === 'questions' && (
						<SecurityPoolQuestionsPanel pool={page.pool} universeId={activeUniverseId} actions={actions} admission={shown?.admission} forked={(shown?.forkTime ?? 0n) > 0n} owner={parameters.accountAddress} enabled={enabled} environmentKey={environmentKey} registerPageRefresh={registerPageRefresh} />
					)}
					{page?.tab === 'price' && (
						<SecurityPoolPriceReport
							redesigned
							scope='universe'
							target={accountPriceTarget(model.snapshot)}
							actions={actions}
							bidder={parameters.accountAddress}
							returnFundsOnly={(shown?.forkTime ?? 0n) > 0n}
							onFundingStatus={setFundsRemain}
							priceBand={shown === undefined || shown.acceptedPrice === 0n ? undefined : { accepted: shown.acceptedPrice, health: shown.conservativePrice, liquidation: shown.liquidationPrice, validUntil: shown.priceValidUntil, timestamp: shown.timestamp, decimals: shown.collateral.decimals }}
							openOracleHref={openOracleHref}
						/>
					)}
					{page?.tab === 'fork' && shown?.forkTime === 0n && <UserMessage detail={pageCopy.universeUnforked} />}
					{(page === undefined || (page.tab === 'fork' && (shown?.forkTime ?? 0n) > 0n)) && (
						<SecurityPoolSharedFork
							redesigned={page !== undefined}
							forkQuestion={forkQuestion}
							onBranchCommitted={onBranchCommitted}
							snapshot={model.snapshot}
							actions={actions}
							bidder={parameters.accountAddress}
							openUniverse={universeId => {
								model.setUniverseInput(universeId.toString())
								onSelectUniverse?.(universeId)
							}}
							openVault={(vault, universeId) => {
								model.setOwnerInput(vault)
								model.setUniverseInput(universeId.toString())
							}}
						/>
					)}
				</TransactionScopeProvider>
			)}
		</div>
	)
}
