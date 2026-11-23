import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runBunTestProcess } from './run-bun-test-process.mts'

const directory = process.env['ZOLTAR_TEST_COVERAGE_DIRECTORY']
const argumentsForBun = process.argv.slice(2)
if (directory !== undefined && directory !== '') {
	await mkdir(directory, { recursive: true })
	argumentsForBun.push('--coverage', '--coverage-reporter=lcov', `--coverage-dir=${directory}`, '--reporter=junit', `--reporter-outfile=${join(directory, 'junit.xml')}`)
}
process.exitCode = await runBunTestProcess({ cmd: [process.execPath, 'test', ...argumentsForBun] })
