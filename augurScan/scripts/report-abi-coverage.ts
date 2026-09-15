import { unknownCallReport } from '../src/abi-coverage-report.ts'
import { runtimeConfig } from '../src/config.ts'
import { ScannerDatabase } from '../src/database.ts'

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
	console.log('Usage: bun run metadata:unknown-calls [--limit 1..1000]')
	console.log('Read-only report from POSTGRES_URL: canonical undecoded outer calls, grouped by chain, destination, selector and decode status. Default limit: 100. Native transfers, deployments and decoded wrappers are excluded. No schema initialization or chain requests are performed.')
} else {
	if (args.length !== 0 && (args.length !== 2 || args[0] !== '--limit')) throw new Error('Usage: bun run metadata:unknown-calls [--limit 1..1000]')
	const limit = args.length === 0 ? 100 : Number(args[1])
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Report limit must be an integer from 1 to 1000')
	const database = new ScannerDatabase(runtimeConfig.postgresUrl)
	try {
		const calls = await database.read(sql => unknownCallReport(sql, limit))
		console.log(JSON.stringify({ limit, calls }, undefined, 2))
	} finally {
		await database.close()
	}
}
