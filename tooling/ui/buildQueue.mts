/** Coalesces changed inputs and runs builds in dependency order, with one process at a time. */
export function createBuildQueue<Job extends string>({ priority, run, isStopped, onIdle }: { priority: readonly Job[]; run: (job: Job, reason: string) => Promise<boolean>; isStopped: () => boolean; onIdle: (reason: string) => void }) {
	const pending = new Map<Job, string>()
	let running: Promise<void> | undefined

	const drain = async () => {
		try {
			do {
				let lastReason: string | undefined
				while (pending.size > 0 && !isStopped()) {
					const job = priority.find(candidate => pending.has(candidate))
					if (job === undefined) throw new Error('No build priority configured for a pending job')
					const reason = pending.get(job)
					if (reason === undefined) throw new Error(`Build ${job} lost its changed input`)
					pending.delete(job)
					if (!(await run(job, reason))) return
					lastReason = reason
				}
				if (lastReason !== undefined && !isStopped()) onIdle(lastReason)
			} while (pending.size > 0 && !isStopped())
		} finally {
			pending.clear()
			running = undefined
		}
	}

	return {
		enqueue: (job: Job, reason: string): Promise<void> => {
			if (isStopped()) return Promise.resolve()
			if (!priority.includes(job)) return Promise.reject(new Error(`No build priority configured for ${job}`))
			pending.set(job, reason)
			running ??= Promise.resolve().then(drain)
			return running
		},
	}
}
