import { bundledComposeSourceUrl } from '../src/deployment-verification.ts'

let configuration: unknown
try {
	configuration = JSON.parse(await Bun.stdin.text())
} catch (error) {
	throw new Error('Resolved Compose configuration must be valid JSON', { cause: error })
}

bundledComposeSourceUrl(configuration)
process.stdout.write('Resolved bundled PostgreSQL source is supported.\n')
