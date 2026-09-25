import { scanBlockTimeMs, startScanReport } from '@zoltar/core-shared/monitoring/scanStatus'
import type { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'

export function runningStatus(paused: boolean, execute: boolean): 'dry-run' | 'paused' | 'running' {
	if (paused) return 'paused'
	return execute ? 'running' : 'dry-run'
}

export function cycleFailureMessage(disposition: ReturnType<typeof operationalFailureDisposition>, execute: boolean) {
	if (disposition === 'connectivity-degraded') return 'RPC connectivity degraded; execution remains blocked until recovery'
	return execute ? 'Live execution paused after a safety fault' : 'Scan cycle failed'
}

export function createLiquidatorScanReport(network: { chainId: number; name: string }, readHead: () => Promise<bigint>) {
	return startScanReport({ network, blockTimeMs: scanBlockTimeMs(network.chainId, process.env['SCAN_BLOCK_TIME_MS']), readHead })
}
