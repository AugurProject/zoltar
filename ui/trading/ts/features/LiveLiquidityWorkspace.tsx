import { GlobalTransactionDialog } from '@zoltar/ui-core-shared/app/components/GlobalTransactionDialog.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { OpenOraclePriceValue } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/OpenOraclePriceValue.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { useTransactionTrayController } from '@zoltar/ui-core-shared/app/hooks/useTransactionTrayController.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { RequestPriceModal } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/RequestPriceModal.js'
import { defaultUsePriceOracleManagerDependencies, usePriceOracleManager } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/usePriceOracleManager.js'
import type { RequestPriceReview } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolOracleSections.js'
import { addOpenOracleBountyBuffer } from '@zoltar/ui-statoblast-shared/protocol/openOracleMath.js'
import { loadTradingPoolOracle } from '../protocol/poolOracle.js'
import { publicErrorMessage } from '../protocol/publicError.js'
import { LiveLiquidityControls } from './LiveLiquidityControls.js'
import * as copy from '../copy/oracle.js'

type Props = Parameters<typeof LiveLiquidityControls>[0]

/** Remount on pool or chain changes so an old oracle answer can never unlock another pool. */
export function LiveLiquidityWorkspace(props: Props & { loadOracle?: typeof loadTradingPoolOracle }) {
	return <PoolLiquidityWorkspace key={`${props.configuration.chainId}:${props.market.pool}`} {...props} />
}

function PoolLiquidityWorkspace({ loadOracle = loadTradingPoolOracle, ...props }: Props & { loadOracle?: typeof loadTradingPoolOracle }) {
	const [oracle, setOracle] = useState<Awaited<ReturnType<typeof loadTradingPoolOracle>>>()
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string>()
	const [review, setReview] = useState<RequestPriceReview>()
	const lastRefresh = useRef(props.nowSeconds)
	const request = useRef(0)
	const current = useRef(props)
	current.current = props
	const tray = useTransactionTrayController()
	const refreshOracle = useCallback(async () => {
		const id = ++request.current
		setLoading(true)
		setError(undefined)
		try {
			const value = await withReadTimeout(loadOracle(props.market.pool))
			if (request.current === id) setOracle(value)
		} catch (caught) {
			if (request.current === id) setError(publicErrorMessage(caught, copy.failed))
		} finally {
			if (request.current === id) {
				lastRefresh.current = current.current.nowSeconds
				setLoading(false)
			}
		}
	}, [loadOracle, props.market.pool])
	useEffect(() => {
		void refreshOracle()
		return () => {
			request.current += 1
		}
	}, [refreshOracle])
	// Discovery supplies chain time; polling notices reports requested or settled by another wallet.
	useEffect(() => {
		if (loading || props.nowSeconds < lastRefresh.current + 15n) return
		lastRefresh.current = props.nowSeconds
		void refreshOracle()
	}, [loading, props.nowSeconds, refreshOracle])
	const manager = usePriceOracleManager(
		{
			...tray,
			accountAddress: props.account,
			refreshState: async () => {
				await refreshOracle()
				current.current.onKnownReceipt()
			},
		},
		{
			...defaultUsePriceOracleManagerDependencies,
			createWalletWriteClient: (account, callbacks) =>
				createReviewedClient(
					createWalletWriteClient(account, callbacks),
					async () => {
						await current.current.executeWithCurrentWalletContext(account, 'Switch back to the pool’s network before requesting a price.', 'Reconnect the wallet before requesting a price.', async () => undefined)
					},
					callbacks?.reviewSignal,
				),
		},
	)
	const pending = manager.poolOracleActiveAction !== undefined
	const details = oracle?.details
	const fresh = details?.isPriceValid === true && details.priceValidUntilTimestamp !== undefined && props.nowSeconds < details.priceValidUntilTimestamp
	const reportPending = (details?.pendingReportId ?? 0n) > 0n
	const blocker = (() => {
		if (error !== undefined) return copy.unavailable
		if (oracle === undefined) return copy.loading
		if (fresh) return undefined
		return reportPending ? copy.pending : copy.stale
	})()
	const requestBlocker = (() => {
		if (props.networkMismatchReason !== undefined) return props.networkMismatchReason
		if (props.account === undefined || props.walletClient === undefined) return copy.connect
		if (props.externallyLocked) return copy.locked
		if (error !== undefined) return copy.unavailable
		if (oracle === undefined) return copy.loading
		if (fresh) return copy.alreadyFresh
		if (reportPending) return copy.pendingRequest
		return undefined
	})()
	const identity = `${props.account ?? ''}:${props.configuration.chainId}`
	useEffect(() => {
		setReview(undefined)
	}, [identity])
	return (
		<>
			<WorkflowSubsection
				title={copy.heading}
				badge={
					details === undefined ? undefined : (
						<OpenOraclePriceValue currentTimestamp={props.nowSeconds} lastPrice={details.lastPrice} lastSettlementTimestamp={details.lastSettlementTimestamp} pendingReportReadyAtTimestamp={details.pendingReportReadyAtTimestamp} priceValidUntilTimestamp={details.priceValidUntilTimestamp} />
					)
				}
			>
				{oracle === undefined && error === undefined ? <StateHint announcement='polite' presentation={{ key: 'loading', detail: copy.loading, detailIsLoading: true }} /> : null}
				<ErrorNotice message={error} />
				<ErrorNotice message={manager.poolOracleManagerError} />
				<div className='actions'>
					<TransactionActionButton
						idleLabel={copy.request}
						pendingLabel={copy.requesting}
						pending={pending}
						tone='secondary'
						availability={{ disabled: requestBlocker !== undefined, reason: requestBlocker }}
						onClick={() => {
							if (oracle === undefined || requestBlocker !== undefined) return
							setReview({ managerAddress: oracle.managerAddress, securityPoolAddress: props.market.pool, universeId: props.market.universeId, requestValueAttoEth: addOpenOracleBountyBuffer(oracle.details.requestPriceCostAttoEth) })
						}}
					/>
					<TransactionActionButton idleLabel={copy.refresh} pendingLabel={copy.refreshing} pending={loading} tone='secondary' availability={{ disabled: pending, reason: pending ? copy.locked : undefined }} onClick={() => void refreshOracle()} />
				</div>
			</WorkflowSubsection>
			<GlobalTransactionPresentationProvider transaction={tray.transactionState.value.active}>
				<RequestPriceModal
					review={review}
					pending={pending}
					canRequest={requestBlocker === undefined}
					confirmationGuardMessage={requestBlocker}
					closeOnSuccessKey={manager.poolPriceOracleResult?.hash}
					onClose={() => setReview(undefined)}
					onConfirm={async (confirmed, signal) => {
						const account = current.current.account
						if (account === undefined || confirmed.managerAddress !== oracle?.managerAddress) return
						await current.current.executeWithCurrentWalletContext(account, 'Switch back to the pool’s network before requesting a price.', 'Reconnect the wallet before requesting a price.', async () => {
							await manager.requestPoolPrice(confirmed.managerAddress, confirmed.securityPoolAddress, confirmed.requestValueAttoEth, confirmed.universeId, confirmed.proposedRepPerEthPrice, signal)
						})
					}}
				/>
				<GlobalTransactionDialog activeUniverseId={props.market.universeId} routeKey={props.market.pool} transaction={tray.transactionState.value.active} />
			</GlobalTransactionPresentationProvider>
			<LiveLiquidityControls {...props} externallyLocked={props.externallyLocked || pending} oracleBlocker={blocker} />
		</>
	)
}
