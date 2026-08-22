import { expect, test } from 'bun:test'
import { join } from 'node:path'

const requiredArguments = ['--position-file=/tmp/unused-position-journal.json', '--chain-id=1', '--report-id=7', '--confirm-report-id=7', '--evidence=archived receipts', '--note=manual unwind complete', '--external-cost-eth=0.003', '--final-wallet-weth=4', '--final-wallet-token=5'] as const

async function run(arguments_: readonly string[]) {
	const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'reconcile-position.ts'), ...arguments_], {
		env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'PRIVATE_KEY')),
		stderr: 'pipe',
		stdout: 'pipe',
	})
	return { exitCode: await child.exited, stderr: await new Response(child.stderr).text() }
}

test('manual realized P&L requires an explicit all-in accounting acknowledgement', async () => {
	const missing = await run([...requiredArguments, '--realized-net-profit-eth=-0.04'])
	expect(missing.exitCode).not.toBe(0)
	expect(missing.stderr).toContain('--acknowledge-pnl-is-all-in=true')
	const acknowledged = await run([...requiredArguments, '--realized-net-profit-eth=-0.04', '--acknowledge-pnl-is-all-in=true'])
	expect(acknowledged.exitCode).not.toBe(0)
	expect(acknowledged.stderr).toContain('PRIVATE_KEY must be')
})
