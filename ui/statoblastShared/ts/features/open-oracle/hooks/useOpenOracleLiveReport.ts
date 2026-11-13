import { useEffect, useRef, useState } from 'preact/hooks'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'
import { getOpenOracleLifecycleBoundaryOffsets, getOpenOracleLiveReportDetails } from '../lib/openOracle.js'

const MAX_TIMEOUT_MS = 2_147_483_647

/** Advances dispute and settlement availability at the report's lifecycle boundaries. */
export function useOpenOracleLiveReport(details: OpenOracleReportDetails | undefined) {
	const clock = useRef({ details, loadedAtMs: Date.now() })
	if (clock.current.details !== details) clock.current = { details, loadedAtMs: Date.now() }
	const [tick, setTick] = useState(0)
	useEffect(() => {
		const { details, loadedAtMs } = clock.current
		if (details === undefined) return
		const now = Date.now()
		const nextBoundaryAtMs = getOpenOracleLifecycleBoundaryOffsets(details)
			.map(offset => loadedAtMs + Number(offset) * 1000)
			.find(boundaryAtMs => boundaryAtMs > now)
		if (nextBoundaryAtMs === undefined) return
		const timeout = setTimeout(() => setTick(value => value + 1), Math.min(nextBoundaryAtMs - now + 50, MAX_TIMEOUT_MS))
		return () => clearTimeout(timeout)
	}, [details, tick])
	return details === undefined ? undefined : getOpenOracleLiveReportDetails(details, BigInt(Math.floor((Date.now() - clock.current.loadedAtMs) / 1000)))
}
