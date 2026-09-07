import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type BunTestProcessOptions = {
	readonly cmd: readonly string[]
	readonly cwd?: string
	readonly env?: NodeJS.ProcessEnv
	readonly redirectStdio?: boolean
	readonly stderrTargetFd?: number
	readonly stdoutTargetFd?: number
}

type OutputChannel = {
	chunk: Buffer
	fd: number
	offset: number
	targetFd: number
}

function pumpChannel(channel: OutputChannel) {
	for (;;) {
		const bytesRead = readSync(channel.fd, channel.chunk, 0, channel.chunk.length, channel.offset)
		if (bytesRead <= 0) return
		channel.offset += bytesRead

		let bytesWritten = 0
		while (bytesWritten < bytesRead) {
			try {
				bytesWritten += writeSync(channel.targetFd, channel.chunk, bytesWritten, bytesRead - bytesWritten)
			} catch (error) {
				if (error instanceof Error && 'code' in error && error.code === 'EAGAIN') {
					Bun.sleepSync(1)
					continue
				}
				throw error
			}
		}
	}
}

export async function runBunTestProcess({ cmd, cwd = process.cwd(), env = process.env, redirectStdio = process.platform === 'linux', stderrTargetFd = 2, stdoutTargetFd = 1 }: BunTestProcessOptions) {
	if (!redirectStdio) {
		const child = Bun.spawn({ cmd: [...cmd], cwd, env, stderr: 'inherit', stdin: 'inherit', stdout: 'inherit' })
		return await child.exited
	}

	// Bun 1.3.14 isolate workers can abort on Linux when inherited stdout or stderr
	// is a pipe. Give the child regular files and forward their contents instead.
	const outputDirectory = mkdtempSync(join(tmpdir(), 'zoltar-bun-test-stdio-'))
	let stdoutFd: number | undefined
	let stderrFd: number | undefined
	let pumpTimer: ReturnType<typeof setInterval> | undefined

	try {
		stdoutFd = openSync(join(outputDirectory, 'stdout.log'), 'w+')
		stderrFd = openSync(join(outputDirectory, 'stderr.log'), 'w+')
		const stdoutChannel: OutputChannel = { chunk: Buffer.alloc(65_536), fd: stdoutFd, offset: 0, targetFd: stdoutTargetFd }
		const stderrChannel: OutputChannel = { chunk: Buffer.alloc(65_536), fd: stderrFd, offset: 0, targetFd: stderrTargetFd }
		const pump = () => {
			pumpChannel(stdoutChannel)
			pumpChannel(stderrChannel)
		}

		const child = Bun.spawn({ cmd: [...cmd], cwd, env, stderr: stderrFd, stdin: 'inherit', stdout: stdoutFd })
		let pumpError: unknown
		pumpTimer = setInterval(() => {
			try {
				pump()
			} catch (error) {
				pumpError = error
				if (pumpTimer !== undefined) clearInterval(pumpTimer)
			}
		}, 50)

		const exitCode = await child.exited
		clearInterval(pumpTimer)
		pumpTimer = undefined
		if (pumpError !== undefined) throw pumpError
		pump()
		return exitCode
	} finally {
		if (pumpTimer !== undefined) clearInterval(pumpTimer)
		if (stderrFd !== undefined) closeSync(stderrFd)
		if (stdoutFd !== undefined) closeSync(stdoutFd)
		rmSync(outputDirectory, { force: true, recursive: true })
	}
}
