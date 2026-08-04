import { getAddress, type Address } from '#ethereum'
import type { ExclusiveProcessLock } from '#state/position-store'

export type ExecutionLockManager = {
	acquireSigner: (account: Address) => Promise<ExclusiveProcessLock>
	release: (lock: ExclusiveProcessLock) => Promise<void>
}

export function createExecutionLockManager(acquireSignerLock: (account: Address) => Promise<ExclusiveProcessLock>) {
	const heldLocks = new Set<ExclusiveProcessLock>()
	const signerLocks = new Map<string, ExclusiveProcessLock>()
	const hold = async (lockPromise: Promise<ExclusiveProcessLock>) => {
		const lock = await lockPromise
		heldLocks.add(lock)
		return lock
	}
	const release = async (lock: ExclusiveProcessLock) => {
		if (!heldLocks.has(lock)) return
		await lock.release()
		heldLocks.delete(lock)
		for (const [key, signerLock] of signerLocks) {
			if (signerLock === lock) signerLocks.delete(key)
		}
	}
	return {
		acquireSigner: async (account: Address) => {
			const key = getAddress(account).toLowerCase()
			const retained = signerLocks.get(key)
			if (retained !== undefined) return retained
			const lock = await hold(acquireSignerLock(getAddress(account)))
			signerLocks.set(key, lock)
			return lock
		},
		hold,
		release,
		releaseAll: async () => {
			const errors: unknown[] = []
			for (const lock of [...heldLocks].reverse()) {
				try {
					await release(lock)
				} catch (error) {
					errors.push(error)
				}
			}
			if (errors.length !== 0) throw new AggregateError(errors, 'Failed to release all arbitrager process locks')
		},
	} satisfies ExecutionLockManager & {
		hold: (lockPromise: Promise<ExclusiveProcessLock>) => Promise<ExclusiveProcessLock>
		releaseAll: () => Promise<void>
	}
}

export async function persistSignerSettingsWithProvisionalLock(persist: () => Promise<void>, provisionalLock: ExclusiveProcessLock | undefined, lockManager: ExecutionLockManager | undefined) {
	try {
		await persist()
	} catch (error) {
		if (provisionalLock !== undefined && lockManager !== undefined) {
			try {
				await lockManager.release(provisionalLock)
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], 'Signer settings update failed and its provisional lock could not be released')
			}
		}
		throw error
	}
}
