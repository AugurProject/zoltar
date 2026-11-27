import type { MarketDetails, ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import * as pageCopy from '../../../copy/securityPoolPage.js'
import { useStatoblastPageRefresh, useStatoblastRefreshError, type RegisterStatoblastPageRefresh, type ReportStatoblastReadStatus } from '../../useStatoblastPageRefresh.js'
import { SecurityPoolQuestionsPanel } from './SecurityPoolQuestionsPanel.js'
import { StatoblastPoolHead } from './StatoblastPoolHead.js'
import { statoblastPageHref, type StatoblastPoolPage } from '../../../lib/routing.js'
import { buildRouteHref, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { useSecurityPoolPriceDeadline } from '../hooks/useSecurityPoolPriceDeadline.js'
import { useSecurityPoolPriceFunds } from '../hooks/useSecurityPoolPriceFunds.js'
import { useCallback, useEffect, useId, useRef } from 'preact/hooks'
import { isAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { SkeletonList } from '@zoltar/ui-core-shared/components/Skeleton.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { TransactionScopeProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { useSecurityPool } from '../hooks/useSecurityPool.js'
import { useSecurityPoolActions } from '../hooks/useSecurityPoolActions.js'
import { useSecurityPoolAggregate } from '../hooks/useSecurityPoolAggregate.js'
import { SecurityPoolTakeover } from './SecurityPoolTakeover.js'
import { SecurityPoolAggregatePanel } from './SecurityPoolAggregatePanel.js'
import { SecurityPoolSharedFork, type ForkQuestionRead } from './SecurityPoolSharedFork.js'
import { SecurityPoolPriceReport } from './SecurityPoolPriceReport.js'
import { accountPriceTarget } from '../hooks/useSecurityPoolPrice.js'
import { SecurityPoolDeployment } from './SecurityPoolDeployment.js'
import { SecurityPoolButton } from './SecurityPoolControls.js'
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
	const readingWallet = walletAddress ?? parameters.accountAddress
	const model = useSecurityPool({ accountAddress: readingWallet, enabled, environmentKey, activeUniverseId, cacheReads: cacheReads && !deploying, resumeSetup: deploying, securityPoolAddress: page?.pool })
	const refreshError = useStatoblastRefreshError(model.error, model.displayedAt)
	useEffect(() => {
		if (page?.tab !== 'price') onReadStatus?.(model.displayedAt, undefined)
	}, [model.displayedAt, onReadStatus, page?.tab])
	const reportPriceReadStatus = useCallback<ReportStatoblastReadStatus>((readAt, progress) => onReadStatus?.(readAt ?? model.displayedAt, progress), [model.displayedAt, onReadStatus])
	const wrongNetwork = walletConnected && parameters.accountAddress === undefined ? getWrongNetworkReason() : undefined
	const actions = useSecurityPoolActions(model, parameters, deploying, wrongNetwork)
	const refreshPage = deploying ? actions.refreshDeploymentProgress : model.refresh
	useStatoblastPageRefresh(registerPageRefresh, refreshPage)
	const openChildPosition = (pool: Address, universeId: bigint, owner: Address | undefined) => {
		const { routeHash, search } = parseRouteHash(statoblastPageHref({ kind: 'pool', pool, tab: 'capital' }, universeId))
		const query = new URLSearchParams(search)
		if (owner === undefined) query.delete('owner')
		else query.set('owner', owner)
		window.location.hash = buildRouteHref(routeHash, `?${query}`)
	}
	const shownSetupStage = model.setup?.stage ?? model.savedSetupStage
	const preparingPool = useRef<Address>()
	if (page !== undefined && shownSetupStage !== undefined && shownSetupStage < 4) preparingPool.current = page.pool
	const setupVerificationReasonId = useId()
	const setupVerificationReason = model.setup === undefined && model.savedSetupStage !== undefined ? actions.preparationReason(1) : undefined
	const priceDeadline = useSecurityPoolPriceDeadline(model.presentationSnapshot, model.displayedAt, model.refresh)
	const capital = useSecurityPoolAggregate(model, actions, parameters.accountAddress)
	const shown = model.presentationSnapshot
	const fundedPriceReports = useSecurityPoolPriceFunds(model.snapshot, shown, enabled && page !== undefined, readingWallet)
	const hasPositionOwner = isAddress(model.ownerInput.trim())
	const connectedPositionOwner = model.ownerInput
	let positionMode: 'own' | 'other' | 'none' = 'none'
	if (hasPositionOwner) positionMode = connectedPositionOwner.toLowerCase() === readingWallet?.toLowerCase() ? 'own' : 'other'
	const initialPoolLoading = model.loading && shown === undefined && shownSetupStage === undefined

	return (
		<div className='security-pool-flow'>
			{deploying && <SecurityPoolDeployment actions={actions} model={model} />}
			{!deploying && page !== undefined && <StatoblastPoolHead page={page} model={model} wallet={readingWallet} priceChecking={priceDeadline.status !== undefined} fundsRemain={(fundedPriceReports?.length ?? 0) > 0} />}
			{!deploying && page !== undefined && shownSetupStage !== undefined && (shownSetupStage < 4 || preparingPool.current === page.pool) && (
				<SectionBlock title={capitalCopy.prepareTitle} description={shownSetupStage === 4 ? undefined : capitalCopy.prepareHint}>
					<UserMessage tone={shownSetupStage === 4 ? 'success' : 'neutral'} detail={capitalCopy.prepareProgress(shownSetupStage)} />
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
								<span>{shownSetupStage > index ? pageCopy.stepDone : pageCopy.sharedSetupStep}</span>
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
						<button className='secondary' type='button' onClick={() => void refreshPage()}>
							{pageCopy.tryAgain}
						</button>
					}
					detail={refreshError}
				/>
			)}
			{actions.error === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={actions.error} />}
			{actions.feedback === undefined ? undefined : <UserMessage placement='section' tone='success' announcement='polite' detail={actions.feedback} />}
			{!deploying && page !== undefined && initialPoolLoading && <SkeletonList label={copy.loading} />}
			{!deploying && page !== undefined && !initialPoolLoading && (
				<TransactionScopeProvider scope={actions.scope}>
					{page.tab === 'capital' && <SecurityPoolAggregatePanel positionMode={positionMode} model={capital} priceDeadlineChecking={priceDeadline.status !== undefined} actions={actions} />}
					{page.tab === 'liquidations' &&
						((shown?.forkTime ?? 0n) > 0n ? (
							<SectionBlock title={pageCopy.poolTabLabels.liquidations}>
								<UserMessage detail={pageCopy.liquidationsUnavailableAfterFork} />
							</SectionBlock>
						) : (
							<SecurityPoolTakeover key={page.positionId?.toString()} positionId={page.positionId} wallet={parameters.accountAddress} model={model} actions={actions} autoRefresh={autoRefresh ?? false} />
						))}
					{page.tab === 'questions' && (
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
					{page.tab === 'price' && (
						<SecurityPoolPriceReport
							scope='universe'
							target={hasPositionOwner ? accountPriceTarget(model.snapshot) : undefined}
							displayTarget={hasPositionOwner ? accountPriceTarget(shown) : undefined}
							actions={actions}
							bidder={parameters.accountAddress}
							returnFundsOnly={(shown?.forkTime ?? 0n) > 0n}
							defaultReportId={fundedPriceReports?.find(report => sameAddress(report.funder, parameters.accountAddress))?.reportId ?? fundedPriceReports?.[0]?.reportId}
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
					{page.tab === 'fork' && shown?.forkTime === 0n && <UserMessage detail={pageCopy.universeUnforked} />}
					{page.tab === 'fork' && (shown?.forkTime ?? 0n) > 0n && !hasPositionOwner && <UserMessage detail={pageCopy.connectToSeePosition} />}
					{page.tab === 'fork' && (shown?.forkTime ?? 0n) > 0n && (
						<SecurityPoolSharedFork
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
							openUniverse={universeId => openChildPosition(page.pool, universeId, hasPositionOwner ? shown?.owner : undefined)}
						/>
					)}
				</TransactionScopeProvider>
			)}
		</div>
	)
}
