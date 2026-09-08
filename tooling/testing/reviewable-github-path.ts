import { existsSync } from 'node:fs'
import path from 'node:path'

/** Prefer workflow changes staged for maintainer promotion, while retaining the active-file fallback. */
export function reviewableGitHubPath(repositoryRoot: string, relativePath: string): string {
	const stagedPath = path.join(repositoryRoot, 'move_github', relativePath)
	return existsSync(stagedPath) ? stagedPath : path.join(repositoryRoot, '.github', relativePath)
}
