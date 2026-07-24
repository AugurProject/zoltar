import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const executable = join(import.meta.dir, '..', 'open-oracle-arbitrager')
const oracle = '--open-oracle=0x0000000000000000000000000000000000000000'

async function invalidStartup(argument: string) {
	const environment = { ...process.env }
	delete environment['PRIVATE_KEY']
	const child = Bun.spawn([executable, oracle, '--once', argument], {
		env: environment,
		stderr: 'pipe',
		stdout: 'pipe',
	})
	const [exitCode, stderr, stdout] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
	return { exitCode, output: `${stdout}${stderr}` }
}

describe('startup configuration', () => {
	test.each([
		['--minimum-remaining-blocks=0', 'Minimum remaining blocks must be from 1 to 1000'],
		['--minimum-remaining-seconds=86401', 'Minimum remaining seconds must be from 1 to 86400'],
		['--minimum-profit-bps=100001', 'Minimum return must be from 0 to 100000'],
		['--max-spot-twap-ticks=-1', 'Maximum spot/TWAP ticks must be a non-negative integer'],
		['--poll-ms=999', 'Poll interval must be an integer from 1000 to 3600000'],
		['--lookback-blocks=-1', 'lookback-blocks must be a non-negative integer'],
		['--submission-mode=unknown', 'Submission mode must be public or private'],
		['--relay-url=http://relay.example', 'Relay URL must use HTTPS'],
	])('rejects %s before starting RPC activity', async (argument, message) => {
		const result = await invalidStartup(argument)
		expect(result.exitCode).toBe(1)
		expect(result.output).toContain(message)
		expect(result.output).not.toContain('mode=')
	})
})
