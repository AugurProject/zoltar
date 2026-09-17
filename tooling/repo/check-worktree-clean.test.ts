import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const script = path.join(import.meta.dir, 'check-worktree-clean.sh')

test('worktree gate accepts clean repositories and rejects unstaged, staged, and untracked changes in either phase', () => {
	const cwd = mkdtempSync(path.join(tmpdir(), 'worktree-clean-'))
	const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
	const check = (phase: string) => spawnSync('bash', [script, phase], { cwd, encoding: 'utf8' })
	try {
		git('init')
		writeFileSync(path.join(cwd, 'tracked'), 'baseline\n')
		git('add', '.')
		git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline')
		for (const phase of ['pre-task', 'final']) {
			expect(check(phase).status).toBe(0)
			writeFileSync(path.join(cwd, 'tracked'), 'changed\n')
			expect(check(phase).status).toBe(1)
			git('add', '.')
			expect(check(phase).status).toBe(1)
			git('reset', '--hard', 'HEAD')
			writeFileSync(path.join(cwd, 'untracked'), 'new\n')
			const result = check(phase)
			expect(result.status).toBe(1)
			expect(result.stdout).toContain(`Unexpected ${phase} worktree changes`)
			expect(result.stdout).toContain('untracked')
			rmSync(path.join(cwd, 'untracked'))
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true })
	}
})
