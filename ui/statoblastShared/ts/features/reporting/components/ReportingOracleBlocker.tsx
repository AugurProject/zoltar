import { useEffect, useRef, useState } from 'preact/hooks'
import * as copy from '../../../copy/reporting.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { formatDuration, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { getOpenOracleSettleAvailability } from '../../open-oracle/lib/openOracle.js'
import type { OracleManagerDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import type { OpenOracleSectionProps } from '../../oracleTypes.js'
import type { WalletActionBlocker } from '@zoltar/ui-core-shared/types/components.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { getWalletActiveAppChainGuardState, withWalletGuardFirst, withWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'

export function ReportingOracleBlocker({
	blocked,
	manager,
	now,
	onRequest,
	requestReason,
	requestWalletBlocker,
	onRefresh,
	oracle,
	onViewReport,
}: {
	blocked: boolean
	manager: OracleManagerDetails | undefined
	now: bigint | undefined
	onRequest: () => void
	requestReason: string | undefined
	/** The wallet prerequisite, when it is the request's disabled reason. */
	requestWalletBlocker?: WalletActionBlocker | undefined
	onRefresh: () => void
	oracle: Pick<OpenOracleSectionProps, 'accountState' | 'openOracleForm' | 'openOracleReportDetails' | 'openOracleActiveAction' | 'onOpenOracleFormChange' | 'onLoadOracleReport' | 'onSettleReport' | 'openOracleError'> | undefined
	onViewReport: (id: bigint) => void
}) {
	const [updated, setUpdated] = useState(false)
	const wasBlocked = useRef(blocked)
	const refreshedBoundary = useRef<string>()
	const preparedReport = useRef<bigint>()
	const pendingId = manager?.pendingReportId ?? 0n
	const readyAt = manager?.pendingReportReadyAtTimestamp
	const remaining = readyAt === undefined || now === undefined ? undefined : readyAt - now
	const ready = remaining !== undefined && remaining <= 0n
	useEffect(() => {
		if (wasBlocked.current && !blocked && now !== undefined && (manager?.priceValidUntilTimestamp ?? 0n) > now) setUpdated(true)
		wasBlocked.current = blocked
	}, [blocked, manager?.priceValidUntilTimestamp, now])
	useEffect(() => {
		if (!updated) return
		const timer = setTimeout(() => setUpdated(false), 15000)
		return () => clearTimeout(timer)
	}, [updated])
	useEffect(() => {
		if (!blocked || pendingId === 0n || !ready) return
		const key = `${pendingId}:${readyAt}`
		if (refreshedBoundary.current === key) return
		refreshedBoundary.current = key
		onRefresh()
	}, [blocked, pendingId, readyAt, ready, onRefresh])
	useEffect(() => {
		if (!blocked || pendingId === 0n || !ready || oracle === undefined) {
			preparedReport.current = undefined
			return
		}
		if (preparedReport.current === pendingId) return
		preparedReport.current = pendingId
		oracle.onOpenOracleFormChange({ reportId: pendingId.toString() })
		oracle.onLoadOracleReport(pendingId.toString())
	}, [blocked, pendingId, ready, oracle?.onOpenOracleFormChange, oracle?.onLoadOracleReport])
	const report = oracle !== undefined && oracle.openOracleReportDetails?.reportId === pendingId && oracle.openOracleForm.reportId === pendingId.toString() ? oracle.openOracleReportDetails : undefined
	const availability = report === undefined ? undefined : getOpenOracleSettleAvailability({ ...report, currentTime: now ?? report.currentTime })
	const wallet = oracle === undefined ? undefined : getWalletActiveAppChainGuardState({ accountAddress: oracle.accountState.address, isOnActiveAppChain: isActiveAppChain(oracle.accountState.chainId) })
	const pending = oracle?.openOracleActiveAction === 'settle'
	let status = copy.priceRequested(remaining === undefined ? commonCopy.metricUnavailablePlaceholder : formatDuration(remaining))
	if (ready) status = copy.priceReportReady(pendingId)
	if (pendingId === 0n) status = copy.priceExpired

	return (
		<>
			{blocked ? (
				<WarningSurface ariaLive='polite' role='status' surface='flat' variant='compact'>
					<p>{status}</p>
					{pendingId === 0n ? (
						<TransactionActionButton idleLabel={commonCopy.launchAction(securityPoolCopy.requestNewPrice)} pendingLabel={securityPoolCopy.requestingNewPrice} onClick={onRequest} availability={withWalletBlocker({ disabled: requestReason !== undefined, reason: requestReason }, requestWalletBlocker)} />
					) : undefined}
					{pendingId > 0n && ready ? (
						<TransactionActionButton
							idleLabel={copy.settlePriceReport(pendingId)}
							pendingLabel={copy.settlingPriceReport(pendingId)}
							pending={pending}
							onClick={() => (oracle === undefined ? onViewReport(pendingId) : oracle.onSettleReport())}
							availability={withWalletGuardFirst(
								{ disabled: oracle !== undefined && availability?.canAct !== true, reason: oracle === undefined ? undefined : (availability?.message ?? (report === undefined ? copy.loadingEscalation : undefined)) },
								wallet ?? { blocked: false, reason: undefined, walletBlocker: undefined },
							)}
						/>
					) : undefined}
				</WarningSurface>
			) : undefined}
			{!blocked && updated && manager?.priceValidUntilTimestamp !== undefined ? (
				<p className='notice success' role='status'>
					{copy.priceUpdated(formatTimestamp(manager.priceValidUntilTimestamp))}
				</p>
			) : undefined}
			<ErrorNotice message={oracle?.openOracleError} />
			{blocked && ready && report === undefined && oracle?.openOracleError !== undefined ? (
				<button type='button' className='secondary' onClick={() => oracle.onLoadOracleReport(pendingId.toString())}>
					{commonCopy.retry}
				</button>
			) : undefined}
		</>
	)
}
