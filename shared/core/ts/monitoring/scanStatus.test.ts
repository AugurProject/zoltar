import { expect, test } from 'bun:test'
import { scanBlockTimeMs, startScanReport } from './scanStatus.js'

const network = { chainId: 11_155_111, name: 'sepolia' }
const now = new Date('2026-09-25T06:34:48.000Z')

async function completedLine(network: Parameters<typeof startScanReport>[0]['network'], sample: Parameters<ReturnType<typeof startScanReport>['update']>[0], elapsedMs: number, blockTimeMs: number | undefined, timestamp: Date) {
	let clock = 0
	let output: string | undefined
	const report = startScanReport({
		network,
		blockTimeMs,
		clock: () => clock,
		wallClock: () => timestamp,
		write: line => {
			output = line
		},
	})
	report.update(sample)
	clock = elapsedMs
	await report.finish()
	if (output === undefined) throw new Error('Scan did not emit a summary')
	return output
}

test('formats UTC completion time, network, block and empty scan counters on one line', async () => {
	expect(await completedLine(network, { block: 11_777_444n, observedHead: 11_777_444n, status: 'live', details: { activeReports: 0, opportunities: 0, skipped: 0 } }, 23, 12_000, now)).toBe(
		'2026-09-25 06:34:48 Sepolia 11777444: ProcessedMs=23 activeReports=0 opportunities=0 skipped=0 status=live lagging=false blocksBehind=0 blockTimeMs=12000',
	)
})

test('detects slow processing independently from a block backlog and preserves explicit states', async () => {
	const sample = { block: 100n, observedHead: 100n, status: 'live' } satisfies Parameters<typeof completedLine>[1]
	expect(await completedLine(network, sample, 12_000, 12_000, now)).toContain('status=live lagging=false')
	expect(await completedLine(network, sample, 12_001, 12_000, now)).toContain('status=lagging lagging=true reason=slow-processing blocksBehind=0')
	expect(await completedLine(network, { ...sample, observedHead: 103n }, 23, 12_000, now)).toContain('reason=behind-head blocksBehind=3')
	for (const status of ['paused', 'failed', 'incomplete', 'waiting', 'backfilling'] as const) {
		expect(await completedLine(network, { ...sample, status }, 15_000, 12_000, now)).toContain(`status=${status} lagging=true`)
	}
	expect(await completedLine(network, { ...sample, observedHead: 99n }, 23, 12_000, now)).toContain('blocksBehind=0')
})

test('compares batch throughput with the number of covered blocks, including empty blocks', async () => {
	const sample = { block: 199n, fromBlock: 100n, observedHead: 1_000n, status: 'backfilling' } satisfies Parameters<typeof completedLine>[1]
	expect(await completedLine(network, sample, 1_200_000, 12_000, now)).toContain('reason=behind-head')
	expect(await completedLine(network, sample, 1_200_001, 12_000, now)).toContain('status=backfilling lagging=true reason=slow-processing')
})

test('does not invent a block interval or height for custom networks and sanitizes console fields', async () => {
	expect(scanBlockTimeMs(1)).toBe(12_000)
	expect(scanBlockTimeMs(network.chainId)).toBe(12_000)
	expect(scanBlockTimeMs(31337)).toBeUndefined()
	expect(scanBlockTimeMs(31337, '2000')).toBe(2_000)
	for (const invalid of ['0', '-1', '', 'x', '1.5', 'Infinity']) expect(() => scanBlockTimeMs(31337, invalid)).toThrow('SCAN_BLOCK_TIME_MS')
	const line = await completedLine({ chainId: 31337, name: 'Local\nchain\u001b' }, { status: 'failed', details: { reasonDetail: 'line\r\nbreak' } }, 50_000, undefined, now)
	expect(line).toContain('Local chain  unknown: ProcessedMs=50000')
	expect(line).toContain('blocksBehind=unknown blockTimeMs=unknown')
	expect(line).not.toContain('\n')
	expect(line).not.toContain('slow-processing')
})

test('finishes once using monotonic elapsed time and a fresh head, without timing the diagnostic read', async () => {
	let clock = 100
	const lines: string[] = []
	const report = startScanReport({
		network,
		blockTimeMs: 12_000,
		clock: () => clock,
		wallClock: () => now,
		write: line => lines.push(line),
		readHead: async () => {
			clock = 99_999
			return 103n
		},
	})
	report.update({ block: 100n, status: 'live', details: { opportunities: 0 } })
	clock = 123
	await report.finish()
	await report.finish()
	expect(lines).toHaveLength(1)
	expect(lines[0]).toContain('ProcessedMs=23 opportunities=0 status=lagging lagging=true reason=behind-head blocksBehind=3')
})

test('failed and timed out diagnostic reads do not fail processing or reuse stale head evidence', async () => {
	for (const readHead of [
		async () => {
			throw new Error('RPC unavailable')
		},
		() => new Promise<bigint>(() => {}),
	]) {
		const lines: string[] = []
		const report = startScanReport({ network, blockTimeMs: 12_000, readHead, headTimeoutMs: 5, write: line => lines.push(line) })
		report.update({ block: 100n, observedHead: 100n, status: 'live' })
		await report.finish()
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain('lagging=unknown blocksBehind=unknown')
	}
})

test('warns during a stalled cycle and stops warning on failed completion', async () => {
	let clock = 0
	const warnings: string[] = []
	const lines: string[] = []
	const warned = Promise.withResolvers<void>()
	const report = startScanReport({
		network,
		blockTimeMs: 12_000,
		clock: () => clock,
		warningIntervalMs: 5,
		write: line => lines.push(line),
		warn: line => {
			warnings.push(line)
			warned.resolve()
		},
	})
	try {
		report.update({ block: 100n })
		clock = 15_000
		await warned.promise
		expect(warnings[0]).toContain('status=processing lagging=true reason=slow-processing')
		await report.finish('failed')
		const count = warnings.length
		await Bun.sleep(20)
		expect(warnings).toHaveLength(count)
		expect(lines[0]).toContain('status=failed')
	} finally {
		await report.finish()
	}
})
