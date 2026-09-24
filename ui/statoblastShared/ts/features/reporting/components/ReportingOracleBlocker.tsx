import { useEffect, useRef, useState } from 'preact/hooks'
import * as copy from '../../../copy/reporting.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { formatDuration, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { getOpenOracleSettleAvailability } from '../../open-oracle/lib/openOracle.js'
import type { OracleManagerDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import type { OpenOracleSectionProps } from '../../oracleTypes.js'

export function ReportingOracleBlocker({
	blocked,
	manager,
	now,
	onRequest,
	requestReason,
	onRefresh,
	oracle,
	onViewReport,
}: {
	blocked: boolean
	manager: OracleManagerDetails | undefined
	now: bigint | undefined
	onRequest: () => void
	requestReason: string | undefined
	onRefresh: () => void
	oracle: OpenOracleSectionProps | undefined
	onViewReport: (id: bigint) => void
}) {
	const [reportId, setReportId] = useState<bigint>()
	const [updated, setUpdated] = useState(false)
	const wasBlocked = useRef(blocked)
	const refreshedBoundary = useRef<string>()
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
	const report = oracle !== undefined && oracle.openOracleReportDetails?.reportId === reportId ? oracle.openOracleReportDetails : undefined
	const availability = report === undefined ? undefined : getOpenOracleSettleAvailability({ ...report, currentTime: now ?? report.currentTime })
	const pending = oracle?.openOracleActiveAction === 'settle'
	let status = copy.priceRequested(remaining === undefined ? commonCopy.metricUnavailablePlaceholder : formatDuration(remaining))
	if (ready) status = copy.priceReportReady(pendingId)
	if (pendingId === 0n) status = copy.priceExpired

	return (
		<>
			{blocked ? (
				<WarningSurface ariaLive='polite' role='status' surface='flat' variant='compact'>
					<p>{status}</p>
					{pendingId === 0n ? <TransactionActionButton idleLabel={copy.requestNewPrice} pendingLabel={copy.requestNewPrice} onClick={onRequest} availability={{ disabled: requestReason !== undefined, reason: requestReason }} /> : undefined}
					{pendingId > 0n && ready ? (
						<button
							className='primary'
							type='button'
							onClick={() => {
								if (oracle === undefined) {
									onViewReport(pendingId)
									return
								}
								setReportId(pendingId)
								oracle.onOpenOracleFormChange({ reportId: pendingId.toString() })
								oracle.onLoadOracleReport(pendingId.toString())
							}}
						>
							{commonCopy.launchAction(copy.settlePriceReport(pendingId))}
						</button>
					) : undefined}
				</WarningSurface>
			) : undefined}
			{!blocked && updated && manager?.priceValidUntilTimestamp !== undefined ? (
				<p className='notice success' role='status'>
					{copy.priceUpdated(formatTimestamp(manager.priceValidUntilTimestamp))}
				</p>
			) : undefined}
			<OperationModal isOpen={reportId !== undefined} title={copy.settlePriceReport(reportId ?? 0n)} onClose={() => setReportId(undefined)} closeOnSuccessKey={oracle?.openOracleResult?.action === 'settle' ? oracle.openOracleResult.hash : undefined}>
				<ErrorNotice message={oracle?.openOracleError} />
				<div className='actions'>
					<TransactionActionButton
						idleLabel={copy.settlePriceReport(reportId ?? 0n)}
						pendingLabel={copy.settlingPriceReport(reportId ?? 0n)}
						pending={pending}
						onClick={() => oracle?.onSettleReport()}
						availability={{ disabled: availability?.canAct !== true, reason: availability?.message ?? (report === undefined ? copy.loadingEscalation : undefined) }}
					/>
					<button type='button' className='secondary' disabled={pending} onClick={() => setReportId(undefined)}>
						{commonCopy.cancel}
					</button>
				</div>
			</OperationModal>
		</>
	)
}
