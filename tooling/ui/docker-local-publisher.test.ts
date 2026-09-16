import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repositoryRoot } from '../repo/root.mts'

const entrypoint = join(repositoryRoot, 'tooling/ui/docker-local-publisher-entrypoint.sh')
const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

async function runPublisher(exitCode: number, output: string, api?: string) {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-publisher-'))
	try {
		const argsPath = join(directory, 'args')
		await writeFile(join(directory, 'ipfs'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$PUBLISH_TEST_ARGS"\nprintf \'%s\\n\' "$PUBLISH_TEST_OUTPUT"\nexit "$PUBLISH_TEST_EXIT"\n', { mode: 0o755 })
		const child = Bun.spawn(['sh', entrypoint], {
			env: {
				...process.env,
				PATH: `${directory}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
				IPFS_API: api ?? '',
				PUBLISH_TEST_ARGS: argsPath,
				PUBLISH_TEST_OUTPUT: output,
				PUBLISH_TEST_EXIT: String(exitCode),
			},
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
		return { status, stdout, stderr, args: (await readFile(argsPath, 'utf8')).trim().split('\n') }
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

describe('local Docker IPFS publisher', () => {
	test('uploads and pins the complete export and prints each app link', async () => {
		const result = await runPublisher(0, cid)
		expect(result.status).toBe(0)
		expect(result.args).toEqual(['--api', '/dns4/host.docker.internal/tcp/5001', 'add', '--cid-version', '1', '--pin=true', '--quieter', '--recursive', '/export'])
		for (const app of ['zoltar', 'statoblast', 'trading']) {
			expect(result.stdout).toContain(`ipfs://${cid}/${app}/`)
		}
		expect(result.stdout).not.toContain('localhost:8088')
	})

	test('passes an explicit API to Kubo as one argument', async () => {
		const result = await runPublisher(0, cid, '/dns4/another-node/tcp/5001')
		expect(result.status).toBe(0)
		expect(result.args.slice(0, 2)).toEqual(['--api', '/dns4/another-node/tcp/5001'])
	})

	test('propagates upload failure without advertising links', async () => {
		const result = await runPublisher(7, '')
		expect(result.status).toBe(7)
		expect(result.stdout).toBe('')
	})

	test('rejects an empty content identifier without advertising success', async () => {
		const result = await runPublisher(0, '')
		expect(result.status).toBe(1)
		expect(result.stderr).toContain('IPFS did not return a content identifier.')
		expect(result.stdout).toBe('')
	})
})
