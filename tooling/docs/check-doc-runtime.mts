import path from 'node:path'

import { findStaleDocumentationRuntime } from './documentationRuntimeBuild.mts'

const repositoryRoot = path.resolve(import.meta.dir, '..')
const sourceRoot = path.join(repositoryRoot, 'docs/runtime')
const outputRoot = path.join(repositoryRoot, 'docs/assets/js')
const stale = await findStaleDocumentationRuntime(sourceRoot, outputRoot)

if (stale.length > 0) throw new Error(`Stale documentation runtime output:\n${stale.map(name => `- ${path.relative(repositoryRoot, path.join(outputRoot, `${name}.js`))}`).join('\n')}\nRun bun run docs:build-runtime.`)
