import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { deadlineRetryDelays } from '../../../lib/deadlineRefresh.js'

type DeadlineCheckParameters = {
	scope: string
	deadline: bigint | undefined
	timestamp: bigint | undefined
	readAt: number | undefined
	reading: boolean
	refresh: () => void
}

/** Waits for a mined block at a visible deadline before presenting a final state. */
export function useSecurityPoolDeadline({ scope, deadline, timestamp, readAt, reading, refresh }: DeadlineCheckParameters) {
	const visible = usePageVisible()
	const [wallTime, setWallTime] = useState(Date.now)
	const identity = deadline === undefined || timestamp === undefined || timestamp >= deadline || readAt === undefined ? undefined : `${scope}:${deadline}`
	useEffect(() => {
		if (!visible || identity === undefined) return
		setWallTime(Date.now())
		const timer = setInterval(() => setWallTime(Date.now()), 1_000)
		return () => clearInterval(timer)
	}, [visible, identity])
	const now = timestamp === undefined ? undefined : timestamp + (readAt === undefined ? 0n : BigInt(Math.floor(Math.max(0, wallTime - readAt) / 1000)))
	const [check, setCheck] = useState<{ identity: string; attempts: number }>()
	const ended = identity !== undefined && (check?.identity === identity || (now !== undefined && deadline !== undefined && now >= deadline)) ? identity : undefined
	const attempts = check?.identity === ended ? (check?.attempts ?? 0) : 0
	const currentRefresh = useRef(refresh)
	currentRefresh.current = refresh
	useEffect(() => {
		const delay = deadlineRetryDelays[attempts]
		if (!visible || ended === undefined || reading || delay === undefined) return
		const timer = setTimeout(() => {
			if (document.hidden) return
			setCheck({ identity: ended, attempts: attempts + 1 })
			currentRefresh.current()
		}, delay)
		return () => clearTimeout(timer)
	}, [visible, ended, reading, attempts])
	return {
		now,
		checking: ended !== undefined,
		failed: ended !== undefined && !reading && attempts >= deadlineRetryDelays.length,
		retry: () => {
			if (ended !== undefined) setCheck({ identity: ended, attempts: 0 })
		},
	}
}
