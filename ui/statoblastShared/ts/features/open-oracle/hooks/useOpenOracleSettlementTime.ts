import { useEffect, useRef, useState } from 'preact/hooks'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'

export function useOpenOracleSettlementTime(report: OpenOracleReportDetails | undefined, loading: boolean, onLoadReport: (reportId?: string) => void) {
	const reportKey = report === undefined ? undefined : `${report.reportId}:${report.reportTimestamp}:${report.settlementTime}:${report.currentTime}:${report.isDistributed}`
	const [clock, setClock] = useState<{ key: string | undefined; elapsedSeconds: bigint }>({ key: undefined, elapsedSeconds: 0n })
	const refresh = useRef({ loading, onLoadReport })
	const lastRefresh = useRef<{ key: string; at: number } | undefined>(undefined)
	// The clock counts from when this report was read, so pausing it in a hidden tab loses no elapsed time.
	const startedAt = useRef<{ key: string | undefined; at: number }>({ key: undefined, at: Date.now() })
	if (startedAt.current.key !== reportKey) startedAt.current = { key: reportKey, at: Date.now() }
	const visible = usePageVisible()
	refresh.current = { loading, onLoadReport }
	useEffect(() => {
		if (report === undefined || !report.timeType || (report.isDistributed && report.coordinatorPriceValidUntilTimestamp === undefined) || report.reportTimestamp === 0n || !visible) return
		const readyAt = report.reportTimestamp + report.settlementTime
		const refreshKey = `${report.reportId}:${report.reportTimestamp}:${report.settlementTime}`
		const tick = () => {
			const now = Date.now()
			const elapsedSeconds = BigInt(Math.floor((now - startedAt.current.at) / 1000))
			setClock(current => (current.key === reportKey && current.elapsedSeconds === elapsedSeconds ? current : { key: reportKey, elapsedSeconds }))
			if (report.isDistributed || report.currentTime + elapsedSeconds < readyAt || refresh.current.loading) return
			if (lastRefresh.current?.key === refreshKey) return
			lastRefresh.current = { key: refreshKey, at: now }
			refresh.current.onLoadReport(report.reportId.toString())
		}
		const interval = setInterval(tick, 250)
		return () => clearInterval(interval)
	}, [reportKey, report?.timeType, report?.coordinatorPriceValidUntilTimestamp, visible])
	return report !== undefined && report.timeType ? report.currentTime + (clock.key === reportKey ? clock.elapsedSeconds : 0n) : report?.currentTime
}
