import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildDocumentationChartBundle } from './documentationChartBuild.mts'

const outputPath = path.resolve(import.meta.dir, '../docs/assets/js/chartRuntime.js')
await writeFile(outputPath, await buildDocumentationChartBundle())
