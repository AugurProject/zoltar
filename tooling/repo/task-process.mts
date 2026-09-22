import path from 'node:path'
import { repositoryRoot as defaultRepositoryRoot } from './root.mts'

export type TaskProcessOptions = {
	readonly command: readonly string[]
	readonly cwd: string
	/** Retry the command when it fails with a registry or network connection error; leave genuine findings alone. */
	readonly retryTransientNetworkErrors?: boolean
	readonly attempts?: number
	readonly retryDelayMs?: number
	readonly repositoryRoot?: string
}

/** Failure output that a dependency registry or network hiccup produces, as opposed to a real audit or task failure. */
export const transientNetworkErrorPattern = /ConnectionClosed|ConnectionRefused|ConnectionReset|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|FailedToOpenSocket|Unable to connect|network error/i

async function forward(stream: ReadableStream<Uint8Array>, target: NodeJS.WritableStream, collected: string[]) {
	const decoder = new TextDecoder()
	const reader = stream.getReader()
	while (true) {
		const { done, value } = await reader.read()
		if (done) return
		target.write(value)
		collected.push(decoder.decode(value, { stream: true }))
	}
}

/** Run a task process with inherited output; return its exit code, retrying only transient network failures when asked. */
export async function runTaskProcess({ command, cwd, retryTransientNetworkErrors = false, attempts = 3, retryDelayMs = 2_000, repositoryRoot = defaultRepositoryRoot }: TaskProcessOptions): Promise<number> {
	const resolvedCwd = path.join(repositoryRoot, cwd)
	if (!retryTransientNetworkErrors) {
		const child = Bun.spawn({ cmd: [...command], cwd: resolvedCwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
		return await child.exited
	}
	for (let attempt = 1; ; attempt += 1) {
		const child = Bun.spawn({ cmd: [...command], cwd: resolvedCwd, stdin: 'inherit', stdout: 'pipe', stderr: 'pipe' })
		const stdout: string[] = []
		const stderr: string[] = []
		await Promise.all([forward(child.stdout, process.stdout, stdout), forward(child.stderr, process.stderr, stderr)])
		const exitCode = await child.exited
		// Only the tool's own error output decides; a vulnerability report on stdout may legitimately mention network errors.
		if (exitCode === 0 || attempt >= attempts || !transientNetworkErrorPattern.test(stderr.join(''))) return exitCode
		console.log(`${command.join(' ')} hit a transient network error; retrying (${attempt + 1}/${attempts})`)
		await Bun.sleep(retryDelayMs * attempt)
	}
}
