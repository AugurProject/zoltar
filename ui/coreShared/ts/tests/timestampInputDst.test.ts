import { expect, test } from 'bun:test'

test('#1386 rejects nonexistent local times instead of normalizing the deadline', () => {
	const modulePath = new URL('../forms/formInputs.ts', import.meta.url).pathname
	const script = `import { tryParseTimestampInput } from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(['2027-03-14T01:30', '2027-03-14T02:30', '2027-03-14T03:30'].map(value => tryParseTimestampInput(value)?.toString())))`
	const result = Bun.spawnSync([process.execPath, '--eval', script], { env: { ...process.env, TZ: 'America/New_York' } })
	expect(result.exitCode).toBe(0)
	expect(JSON.parse(result.stdout.toString())).toEqual(['1805005800', null, '1805009400'])
})
