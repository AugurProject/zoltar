import { useEffect, useRef } from 'preact/hooks'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'

/** A new URL selection is loaded by route synchronization; refreshing the same report keeps its history entry. */
export function selectOpenOracleReport({ reportId, selectedReportId, selectionVisible = true, onSelectReport, onRefreshReport }: { reportId: string; selectedReportId: string; selectionVisible?: boolean; onSelectReport: (reportId: string) => void; onRefreshReport: (reportId: string) => void }) {
	const parsedReportId = tryParseBigIntInput(reportId)
	const sameSelection = reportId.trim() === selectedReportId.trim() || (parsedReportId !== undefined && parsedReportId === tryParseBigIntInput(selectedReportId))
	if (!selectionVisible || !sameSelection) {
		onSelectReport(reportId.trim())
		return
	}
	onRefreshReport(reportId)
}

type OpenOracleRouteSyncOptions = {
	activeEnvironmentNonce: number
	environmentReady: boolean
	isOpenOracleRoute: boolean
	loadOracleReport: (reportId: string) => Promise<void>
	reportId: string
	setOpenOracleFormReportId: (reportId: string) => void
}

function shouldLoadOpenOracleReportFromUrl({ environmentReady, isOpenOracleRoute, reportId }: Pick<OpenOracleRouteSyncOptions, 'environmentReady' | 'isOpenOracleRoute' | 'reportId'>) {
	return environmentReady && isOpenOracleRoute && reportId !== ''
}

export function useOpenOracleRouteSync({ activeEnvironmentNonce, environmentReady, isOpenOracleRoute, loadOracleReport, reportId, setOpenOracleFormReportId }: OpenOracleRouteSyncOptions) {
	const loadOracleReportRef = useRef(loadOracleReport)
	const lastRequestedReportId = useRef<string | undefined>(undefined)
	const lastSyncedReportId = useRef<string | undefined>(undefined)
	loadOracleReportRef.current = loadOracleReport

	useEffect(() => {
		if (!isOpenOracleRoute) {
			lastSyncedReportId.current = undefined
			return
		}
		const normalizedReportId = reportId.trim()
		if (lastSyncedReportId.current === normalizedReportId) return
		lastSyncedReportId.current = normalizedReportId
		setOpenOracleFormReportId(normalizedReportId)
	}, [isOpenOracleRoute, reportId, setOpenOracleFormReportId])

	useEffect(() => {
		if (!shouldLoadOpenOracleReportFromUrl({ environmentReady, isOpenOracleRoute, reportId })) {
			lastRequestedReportId.current = undefined
			return
		}
		const requestKey = `${activeEnvironmentNonce}:${reportId}`
		if (lastRequestedReportId.current === requestKey) return
		lastRequestedReportId.current = requestKey
		void loadOracleReportRef.current(reportId)
	}, [activeEnvironmentNonce, environmentReady, isOpenOracleRoute, reportId])
}
