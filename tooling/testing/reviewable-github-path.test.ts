import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { reviewableGitHubPath } from './reviewable-github-path.ts'

test.each([
	['workflows/ci.yml', 'workflow/ci.yml'],
	['actions/setup-ci/action.yml', 'workflow/actions/setup-ci/action.yml'],
	['workflows/ci.yml', 'move_github/workflows/ci.yml'],
])('prefers staged %s in %s and falls back after promotion', (relativePath, stagedRelativePath) => {
	const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'zoltar-reviewable-github-'))
	const activePath = path.join(repositoryRoot, '.github', relativePath)
	const stagedPath = path.join(repositoryRoot, stagedRelativePath)
	try {
		mkdirSync(path.dirname(activePath), { recursive: true })
		mkdirSync(path.dirname(stagedPath), { recursive: true })
		writeFileSync(activePath, 'active\n')
		expect(reviewableGitHubPath(repositoryRoot, relativePath)).toBe(activePath)
		writeFileSync(stagedPath, 'staged\n')
		expect(reviewableGitHubPath(repositoryRoot, relativePath)).toBe(stagedPath)
		rmSync(stagedPath)
		expect(reviewableGitHubPath(repositoryRoot, relativePath)).toBe(activePath)
	} finally {
		rmSync(repositoryRoot, { force: true, recursive: true })
	}
})
