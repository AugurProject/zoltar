import { expect, test } from 'bun:test'
import { validateAuditTarget } from './check-audit-target.mts'

const commit = '1b5ebf30638e11551a3dd5a93f4fa949b0ef6300'

test('accepts the exact audited commit only when the worktree is clean', () => {
	expect(() =>
		validateAuditTarget({
			auditedCommit: commit.toUpperCase(),
			headCommit: commit,
			worktreeStatus: '',
		}),
	).not.toThrow()
})

test('rejects abbreviated or missing audit commit identifiers', () => {
	for (const auditedCommit of ['', commit.slice(0, 12)]) {
		expect(() =>
			validateAuditTarget({
				auditedCommit,
				headCommit: commit,
				worktreeStatus: '',
			}),
		).toThrow('ZOLTAR_AUDITED_COMMIT must be a full 40-character Git commit SHA')
	}
})

test('rejects a release commit that differs from the audited commit', () => {
	expect(() =>
		validateAuditTarget({
			auditedCommit: commit,
			headCommit: '88ef74d3efc5daf830761e4cc8137db8f039baa3',
			worktreeStatus: '',
		}),
	).toThrow('does not exactly match audited commit')
})

test('rejects staged, unstaged, or untracked release files', () => {
	expect(() =>
		validateAuditTarget({
			auditedCommit: commit,
			headCommit: commit,
			worktreeStatus: ' M solidity/contracts/peripherals/SecurityPool.sol\n?? local-deployment.json',
		}),
	).toThrow('Release worktree is not clean')
})
