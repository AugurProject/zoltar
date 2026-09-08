import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { reviewableGitHubPath } from './reviewable-github-path.ts'

test('prefers a staged GitHub file and falls back after maintainer promotion', () => {
	const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'zoltar-reviewable-github-'))
	const relativePath = 'workflows/ci.yml'
	const activePath = path.join(repositoryRoot, '.github', relativePath)
	const stagedPath = path.join(repositoryRoot, 'move_github', relativePath)
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
