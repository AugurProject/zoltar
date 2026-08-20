import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const result = await Bun.build({
	entrypoints: [path.join(projectRoot, 'browser/app.ts')],
	format: 'esm',
	naming: 'app.js',
	outdir: path.join(projectRoot, 'public'),
	target: 'browser',
	banner: '// Generated from augurScan/browser/app.ts by bun run build. Do not edit.\n',
})

if (!result.success) {
	for (const log of result.logs) console.error(log)
	throw new AggregateError(result.logs, 'Could not build the AugurScan browser application')
}

const entrypoint = result.outputs.find((output) => output.kind === 'entry-point')
if (entrypoint === undefined) throw new Error('AugurScan browser build did not produce app.js')
