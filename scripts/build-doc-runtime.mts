import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildDocumentationRuntime, documentationRuntimeNames } from './documentationRuntimeBuild.mts'

const repositoryRoot = path.resolve(import.meta.dir, '..')
const sourceRoot = path.join(repositoryRoot, 'docs/runtime')
const outputRoot = path.join(repositoryRoot, 'docs/assets/js')

await Promise.all(
	documentationRuntimeNames.map(async name => {
		await writeFile(path.join(outputRoot, `${name}.js`), await buildDocumentationRuntime(name, sourceRoot))
	}),
)
