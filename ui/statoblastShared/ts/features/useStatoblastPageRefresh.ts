import { formatOldDataCheck } from '@zoltar/ui-core-shared/copy/transaction.js'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
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

const OLD_ACTION_DATA_MILLISECONDS = 60_000

export function useOldActionDataNotice(readAt: number | undefined) {
	const visible = usePageVisible()
	const [tick, setTick] = useState(0)
	const age = readAt === undefined ? 0 : Date.now() - readAt
	useEffect(() => {
		if (readAt === undefined || !visible) return
		const untilOld = OLD_ACTION_DATA_MILLISECONDS + 1 - Math.max(0, Date.now() - readAt)
		const delay = untilOld > 0 ? untilOld : 1_000
		const timer = setTimeout(() => setTick(value => value + 1), delay)
		return () => clearTimeout(timer)
	}, [readAt, tick, visible])
	return age > OLD_ACTION_DATA_MILLISECONDS ? formatOldDataCheck(formatDuration(BigInt(Math.floor(age / 1_000)))) : undefined
}
