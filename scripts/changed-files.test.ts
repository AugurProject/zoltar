import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getChangedFileEntries, getChangedFiles } from './changed-files.mts'
import { getTestImpactRecommendations } from './test-impact.mts'

test('changed-files combines committed, staged, unstaged, and untracked paths', () => {
	const changedFiles = getChangedFiles(args => {
		if (args.join(' ') === 'diff --name-only --diff-filter=ACMRTUXB origin/main...HEAD') return 'ui/zoltar/ts/components/Committed.tsx\nshared/ts/Shared.ts\n'
		if (args.join(' ') === 'diff --name-only --diff-filter=ACMRTUXB') return 'ui/zoltar/ts/components/Unstaged.tsx\nshared/ts/Shared.ts\n'
		if (args.join(' ') === 'diff --cached --name-only --diff-filter=ACMRTUXB') return 'ui/zoltar/ts/components/Staged.tsx\n'
		if (args.join(' ') === 'ls-files --others --exclude-standard') return 'scripts/NewScript.mts\n'
		return ''
	})

	expect(changedFiles).toEqual(['scripts/NewScript.mts', 'shared/ts/Shared.ts', 'ui/zoltar/ts/components/Committed.tsx', 'ui/zoltar/ts/components/Staged.tsx', 'ui/zoltar/ts/components/Unstaged.tsx'])
})

test('changed-files surfaces branch diff failures instead of silently skipping them', () => {
	expect(() =>
		getChangedFiles(args => {
			if (args.join(' ') === 'diff --name-only --diff-filter=ACMRTUXB origin/main...HEAD') {
				throw new Error('missing origin/main')
			}
			return ''
		}),
	).toThrow('missing origin/main')
})

test('test planning preserves deletions and rename source paths', () => {
	const changes = getChangedFileEntries(args => {
		const command = args.join(' ')
		if (command === 'merge-base origin/main HEAD') return 'baseline'
		if (command === 'diff --name-status -z --find-renames --diff-filter=ACMRTUXBD baseline') return 'D\0shared/ts/deleted.ts\0R100\0ui/zoltar/ts/tests/old.test.ts\0ui/zoltar/ts/tests/new.test.ts\0'
		if (command === 'ls-files -z --others --exclude-standard') return 'scripts/new.test.ts\0'
		return ''
	})

	expect(changes).toEqual([
		{ path: 'scripts/new.test.ts', status: 'added' },
		{ path: 'shared/ts/deleted.ts', status: 'deleted' },
		{ path: 'ui/zoltar/ts/tests/new.test.ts', previousPath: 'ui/zoltar/ts/tests/old.test.ts', status: 'renamed' },
	])
})

test('test planning reads the merge-base-to-worktree diff as the final path state', () => {
	const commands: string[] = []
	const changes = getChangedFileEntries(args => {
		const command = args.join(' ')
		commands.push(command)
		if (command === 'merge-base origin/main HEAD') return 'baseline'
		if (command === 'diff --name-status -z --find-renames --diff-filter=ACMRTUXBD baseline') return 'R100\0scripts/original.test.ts\0scripts/final.test.ts\0'
		return ''
	})

	expect(changes).toEqual([{ path: 'scripts/final.test.ts', previousPath: 'scripts/original.test.ts', status: 'renamed' }])
	expect(commands).toEqual(['merge-base origin/main HEAD', 'diff --name-status -z --find-renames --diff-filter=ACMRTUXBD baseline', 'ls-files -z --others --exclude-standard'])
})

test('test planning excludes reverse renames, delete-restores, and reverted modifications absent from the final diff', () => {
	expect(getChangedFileEntries(args => (args[0] === 'merge-base' ? 'baseline' : ''))).toEqual([])
})

test('test planning treats a final baseline-path deletion as deleted', () => {
	const changes = getChangedFileEntries(args => {
		const command = args.join(' ')
		if (command === 'merge-base origin/main HEAD') return 'baseline'
		if (command === 'diff --name-status -z --find-renames --diff-filter=ACMRTUXBD baseline') return 'D\0scripts/original.test.ts\0'
		return ''
	})

	expect(changes).toEqual([{ path: 'scripts/original.test.ts', status: 'deleted' }])
	expect(getTestImpactRecommendations(changes)).toEqual([])
})

test('test planning resolves committed, staged, unstaged, and untracked paths against the merge base', async () => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'changed-files-final-state-'))
	const git = (args: string[]) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
	try {
		git(['init'])
		git(['config', 'user.email', 'tests@example.com'])
		git(['config', 'user.name', 'Test Runner'])
		for (const filePath of ['delete-restore.test.ts', 'deleted.test.ts', 'modified-revert.test.ts', 'modified.test.ts', 'rename.test.ts', 'reverse.test.ts']) await writeFile(join(repositoryRoot, filePath), `${filePath} baseline\n`)
		git(['add', '.'])
		git(['commit', '-m', 'baseline'])
		git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])

		git(['mv', 'reverse.test.ts', 'reverse-intermediate.test.ts'])
		git(['rm', 'delete-restore.test.ts'])
		await writeFile(join(repositoryRoot, 'modified-revert.test.ts'), 'committed change\n')
		git(['add', '.'])
		git(['commit', '-m', 'temporary branch changes'])

		git(['mv', 'reverse-intermediate.test.ts', 'reverse.test.ts'])
		await writeFile(join(repositoryRoot, 'delete-restore.test.ts'), 'delete-restore.test.ts baseline\n')
		await writeFile(join(repositoryRoot, 'modified-revert.test.ts'), 'modified-revert.test.ts baseline\n')
		git(['add', 'delete-restore.test.ts', 'modified-revert.test.ts', 'reverse.test.ts'])
		git(['mv', 'rename.test.ts', 'renamed.test.ts'])
		git(['rm', 'deleted.test.ts'])
		await writeFile(join(repositoryRoot, 'modified.test.ts'), 'unstaged change\n')
		await writeFile(join(repositoryRoot, 'untracked.test.ts'), 'untracked\n')

		expect(getChangedFileEntries(git)).toEqual([
			{ path: 'deleted.test.ts', status: 'deleted' },
			{ path: 'modified.test.ts', status: 'modified' },
			{ path: 'renamed.test.ts', previousPath: 'rename.test.ts', status: 'renamed' },
			{ path: 'untracked.test.ts', status: 'added' },
		])
	} finally {
		await rm(repositoryRoot, { recursive: true })
	}
})
