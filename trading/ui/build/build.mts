import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeCoreDeploymentRegistry } from './core-deployments.mts'

const uiRoot = path.resolve(import.meta.dir, '..')
const output = path.join(uiRoot, 'dist')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
const result = await Bun.build({ entrypoints: [path.join(uiRoot, 'ts/index.tsx')], outdir: output, naming: 'app.js', target: 'browser', minify: false, sourcemap: 'linked' })
if (!result.success) throw new AggregateError(result.logs, 'Trading UI build failed')
await Promise.all([fs.copyFile(path.join(uiRoot, 'index.html'), path.join(output, 'index.html')), fs.copyFile(path.join(uiRoot, 'css/app.css'), path.join(output, 'app.css')), writeCoreDeploymentRegistry(path.join(output, 'core-deployments.json'))])
console.log(`Built standalone trading UI in ${output}`)
