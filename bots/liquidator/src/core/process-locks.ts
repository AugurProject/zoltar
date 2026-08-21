import { getAddress, privateKeyToAccount, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { acquireExecutionSignerLock, acquireFileProcessLock, type ExclusiveProcessLock } from '@zoltar/bot-shared/execution/process-lock'

export type LiquidatorLockSettings = {
	chainId: number
	execute: boolean
	privateKey: Hex | undefined
	stateFile: string
}

export type LiquidatorProcessLockAcquirers = {
	acquireSigner: (chainId: number, address: Address) => Promise<ExclusiveProcessLock>
	acquireState: (stateFile: string) => Promise<ExclusiveProcessLock>
}

const defaultLockAcquirers: LiquidatorProcessLockAcquirers = {
	acquireSigner: acquireExecutionSignerLock,
	acquireState: stateFile => acquireFileProcessLock(stateFile, 'Liquidator state'),
}

export class LiquidatorProcessLockAcquisitionError extends Error {
	readonly acquisitionCause: unknown
	readonly releaseProcessLocks: () => Promise<void>

	constructor(acquisitionCause: unknown, releaseProcessLocks: () => Promise<void>) {
		super(acquisitionCause instanceof Error ? acquisitionCause.message : String(acquisitionCause), { cause: acquisitionCause })
		this.name = 'LiquidatorProcessLockAcquisitionError'
		this.acquisitionCause = acquisitionCause
		this.releaseProcessLocks = releaseProcessLocks
	}
}

export async function acquireLiquidatorProcessLocks(settings: LiquidatorLockSettings, acquirers: LiquidatorProcessLockAcquirers = defaultLockAcquirers) {
	const stateLock = await acquirers.acquireState(settings.stateFile)
	let signerLock: ExclusiveProcessLock | undefined
	let signerAddress: Address | undefined
	try {
		if (settings.execute) {
			if (settings.privateKey === undefined) throw new Error('Live execution requires privateKey')
			signerAddress = privateKeyToAccount(settings.privateKey).address
			signerLock = await acquirers.acquireSigner(settings.chainId, signerAddress)
		}
	} catch (error) {
		try {
			await stateLock.release()
		} catch (cleanupError) {
			throw new LiquidatorProcessLockAcquisitionError(error, async () => {
				try {
					await stateLock.release()
				} catch (retryError) {
					throw new AggregateError([cleanupError, retryError], `Failed to release the partially acquired liquidator state lock ${stateLock.path}`)
				}
			})
		}
		throw error
	}
	let released = false
	let releaseAttempt: Promise<void> | undefined
	const retiredSignerLocks = new Map<string, ExclusiveProcessLock>()
	const signerKey = (address: Address) => getAddress(address).toLowerCase()
	const releaseRetiredSignerLocks = async () => {
		for (const [key, lock] of retiredSignerLocks) {
			await lock.release()
			retiredSignerLocks.delete(key)
		}
	}
	return {
		acquireSigner: async (address: Address | undefined) => {
			if (!settings.execute || address === undefined || (signerAddress !== undefined && address.toLowerCase() === signerAddress.toLowerCase())) return undefined
			const key = signerKey(address)
			const retained = retiredSignerLocks.get(key)
			if (retained !== undefined) {
				retiredSignerLocks.delete(key)
				return retained
			}
			return acquirers.acquireSigner(settings.chainId, getAddress(address))
		},
		commitSigner: async (address: Address | undefined, nextLock: ExclusiveProcessLock | undefined) => {
			if (!settings.execute) return
			const unchanged = address !== undefined && signerAddress !== undefined && address.toLowerCase() === signerAddress.toLowerCase()
			if (unchanged) {
				if (nextLock !== undefined) throw new Error('Unchanged liquidator signer unexpectedly acquired another lock')
				await releaseRetiredSignerLocks()
				return
			}
			if (address !== undefined && nextLock === undefined) throw new Error('Changed liquidator signer is missing its exclusive lock')
			const previousLock = signerLock
			const previousAddress = signerAddress
			signerAddress = address
			signerLock = nextLock
			if (previousLock !== undefined && previousAddress !== undefined) retiredSignerLocks.set(signerKey(previousAddress), previousLock)
			await releaseRetiredSignerLocks()
		},
		discardSigner: async (address: Address | undefined, lock: ExclusiveProcessLock | undefined) => {
			if (lock === undefined) return
			if (address === undefined) throw new Error('Cannot discard a liquidator signer lock without its address')
			retiredSignerLocks.set(signerKey(address), lock)
			await releaseRetiredSignerLocks()
		},
		release: () => {
			if (released) return Promise.resolve()
			if (releaseAttempt !== undefined) return releaseAttempt
			releaseAttempt = (async () => {
				const errors: unknown[] = []
				try {
					await signerLock?.release()
				} catch (error) {
					errors.push(error)
				}
				for (const [key, lock] of retiredSignerLocks) {
					try {
						await lock.release()
						retiredSignerLocks.delete(key)
					} catch (error) {
						errors.push(error)
					}
				}
				try {
					await stateLock.release()
				} catch (error) {
					errors.push(error)
				}
				if (errors.length !== 0) throw new AggregateError(errors, 'Failed to release all liquidator process locks')
				released = true
			})().finally(() => {
				if (!released) releaseAttempt = undefined
			})
			return releaseAttempt
		},
	}
}

export type LiquidatorProcessLocks = Awaited<ReturnType<typeof acquireLiquidatorProcessLocks>>

export type LiquidatorShutdownController = ReturnType<typeof createLiquidatorShutdownController>

export async function acquireLiquidatorProcessLocksForShutdown(settings: LiquidatorLockSettings, shutdown: Pick<LiquidatorShutdownController, 'isRequested'>, acquire: typeof acquireLiquidatorProcessLocks = acquireLiquidatorProcessLocks) {
	const locks = await acquire(settings)
	if (!shutdown.isRequested()) return locks
	await locks.release()
	return undefined
}

export function liquidatorDashboardLifecycle(dashboard: { stop: (closeActiveConnections?: boolean) => Promise<void> }) {
	return { [Symbol.asyncDispose]: () => dashboard.stop() }
}

export function createLiquidatorShutdownController() {
	let requested = false
	let disposed = false
	const waiters = new Set<() => void>()
	const requestShutdown = () => {
		requested = true
		for (const finish of [...waiters]) finish()
	}
	process.on('SIGINT', requestShutdown)
	process.on('SIGTERM', requestShutdown)
	return {
		[Symbol.dispose]: () => {
			if (disposed) return
			disposed = true
			process.off('SIGINT', requestShutdown)
			process.off('SIGTERM', requestShutdown)
			for (const finish of [...waiters]) finish()
		},
		isRequested: () => requested,
		wait: (milliseconds: number) => {
			if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('Shutdown wait must be a non-negative integer')
			if (requested) return Promise.resolve()
			return new Promise<void>(resolve => {
				let timer: ReturnType<typeof setTimeout>
				const finish = () => {
					clearTimeout(timer)
					waiters.delete(finish)
					resolve()
				}
				timer = setTimeout(finish, milliseconds)
				waiters.add(finish)
			})
		},
	}
}
