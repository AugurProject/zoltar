import type { Configuration } from '#config/configuration'
import { errorMessage } from '#core/rpc-validation'
import { recordOperation, type OperatorState } from '#state/operator-state'
import { observeCentralizedMarkets } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { createHeadWatcher, type HeadWatcher, type ObservedHead } from '@zoltar/bot-shared/monitoring/head-watcher'

/** How often the head watcher polls `eth_blockNumber`; well under one slot so every block is observed promptly. */
const HEAD_WATCH_INTERVAL_MILLISECONDS = 1_000

type HeadReader = {
	getBlock(parameters: { blockNumber: bigint }): Promise<{ hash?: `0x${string}` | null | undefined; number?: bigint | null | undefined; timestamp: bigint }>
	getBlockNumber(): Promise<bigint>
}

/**
 * Follows the chain head independently of the scan so every block is logged as soon as it exists and the
 * scan loop can be woken immediately instead of waiting for its poll interval.
 */
export function createOperatorHeadWatcher(parameters: { config: Pick<Configuration, 'networkConfigured'>; intervalMilliseconds?: number | undefined; isStopping: () => boolean; readClient: () => HeadReader }) {
	let lastFailure: string | undefined
	return createHeadWatcher({
		intervalMilliseconds: parameters.intervalMilliseconds ?? HEAD_WATCH_INTERVAL_MILLISECONDS,
		isStopping: parameters.isStopping,
		onError: error => {
			const message = errorMessage(error)
			if (message === lastFailure) return
			lastFailure = message
			console.error(`headWatchFailed=${message}`)
		},
		onHead: (head, previous) => {
			lastFailure = undefined
			const skipped = previous === undefined ? 0n : head.number - previous.number - 1n
			console.log(`observedBlock=${head.number.toString()} blockAgeSeconds=${(BigInt(Math.floor(Date.now() / 1_000)) - head.timestamp).toString()}${skipped > 0n ? ` unobservedBlocks=${skipped.toString()}` : ''}`)
		},
		readBlock: async blockNumber => {
			const value = await parameters.readClient().getBlock({ blockNumber })
			if (value.hash == null || value.number == null) throw new Error('Observed head is missing its hash or number')
			return { hash: value.hash, number: value.number, timestamp: value.timestamp }
		},
		readBlockNumber: () => (parameters.config.networkConfigured ? parameters.readClient().getBlockNumber() : Promise.resolve(undefined)),
	})
}

/**
 * Chooses the head the next scan wake should be measured against. The scan uses the lowest head every
 * quorum reader agrees on; when the watcher is already past it, waking for that watcher head would only
 * re-scan a block the lagging readers cannot serve yet, so the wait is measured from the watcher's view.
 */
function scanWakeHead(observed: Pick<ObservedHead, 'hash' | 'number'> | undefined, scanned: Pick<ObservedHead, 'hash' | 'number'>) {
	return observed !== undefined && observed.number >= scanned.number ? observed : scanned
}

/**
 * Decides when the scan loop wakes for a new head. The trigger is the head the last scan evaluated, or the
 * head observed when a poll ended before reaching the chain (deferred, unconfigured, paused) so early
 * returns never spin; a failed poll waits out its retry delay without a head wake.
 */
export function createScanWakeGate(watcher: Pick<HeadWatcher, 'latest' | 'waitForNewHead'>) {
	let trigger: Pick<ObservedHead, 'hash' | 'number'> | undefined
	return {
		beginPoll: () => {
			trigger = watcher.latest()
		},
		headScanned: (head: Pick<ObservedHead, 'hash' | 'number'>) => {
			trigger = scanWakeHead(watcher.latest(), head)
		},
		wait: (milliseconds: number, afterFailure: boolean) => (afterFailure ? undefined : watcher.waitForNewHead(trigger, milliseconds)),
	}
}

/**
 * Samples centralized exchanges on their own cadence so slow or rate-limited venues never sit in the
 * per-block scan path; the scan reads the latest estimate and the existing freshness limits reject stale samples.
 */
export function startCentralizedMarketSampler(parameters: {
	config: Pick<Configuration, 'centralizedMarkets' | 'network' | 'networkConfigured' | 'pollMilliseconds'>
	isStopping: () => boolean
	state: OperatorState
	/** Shutdown-aware sleep so a stop request ends the sampling wait immediately. */
	wait?: ((milliseconds: number) => Promise<void>) | undefined
}) {
	const { config, state } = parameters
	let lastFailure: string | undefined
	let interruptWait: (() => void) | undefined
	let markReady: (() => void) | undefined
	const ready = new Promise<void>(resolve => {
		markReady = resolve
	})
	const interruptibleWait = (milliseconds: number) =>
		new Promise<void>(resolve => {
			const timer = setTimeout(() => {
				interruptWait = undefined
				resolve()
			}, milliseconds)
			interruptWait = () => {
				clearTimeout(timer)
				interruptWait = undefined
				resolve()
			}
		})
	const done = (async () => {
		try {
			await sampleLoop()
		} finally {
			// Whatever ends the loop, nothing may keep waiting for a first sample that will never arrive.
			markReady?.()
		}
	})()
	async function sampleLoop() {
		while (!parameters.isStopping()) {
			if (config.networkConfigured) {
				try {
					state.centralizedMarket = await observeCentralizedMarkets(config.centralizedMarkets, config.network.rep, config.network.chain.id)
					lastFailure = undefined
				} catch (error) {
					const message = errorMessage(error)
					if (message !== lastFailure) {
						console.error(`centralizedMarketsFailed=${message}`)
						recordOperation(state, {
							category: 'scan',
							details: undefined,
							level: 'warning',
							message: 'Centralized market sampling failed',
							reason: message,
							reportId: undefined,
						})
					}
					lastFailure = message
				}
				markReady?.()
			}
			if (parameters.isStopping()) break
			await Promise.race([interruptibleWait(config.pollMilliseconds), ...(parameters.wait === undefined ? [] : [parameters.wait(config.pollMilliseconds)])])
		}
	}
	return {
		/** Resolves after the first sample attempt on a configured network, or as soon as the loop stops. */
		ready,
		/** Resolves once the loop has exited; call after `isStopping` reports true. */
		stop: async () => {
			interruptWait?.()
			await done
		},
		/** Ends the current sampling wait so a newly configured network is sampled without waiting a full interval. */
		wake: () => interruptWait?.(),
	}
}
