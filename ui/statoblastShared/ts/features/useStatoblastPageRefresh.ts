import { useEffect, useRef } from 'preact/hooks'

export type RegisterStatoblastPageRefresh = (refresh: () => Promise<unknown>) => () => void

export function useStatoblastPageRefresh(register: RegisterStatoblastPageRefresh | undefined, refresh: () => Promise<unknown>) {
	const latest = useRef(refresh)
	latest.current = refresh
	useEffect(() => register?.(() => latest.current()), [register])
}

export type ReportStatoblastReadStatus = (readAt: number | undefined, progress: string | undefined) => void
