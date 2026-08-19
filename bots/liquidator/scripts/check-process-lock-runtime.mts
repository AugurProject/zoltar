import { acquireExclusiveProcessLock } from '@zoltar/bot-shared/execution/process-lock'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directory = await mkdtemp(join(tmpdir(), 'zoltar-process-lock-runtime-'))
const lockPath = join(directory, 'operator.lock')

try {
	const first = await acquireExclusiveProcessLock(lockPath, 'Runtime check lock', {})
	try {
		await acquireExclusiveProcessLock(lockPath, 'Runtime check lock', {})
		throw new Error('A live process lock allowed a competing owner')
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes('already locked')) throw error
	}
	const inode = (await stat(lockPath)).ino
	await first.release()
	if ((await stat(lockPath)).ino !== inode) throw new Error('Process lock release replaced the stable lock inode')

	const child = Bun.spawn([process.execPath, '--eval', `import { acquireExclusiveProcessLock } from '@zoltar/bot-shared/execution/process-lock'; await acquireExclusiveProcessLock(${JSON.stringify(lockPath)}, 'Runtime check lock', {}); console.log('ready'); await Bun.sleep(60_000)`], {
		cwd: import.meta.dir,
		stderr: 'pipe',
		stdout: 'pipe',
	})
	try {
		const reader = child.stdout.getReader()
		const next = await reader.read()
		if (next.done || !new TextDecoder().decode(next.value).includes('ready')) throw new Error(`Process-lock runtime child stopped before acquisition: ${await new Response(child.stderr).text()}`)
		reader.releaseLock()
		child.kill('SIGKILL')
		if ((await child.exited) === 0) throw new Error('Process-lock runtime child was not killed')
	} finally {
		if (child.exitCode === null) child.kill('SIGKILL')
		await child.exited
	}

	const replacement = await acquireExclusiveProcessLock(lockPath, 'Runtime check lock', {})
	await replacement.release()
} finally {
	await rm(directory, { force: true, recursive: true })
}
