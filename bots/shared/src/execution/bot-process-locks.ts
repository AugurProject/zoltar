import { getAddress, privateKeyToAccount, type Address, type Hex } from '../ethereum.ts'
import { acquireExecutionSignerLock, acquireFileProcessLock, type ExclusiveProcessLock } from './process-lock.ts'

export type BotLockSettings = {
	chainId: number
	execute: boolean
	privateKey: Hex | undefined
	signerLockRoot?: string | undefined
	stateFile: string
}

export type BotProcessLockAcquirers = {
	acquireSigner: (chainId: number, address: Address, lockRoot?: string | undefined) => Promise<ExclusiveProcessLock>
	acquireState: (stateFile: string) => Promise<ExclusiveProcessLock>
}

/**
 * How a bot names itself in lock messages and whether dry-run processes should hold signer locks at all. The chaos bot signs
 * nothing in dry-run mode but still reserves the configured signer so a second process cannot take it over; the liquidator
 * only reserves signers while live execution is enabled.
 */
export type BotProcessLockOptions = {
	readonly acquirers?: BotProcessLockAcquirers
	readonly label: string
	readonly signerLocksInDryRun: boolean
}

const defaultLockAcquirers = (label: string): BotProcessLockAcquirers => ({
	acquireSigner: acquireExecutionSignerLock,
	acquireState: stateFile => acquireFileProcessLock(stateFile, `${label} state`),
})

export class BotProcessLockAcquisitionError extends Error {
	readonly acquisitionCause: unknown
	readonly releaseProcessLocks: () => Promise<void>

	constructor(acquisitionCause: unknown, releaseProcessLocks: () => Promise<void>) {
		super(acquisitionCause instanceof Error ? acquisitionCause.message : String(acquisitionCause), { cause: acquisitionCause })
		this.name = 'BotProcessLockAcquisitionError'
		this.acquisitionCause = acquisitionCause
		this.releaseProcessLocks = releaseProcessLocks
	}
}

export async function acquireBotProcessLocks(settings: BotLockSettings, { acquirers: configuredAcquirers, label, signerLocksInDryRun }: BotProcessLockOptions) {
	const acquirers = configuredAcquirers ?? defaultLockAcquirers(label)
	if (!Number.isSafeInteger(settings.chainId) || settings.chainId < 1) throw new Error(`${label} lock chain ID must be a positive integer`)
	const stateLock = await acquirers.acquireState(settings.stateFile)
	let signerLock: ExclusiveProcessLock | undefined
	let signerAddress: Address | undefined
	try {
		if (settings.execute) {
			if (settings.privateKey === undefined) throw new Error('Live execution requires privateKey')
			signerAddress = privateKeyToAccount(settings.privateKey).address
			signerLock = await acquirers.acquireSigner(settings.chainId, signerAddress, settings.signerLockRoot)
		}
	} catch (error) {
		try {
			await stateLock.release()
		} catch (cleanupError) {
			throw new BotProcessLockAcquisitionError(error, async () => {
				try {
					await stateLock.release()
				} catch (retryError) {
					throw new AggregateError([cleanupError, retryError], `Failed to release the partially acquired ${label} state lock ${stateLock.path}`)
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
			if ((!signerLocksInDryRun && !settings.execute) || address === undefined || (signerAddress !== undefined && address.toLowerCase() === signerAddress.toLowerCase())) return undefined
			const key = signerKey(address)
			const retained = retiredSignerLocks.get(key)
			if (retained !== undefined) {
				retiredSignerLocks.delete(key)
				return retained
			}
			return acquirers.acquireSigner(settings.chainId, getAddress(address), settings.signerLockRoot)
		},
		commitSigner: async (address: Address | undefined, nextLock: ExclusiveProcessLock | undefined) => {
			if (!signerLocksInDryRun && !settings.execute) return
			const unchanged = address !== undefined && signerAddress !== undefined && address.toLowerCase() === signerAddress.toLowerCase()
			if (unchanged) {
				if (nextLock !== undefined) throw new Error(`Unchanged ${label} signer unexpectedly acquired another lock`)
				await releaseRetiredSignerLocks()
				return
			}
			if (address !== undefined && nextLock === undefined) throw new Error(`Changed ${label} signer is missing its exclusive lock`)
			const previousLock = signerLock
			const previousAddress = signerAddress
			signerAddress = address
			signerLock = nextLock
			if (previousLock !== undefined && previousAddress !== undefined) retiredSignerLocks.set(signerKey(previousAddress), previousLock)
			await releaseRetiredSignerLocks()
		},
		discardSigner: async (address: Address | undefined, lock: ExclusiveProcessLock | undefined) => {
			if (lock === undefined) return
			if (address === undefined) throw new Error(`Cannot discard a ${label} signer lock without its address`)
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
				if (errors.length !== 0) throw new AggregateError(errors, `Failed to release all ${label} process locks`)
				released = true
			})().finally(() => {
				if (!released) releaseAttempt = undefined
			})
			return releaseAttempt
		},
	}
}

export type BotProcessLocks = Awaited<ReturnType<typeof acquireBotProcessLocks>>

export type BotShutdownController = ReturnType<typeof createBotShutdownController>

export async function acquireBotProcessLocksForShutdown(settings: BotLockSettings, options: BotProcessLockOptions, shutdown: Pick<BotShutdownController, 'isRequested'>, acquire: typeof acquireBotProcessLocks = acquireBotProcessLocks) {
	const locks = await acquire(settings, options)
	if (!shutdown.isRequested()) return locks
	await locks.release()
	return undefined
}

export function botDashboardLifecycle(dashboard: { stop: (closeActiveConnections?: boolean) => Promise<void> }) {
	return { [Symbol.asyncDispose]: () => dashboard.stop() }
}

export function createBotShutdownController() {
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
		requestShutdown,
		wake: () => {
			for (const finish of [...waiters]) finish()
		},
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
