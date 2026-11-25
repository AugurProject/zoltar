import { useEffect, useRef, useState } from 'preact/hooks'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { deadlineRetryDelays } from '../../../lib/deadlineRefresh.js'

const maxTimerDelay = 2_147_483_647

export function useSecurityPoolPriceDeadline(snapshot: SecurityPoolAccountSnapshot | undefined, displayedAt: number | undefined, refresh: () => Promise<void>) {
	const [state, setState] = useState<{ identity: string; status: 'checking' | 'failed' }>()
	const [retry, setRetry] = useState(0)
	const visible = usePageVisible()
	const deadline = snapshot?.priceValid === true ? snapshot.priceValidUntil : undefined
	const identity = deadline === undefined || snapshot === undefined ? undefined : `${snapshot.chainId}:${snapshot.securityPool}:${snapshot.universeId}:${deadline}`
	const current = useRef({ displayedAt, refresh, timestamp: snapshot?.timestamp, identity })
	current.current = { displayedAt, refresh, timestamp: snapshot?.timestamp, identity }
	useEffect(() => {
		if (!visible || deadline === undefined || identity === undefined) return
		let timer: ReturnType<typeof setTimeout> | undefined
		let cancelled = false
		let attempt = 0
		const active = () => !cancelled && current.current.identity === identity && !document.hidden
		const refreshDeadline = () => {
			if (!active()) return
			const delay = deadlineRetryDelays[attempt++]
			if (delay === undefined) {
				setState({ identity, status: 'failed' })
				return
			}
			setState({ identity, status: 'checking' })
			timer = setTimeout(() => {
				if (!active()) return
				void current.current
					.refresh()
					.catch(() => undefined)
					.finally(refreshDeadline)
			}, delay)
		}
		const waitForDeadline = () => {
			const { displayedAt: readAt, timestamp } = current.current
			if (!active() || readAt === undefined || timestamp === undefined) return
			const remaining = Number(deadline - timestamp) * 1000 - Math.max(0, Date.now() - readAt)
			if (remaining <= 0) refreshDeadline()
			else timer = setTimeout(waitForDeadline, Math.min(remaining, maxTimerDelay))
		}
		waitForDeadline()
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [deadline, identity, visible, retry])
	return {
		status: state?.identity === identity ? state?.status : undefined,
		retry: () => setRetry(value => value + 1),
	}
}
