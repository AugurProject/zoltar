type ScanStatus = 'live' | 'backfilling' | 'paused' | 'failed' | 'incomplete' | 'waiting'
type ScanDetails = Readonly<Record<string, string | number | bigint>>
type ScanSample = {
	block?: bigint | undefined
	fromBlock?: bigint | undefined
	observedHead?: bigint | undefined
	status: ScanStatus
	details?: ScanDetails | undefined
}

type ScanNetwork = { chainId: number; name: string }

/** Override is independent of polling cadence. Unknown custom chains have no assumed block interval. */
export function scanBlockTimeMs(chainId: number, override?: string): number | undefined {
	if (override !== undefined) {
		const value = Number(override)
		if (!Number.isSafeInteger(value) || value <= 0) throw new Error('SCAN_BLOCK_TIME_MS must be a positive integer')
		return value
	}
	return chainId === 1 || chainId === 11_155_111 ? 12_000 : undefined
}

const singleLine = (value: string) => value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ')

function formatScanStatus(network: ScanNetwork, sample: ScanSample, elapsedMs: number, blockTimeMs: number | undefined, now = new Date(), processing = false): string {
	let name = singleLine(network.name)
	if (network.chainId === 1) name = 'Mainnet'
	else if (network.chainId === 11_155_111) name = 'Sepolia'
	const duration = Math.max(0, Math.round(elapsedMs))
	const blocks = sample.block !== undefined && sample.fromBlock !== undefined && sample.block >= sample.fromBlock ? sample.block - sample.fromBlock + 1n : 1n
	let behind: bigint | undefined
	if (sample.block !== undefined && sample.observedHead !== undefined) behind = sample.observedHead > sample.block ? sample.observedHead - sample.block : 0n
	const slow = blockTimeMs !== undefined && BigInt(duration) > blocks * BigInt(blockTimeMs)
	const hasBacklog = behind !== undefined && behind > 0n
	let lagging: boolean | 'unknown' = slow || hasBacklog
	if (!lagging && (behind === undefined || blockTimeMs === undefined)) lagging = 'unknown'
	let status: string = sample.status
	if (sample.status === 'live' && lagging === true) status = 'lagging'
	if (processing) status = 'processing'
	let reason: string | undefined
	if (slow) reason = 'slow-processing'
	else if (hasBacklog) reason = 'behind-head'
	const details = Object.entries(sample.details ?? {}).map(([key, value]) => `${key}=${singleLine(String(value))}`)
	return `${now.toISOString().slice(0, 19).replace('T', ' ')} ${name} ${sample.block ?? 'unknown'}: ProcessedMs=${duration}${details.length === 0 ? '' : ` ${details.join(' ')}`} status=${status} lagging=${lagging}${reason === undefined ? '' : ` reason=${reason}`} blocksBehind=${behind ?? 'unknown'} blockTimeMs=${blockTimeMs ?? 'unknown'}`
}

/** One final line on every exit, with rate-limited warnings while the cycle is still occupied. */
export function startScanReport(options: {
	network: ScanNetwork
	blockTimeMs: number | undefined
	readHead?: (() => Promise<bigint | undefined>) | undefined
	clock?: () => number
	wallClock?: () => Date
	write?: (line: string) => void
	warn?: (line: string) => void
	warningIntervalMs?: number
	headTimeoutMs?: number
}) {
	const clock = options.clock ?? (() => performance.now())
	const startedAt = clock()
	const write = options.write ?? (line => console.info(line))
	const warn = options.warn ?? (line => console.warn(line))
	let sample: ScanSample = { status: 'incomplete' }
	let finished = false
	const line = (elapsed: number, processing = false) => formatScanStatus(options.network, sample, elapsed, options.blockTimeMs, options.wallClock?.(), processing)
	const timer = setInterval(() => {
		const elapsed = clock() - startedAt
		const blocks = sample.block !== undefined && sample.fromBlock !== undefined && sample.block >= sample.fromBlock ? sample.block - sample.fromBlock + 1n : 1n
		if (options.blockTimeMs === undefined || elapsed > Number(blocks) * options.blockTimeMs) warn(line(elapsed, true))
	}, options.warningIntervalMs ?? 30_000)
	timer.unref()
	return {
		update(next: Partial<ScanSample>) {
			sample = { ...sample, ...next }
		},
		async finish(status?: ScanStatus) {
			if (finished) return
			finished = true
			clearInterval(timer)
			if (status !== undefined) sample.status = status
			const elapsed = clock() - startedAt
			// Diagnostic head reads must not stall the worker or turn successful processing into a failure.
			if (sample.block !== undefined && options.readHead !== undefined) {
				let timeout: ReturnType<typeof setTimeout> | undefined
				try {
					const head = await Promise.race([
						Promise.resolve().then(options.readHead),
						new Promise<undefined>(resolve => {
							timeout = setTimeout(() => resolve(undefined), options.headTimeoutMs ?? 1_000)
						}),
					])
					sample.observedHead = head
				} catch (error) {
					// Any diagnostic failure is represented as unknown, without replacing the worker result.
					void error
					sample.observedHead = undefined
				} finally {
					clearTimeout(timeout)
				}
			}
			write(line(elapsed))
		},
	}
}
