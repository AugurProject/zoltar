import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repositoryRoot } from '../repo/root.mts'

const entrypoint = join(repositoryRoot, 'tooling/ui/docker-local-publisher-entrypoint.sh')
const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

async function runPublisher(exitCode: number, output: string, api?: string, failApp?: string) {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-publisher-'))
	try {
		const argsPath = join(directory, 'args')
		await writeFile(
			join(directory, 'ipfs'),
			`#!/bin/sh
printf '%s\\n' "$@" >> "$PUBLISH_TEST_ARGS"
for argument do app=$(basename "$argument"); done
if [ -n "$PUBLISH_TEST_FAIL_APP" ] && [ "$app" != "$PUBLISH_TEST_FAIL_APP" ]; then
    printf '%s\\n' "$PUBLISH_TEST_OUTPUT$app"
    exit 0
fi
if [ -n "$PUBLISH_TEST_OUTPUT" ]; then printf '%s\\n' "$PUBLISH_TEST_OUTPUT$app"; fi
exit "$PUBLISH_TEST_EXIT"
`,
			{ mode: 0o755 },
		)
		const child = Bun.spawn(['sh', entrypoint], {
			env: {
				...process.env,
				PATH: `${directory}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
				IPFS_API: api ?? '',
				PUBLISH_TEST_ARGS: argsPath,
				PUBLISH_TEST_OUTPUT: output,
				PUBLISH_TEST_EXIT: String(exitCode),
				PUBLISH_TEST_FAIL_APP: failApp ?? '',
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
	test('uploads and pins each app separately and prints root links', async () => {
		const result = await runPublisher(0, cid)
		expect(result.status).toBe(0)
		expect(result.args).toEqual(['zoltar', 'statoblast', 'trading'].flatMap(app => ['--api', '/dns4/host.docker.internal/tcp/5001', 'add', '--cid-version', '1', '--pin=true', '--quieter', '--recursive', `/export/${app}`]))
		for (const app of ['zoltar', 'statoblast', 'trading']) {
			expect(result.stdout).toContain(`${app}: ipfs://${cid}${app}/`)
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

	test('stops on a later upload failure and preserves already published links', async () => {
		const result = await runPublisher(7, cid, undefined, 'statoblast')
		expect(result.status).toBe(7)
		expect(result.stdout).toBe(`zoltar: ipfs://${cid}zoltar/\n`)
		expect(result.args).toContain('/export/statoblast')
		expect(result.args).not.toContain('/export/trading')
	})

	test('rejects an empty content identifier without advertising success', async () => {
		const result = await runPublisher(0, '')
		expect(result.status).toBe(1)
		expect(result.stderr).toContain('IPFS did not return a content identifier.')
		expect(result.stdout).toBe('')
	})
})
