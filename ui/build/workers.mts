import * as path from 'path'
import * as url from 'url'
import esbuild from 'esbuild'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')

await esbuild.build({
	bundle: true,
	entryPoints: [path.join(UI_ROOT_PATH, 'ts', 'simulation', 'tevmWorker.ts')],
	format: 'esm',
	logLevel: 'info',
	outfile: path.join(UI_ROOT_PATH, 'js', 'simulation', 'tevmWorker.worker.js'),
	platform: 'browser',
	sourcemap: true,
	target: 'esnext',
})
