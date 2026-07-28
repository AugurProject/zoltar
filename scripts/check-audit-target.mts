import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/i

export type AuditTarget = {
	auditedCommit: string
	headCommit: string
	worktreeStatus: string
}

export function validateAuditTarget({ auditedCommit, headCommit, worktreeStatus }: AuditTarget) {
	if (!FULL_COMMIT_PATTERN.test(auditedCommit)) {
		throw new Error('ZOLTAR_AUDITED_COMMIT must be a full 40-character Git commit SHA')
	}
	if (!FULL_COMMIT_PATTERN.test(headCommit)) {
		throw new Error(`Git returned an invalid HEAD commit: ${headCommit}`)
	}
	if (auditedCommit.toLowerCase() !== headCommit.toLowerCase()) {
		throw new Error(`Release commit ${headCommit} does not exactly match audited commit ${auditedCommit}`)
	}
	if (worktreeStatus !== '') {
		throw new Error(`Release worktree is not clean:\n${worktreeStatus}`)
	}
}

function runGit(args: string[]) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function checkAuditTarget() {
	const auditedCommit = process.env['ZOLTAR_AUDITED_COMMIT'] ?? ''
	const headCommit = runGit(['rev-parse', 'HEAD'])
	const worktreeStatus = runGit(['status', '--porcelain=v1', '--untracked-files=normal'])
	validateAuditTarget({ auditedCommit, headCommit, worktreeStatus })
	console.log(`Audit target verified: clean worktree at ${headCommit}`)
}

const invokedScriptPath = process.argv[1]
if (invokedScriptPath !== undefined && fileURLToPath(import.meta.url) === invokedScriptPath) checkAuditTarget()
