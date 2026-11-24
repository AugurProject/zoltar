import { useEffect, useMemo, useRef } from 'preact/hooks'
import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatSavedReadFailure } from '../copy/statoblastShell.js'

export type RegisterStatoblastPageRefresh = (refresh: () => Promise<unknown>) => () => void

export function useStatoblastPageRefresh(register: RegisterStatoblastPageRefresh | undefined, refresh: () => Promise<unknown>) {
	const latest = useRef(refresh)
	latest.current = refresh
	useEffect(() => register?.(() => latest.current()), [register])
}

export type ReportStatoblastReadStatus = (readAt: number | undefined, progress: string | undefined) => void

export function useStatoblastRefreshError(reason: string | undefined, displayedAt: number | undefined) {
	// Keep the failure announcement stable while the header continues to tick.
	return useMemo(() => {
		if (reason === undefined || displayedAt === undefined) return reason
		const seconds = BigInt(Math.max(0, Math.floor((Date.now() - displayedAt) / 1000)))
		return formatSavedReadFailure(formatDuration(seconds), reason)
	}, [displayedAt, reason])
}
