import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyCiChange, getCiChangedFiles } from './classify-ci-change.mts'

test('classifies documentation and agent-only changes as lightweight', () => {
	expect(classifyCiChange(['README.md', 'docs/operators.md', '.codex/agents/reviewer.toml'])).toEqual({
		heavy: false,
		reason: 'Only documentation, review instructions, or agent definitions changed.',
	})
})

test('classifies executable changes as heavy and identifies them', () => {
	expect(classifyCiChange(['docs/operators.md', 'ui/ts/index.ts'])).toEqual({
		heavy: true,
		reason: 'Executable or configuration paths changed: ui/ts/index.ts',
	})
})

test('uses the full suite when changed paths are unavailable', () => {
	expect(classifyCiChange([])).toEqual({
		heavy: true,
		reason: 'No changed paths were detected, so CI is using the safe full-suite fallback.',
	})
})

test('Git path collection keeps executable deletions and both sides of renames', () => {
	const repository = mkdtempSync(join(tmpdir(), 'zoltar-ci-change-'))
	const git = (args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
	try {
		git(['init'])
		git(['config', 'user.email', 'ci@example.com'])
		git(['config', 'user.name', 'CI Test'])
		mkdirSync(join(repository, 'docs'))
		mkdirSync(join(repository, 'scripts'))
		writeFileSync(join(repository, 'docs', 'guide.md'), 'before\n')
		writeFileSync(join(repository, 'scripts', 'deleted.mts'), 'export const deleted = true\n')
		writeFileSync(join(repository, 'scripts', 'renamed.mts'), 'export const renamed = true\n')
		git(['add', '.'])
		git(['commit', '-m', 'baseline'])
		const baseRef = git(['rev-parse', 'HEAD'])

		rmSync(join(repository, 'scripts', 'deleted.mts'))
		renameSync(join(repository, 'scripts', 'renamed.mts'), join(repository, 'docs', 'renamed.md'))
		writeFileSync(join(repository, 'docs', 'guide.md'), 'after\n')
		git(['add', '-A'])
		git(['commit', '-m', 'delete and rename'])

		const changedFiles = getCiChangedFiles(baseRef, repository)
		expect(changedFiles).toEqual(['docs/guide.md', 'docs/renamed.md', 'scripts/deleted.mts', 'scripts/renamed.mts'])
		expect(classifyCiChange(changedFiles).heavy).toBe(true)
	} finally {
		rmSync(repository, { force: true, recursive: true })
	}
})
