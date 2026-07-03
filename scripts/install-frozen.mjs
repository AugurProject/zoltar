import { spawnSync } from 'node:child_process'
import * as path from 'node:path'

const installDirectory = process.argv[2] === undefined ? process.cwd() : path.resolve(process.cwd(), process.argv[2])
const installArguments = ['install', '--frozen-lockfile']

if (process.platform === 'win32') {
	installArguments.push('--backend=copyfile')
}

const result = spawnSync(process.execPath, installArguments, {
	cwd: installDirectory,
	stdio: 'inherit',
})

if (result.error !== undefined) {
	throw result.error
}

process.exit(typeof result.status === 'number' ? result.status : 1)
