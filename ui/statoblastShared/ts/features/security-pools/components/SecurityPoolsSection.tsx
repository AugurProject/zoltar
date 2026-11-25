import type { MarketDetails, ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import * as pageCopy from '../../../copy/securityPoolPage.js'
import { useStatoblastPageRefresh, useStatoblastRefreshError, type RegisterStatoblastPageRefresh, type ReportStatoblastReadStatus } from '../../useStatoblastPageRefresh.js'
import { SecurityPoolQuestionsPanel } from './SecurityPoolQuestionsPanel.js'
import { StatoblastPoolHead } from './StatoblastPoolHead.js'
import { statoblastPageHref, type StatoblastPoolPage } from '../../../lib/routing.js'
import { buildRouteHref, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { useSecurityPoolPriceDeadline } from '../hooks/useSecurityPoolPriceDeadline.js'
import { useSecurityPoolPriceFunds } from '../hooks/useSecurityPoolPriceFunds.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { useCallback, useEffect, useId, useRef } from 'preact/hooks'
import { isAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { TransactionScopeProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { useSecurityPool } from '../hooks/useSecurityPool.js'
import { useSecurityPoolActions } from '../hooks/useSecurityPoolActions.js'
import { useSecurityPoolAggregate } from '../hooks/useSecurityPoolAggregate.js'
import { useSecurityPoolPurchase } from '../hooks/useSecurityPoolPurchase.js'
import { SecurityPoolTakeover } from './SecurityPoolTakeover.js'
import { SecurityPoolAggregatePanel } from './SecurityPoolAggregatePanel.js'
import { SecurityPoolSharedFork, type ForkQuestionRead } from './SecurityPoolSharedFork.js'
import { SecurityPoolPurchasePanel } from './SecurityPoolPurchasePanel.js'
import { SecurityPoolPriceReport } from './SecurityPoolPriceReport.js'
import { accountPriceTarget } from '../hooks/useSecurityPoolPrice.js'
import { SecurityPoolDeployment, SecurityPoolDeploymentForm } from './SecurityPoolDeployment.js'
import { SecurityPoolButton, SecurityPoolInput } from './SecurityPoolControls.js'
import * as copy from '../../../copy/securityPool.js'
import * as capitalCopy from '../../../copy/securityPoolCapital.js'

/** `walletConnected` reports a wallet on any network; `parameters.accountAddress` is set only on the app's network. */
export function SecurityPoolsSection({
	parameters,
	walletConnected,
	walletAddress,
	enabled,
	environmentKey,
	activeUniverseId,
	cacheReads = false,
	page,
	deploying = false,
	forkQuestion,
	forkQuestionRead,
	forkChildren,
	forkRecapitalizationDeadline,
	onBranchCommitted,
	onSelectUniverse,
	openOracleHref,
	registerPageRefresh,
	onReadStatus,
	autoRefresh,
}: {
	registerPageRefresh?: RegisterStatoblastPageRefresh | undefined
	onReadStatus?: ReportStatoblastReadStatus | undefined
	autoRefresh?: boolean | undefined
	cacheReads?: boolean
	forkQuestion?: MarketDetails | undefined
	forkQuestionRead?: ForkQuestionRead | undefined
	forkChildren?: readonly ZoltarChildUniverseSummary[] | undefined
	forkRecapitalizationDeadline?: bigint | undefined
	onBranchCommitted?: ((committed: boolean) => void) | undefined
	onSelectUniverse?: ((id: bigint) => void) | undefined
	openOracleHref?: string | undefined
	page?: StatoblastPoolPage | undefined
	deploying?: boolean
	parameters: WriteOperationsParameters
	walletConnected: boolean
	walletAddress?: Address | undefined
	enabled: boolean
	environmentKey: number
	activeUniverseId: bigint
}) {
	const readingWallet = page === undefined ? parameters.accountAddress : (walletAddress ?? parameters.accountAddress)
	const model = useSecurityPool({ accountAddress: readingWallet, enabled, environmentKey, activeUniverseId, cacheReads: cacheReads && !deploying, resumeSetup: deploying, securityPoolAddress: page?.pool })
	const refreshError = useStatoblastRefreshError(model.error, model.displayedAt)
	useStatoblastPageRefresh(registerPageRefresh, model.refresh)
	useEffect(() => {
		if (page?.tab !== 'price') onReadStatus?.(model.displayedAt, undefined)
	}, [model.displayedAt, onReadStatus, page?.tab])
	const reportPriceReadStatus = useCallback<ReportStatoblastReadStatus>((readAt, progress) => onReadStatus?.(readAt ?? model.displayedAt, progress), [model.displayedAt, onReadStatus])
	const wrongNetwork = walletConnected && parameters.accountAddress === undefined ? getWrongNetworkReason() : undefined
	const actions = useSecurityPoolActions(model, parameters, deploying, wrongNetwork)
	const openChildPosition = (universeId: bigint, owner: Address | undefined) => {
		if (page === undefined) {
			if (owner !== undefined) model.setOwnerInput(owner)
			model.setUniverseInput(universeId.toString())
			onSelectUniverse?.(universeId)
			return
		}
		const { routeHash, search } = parseRouteHash(statoblastPageHref({ kind: 'pool', pool: page.pool, tab: 'capital' }, universeId))
		const query = new URLSearchParams(search)
		if (owner === undefined) query.delete('owner')
		else query.set('owner', owner)
		window.location.hash = buildRouteHref(routeHash, `?${query}`)
	}
	const shownSetupStage = model.setup?.stage ?? model.savedSetupStage
	const setupVerificationReasonId = useId()
	const setupVerificationReason = model.setup === undefined && model.savedSetupStage !== undefined ? actions.preparationReason(1) : undefined
	const priceDeadline = useSecurityPoolPriceDeadline(model.presentationSnapshot, model.displayedAt, model.refresh)
	const capital = useSecurityPoolAggregate(model, actions, parameters.accountAddress, page !== undefined)
	const purchase = useSecurityPoolPurchase(model, actions)
	// Only once the page can read the chain, so a wallet still starting up is not told to connect.
	const ownerMissing = enabled && isAddress(model.managerInput.trim()) && !isAddress(model.ownerInput.trim())
	let ownerMessage: string | undefined
	// Only a visitor with no wallet at all is asked to connect one; a wallet on another network is flagged in the header.
	if (ownerMissing) ownerMessage = walletConnected ? copy.ownerAddressNeeded : copy.ownerNeeded
	const disabled = actions.busy !== undefined
	const shown = model.presentationSnapshot
	const fundedPriceReports = useSecurityPoolPriceFunds(model.snapshot, shown, parameters.accountAddress, enabled && page !== undefined)
	const hasPositionOwner = isAddress(model.ownerInput.trim())
	const connectedPositionOwner = shown?.auctionVault?.bidder ?? model.ownerInput
	let positionMode: 'own' | 'other' | 'none' = 'none'
	if (hasPositionOwner) positionMode = connectedPositionOwner.toLowerCase() === readingWallet?.toLowerCase() ? 'own' : 'other'
	// Once an account has been shown, its price report stays mounted through a failed refresh so typed drafts survive;
	// only opening another security pool, owner or universe replaces it.
	const accountIdentity = `${model.managerInput.trim().toLowerCase()}:${model.ownerInput.trim().toLowerCase()}:${model.universeInput.trim()}`
	const shownAccount = useRef<string>()
	if (model.presentationSnapshot !== undefined) shownAccount.current = accountIdentity

	return (
		<div className='security-pool-flow'>
			{deploying && <SecurityPoolDeployment actions={actions} model={model} />}
			{!deploying && page === undefined && (
				<>
					<RouteHeader title={pageCopy.securityPool} actions={<UpdatedAgo updatedAt={model.displayedAt} refreshing={model.loading} />} />
					<SectionBlock title={copy.setup}>
						<MetricGrid>
							<SecurityPoolInput label={copy.manager} value={model.managerInput} onChange={model.setManagerInput} disabled={disabled} />
							<SecurityPoolInput label={copy.owner} value={model.ownerInput} onChange={model.setOwnerInput} hint={ownerMissing ? undefined : copy.ownerHint} error={ownerMessage} liveError disabled={disabled} />
							<SecurityPoolInput label={copy.universe} value={model.universeInput} onChange={model.setUniverseInput} disabled={disabled} />
						</MetricGrid>
						<details>
							<summary>{copy.deploy}</summary>
							<SecurityPoolDeploymentForm actions={actions} />
						</details>
					</SectionBlock>
				</>
			)}
			{!deploying && page !== undefined && <StatoblastPoolHead page={page} model={model} wallet={readingWallet} priceChecking={priceDeadline.status !== undefined} fundsRemain={(fundedPriceReports?.length ?? 0) > 0} />}
			{!deploying && (page === undefined || (model.setup?.stage !== undefined && model.setup.stage < 4)) && (
				<SectionBlock title={capitalCopy.prepareTitle} description={shownSetupStage === 4 ? undefined : capitalCopy.prepareHint}>
					<UserMessage tone={shownSetupStage === 4 ? 'success' : 'neutral'} detail={shownSetupStage === undefined ? capitalCopy.prepareProgressUnknown : capitalCopy.prepareProgress(shownSetupStage)} />
					{setupVerificationReason === undefined ? undefined : <InlineHint id={setupVerificationReasonId} message={setupVerificationReason} />}
					<ol className='statoblast-fork-steps'>
						{capitalCopy.prepareStages.map((label, index) => (
							<li key={label}>
								<SecurityPoolButton
									model={actions}
									action={`prepareSecurityPool${index + 1}`}
									label={label}
									pendingLabel={capitalCopy.preparing}
									reason={actions.preparationReason(index + 1)}
									sharedReasonId={setupVerificationReason === undefined ? undefined : setupVerificationReasonId}
									onClick={() => actions.prepare(index + 1)}
								/>
								<span>{(shownSetupStage ?? 0) > index ? pageCopy.stepDone : pageCopy.sharedSetupStep}</span>
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
					detail={refreshError}
				/>
			)}
			{actions.error === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={actions.error} />}
			{actions.feedback === undefined ? undefined : <UserMessage placement='section' tone='success' announcement='polite' detail={actions.feedback} />}
			{!deploying && (
				<TransactionScopeProvider scope={actions.scope}>
					{(page === undefined || page.tab === 'capital') && (
						<SecurityPoolAggregatePanel
							redesigned={page !== undefined}
							positionMode={positionMode}
							model={capital}
							priceDeadlineChecking={priceDeadline.status !== undefined}
							actions={actions}
							priceReport={page === undefined && shownAccount.current === accountIdentity ? unfolded => <SecurityPoolPriceReport scope='universe' target={unfolded ? accountPriceTarget(model.snapshot) : undefined} actions={actions} bidder={parameters.accountAddress} /> : undefined}
						/>
					)}
					{(page === undefined || (page.tab === 'liquidations' && (shown?.forkTime ?? 0n) === 0n)) && (
						<SecurityPoolTakeover key={page?.positionId?.toString()} positionId={page?.positionId} wallet={parameters.accountAddress} model={model} actions={actions} redesigned={page !== undefined} autoRefresh={autoRefresh ?? false} />
					)}
					{page === undefined && <SecurityPoolPurchasePanel model={model} purchase={purchase} actions={actions} />}
					{page?.tab === 'questions' && (
						<SecurityPoolQuestionsPanel
							pool={page.pool}
							universeId={activeUniverseId}
							actions={actions}
							admission={shown?.admission}
							forked={(shown?.forkTime ?? 0n) > 0n}
							owner={parameters.accountAddress}
							enabled={enabled}
							environmentKey={environmentKey}
							registerPageRefresh={registerPageRefresh}
							paging={model.loading}
							onPreviousApprovedPage={() => void model.previousApprovedQuestionPage()}
							onNextApprovedPage={() => void model.nextApprovedQuestionPage()}
						/>
					)}
					{page?.tab === 'price' && (
						<SecurityPoolPriceReport
							redesigned
							scope='universe'
							target={hasPositionOwner ? accountPriceTarget(model.snapshot) : undefined}
							displayTarget={hasPositionOwner ? accountPriceTarget(shown) : undefined}
							actions={actions}
							bidder={parameters.accountAddress}
							returnFundsOnly={(shown?.forkTime ?? 0n) > 0n}
							defaultReportId={fundedPriceReports?.[0]}
							priceWindowChecking={priceDeadline.status !== undefined}
							autoRefresh={autoRefresh ?? false}
							registerPageRefresh={registerPageRefresh}
							onReadStatus={reportPriceReadStatus}
							priceBand={
								shown === undefined || shown.acceptedPrice === 0n
									? undefined
									: { accepted: shown.acceptedPrice, health: shown.conservativePrice, liquidation: shown.liquidationPrice, validUntil: shown.priceValidUntil, timestamp: shown.timestamp, decimals: shown.collateral.decimals, symbol: shown.collateral.symbol, readAt: model.displayedAt }
							}
							openOracleHref={openOracleHref}
						/>
					)}
					{page?.tab === 'fork' && shown?.forkTime === 0n && <UserMessage detail={pageCopy.universeUnforked} />}
					{page?.tab === 'fork' && (shown?.forkTime ?? 0n) > 0n && !hasPositionOwner && <UserMessage detail={pageCopy.connectToSeePosition} />}
					{(page === undefined || (page.tab === 'fork' && (shown?.forkTime ?? 0n) > 0n)) && (
						<SecurityPoolSharedFork
							redesigned={page !== undefined}
							forkQuestion={forkQuestion}
							forkQuestionRead={forkQuestionRead}
							childUniverses={forkChildren}
							forkRecapitalizationDeadline={forkRecapitalizationDeadline}
							autoRefresh={autoRefresh}
							registerPageRefresh={registerPageRefresh}
							onBranchCommitted={onBranchCommitted}
							snapshot={model.snapshot}
							presentationSnapshot={shown}
							actions={actions}
							bidder={parameters.accountAddress}
							openUniverse={universeId => openChildPosition(universeId, hasPositionOwner ? shown?.owner : undefined)}
							openVault={(vault, universeId) => openChildPosition(universeId, vault)}
						/>
					)}
				</TransactionScopeProvider>
			)}
		</div>
	)
}
