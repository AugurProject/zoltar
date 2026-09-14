import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
