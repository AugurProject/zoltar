import { expect, test } from 'bun:test'
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
		if (command === 'diff --name-status -z --find-renames --diff-filter=ACMRTUXBD origin/main...HEAD') return 'D\0shared/ts/deleted.ts\0R100\0ui/zoltar/ts/tests/old.test.ts\0ui/zoltar/ts/tests/new.test.ts\0'
		if (command === 'ls-files -z --others --exclude-standard') return 'scripts/new.test.ts\0'
		return ''
	})

	expect(changes).toEqual([
		{ path: 'scripts/new.test.ts', status: 'added' },
		{ path: 'shared/ts/deleted.ts', status: 'deleted' },
		{ path: 'ui/zoltar/ts/tests/new.test.ts', previousPath: 'ui/zoltar/ts/tests/old.test.ts', status: 'renamed' },
	])
})

test('test planning collapses layered additions, deletions, and rename chains to final paths', () => {
	const changes = getChangedFileEntries(args => {
		const command = args.join(' ')
		if (command === 'diff --name-status -z --find-renames --diff-filter=ACMRTUXBD origin/main...HEAD') return 'A\0scripts/temporary.test.ts\0R100\0scripts/original.test.ts\0scripts/committed.test.ts\0'
		if (command === 'diff --cached --name-status -z --find-renames --diff-filter=ACMRTUXBD') return 'R100\0scripts/committed.test.ts\0scripts/staged.test.ts\0'
		if (command === 'diff --name-status -z --find-renames --diff-filter=ACMRTUXBD') return 'D\0scripts/temporary.test.ts\0R100\0scripts/staged.test.ts\0scripts/final.test.ts\0'
		return ''
	})

	expect(changes).toEqual([{ path: 'scripts/final.test.ts', previousPath: 'scripts/original.test.ts', status: 'renamed' }])
})

test('test planning treats a deleted committed rename destination as deletion of the baseline path', () => {
	const changes = getChangedFileEntries(args => {
		const command = args.join(' ')
		if (command === 'diff --name-status -z --find-renames --diff-filter=ACMRTUXBD origin/main...HEAD') return 'R100\0scripts/original.test.ts\0scripts/renamed.test.ts\0'
		if (command === 'diff --name-status -z --find-renames --diff-filter=ACMRTUXBD') return 'D\0scripts/renamed.test.ts\0'
		return ''
	})

	expect(changes).toEqual([{ path: 'scripts/original.test.ts', status: 'deleted' }])
	expect(getTestImpactRecommendations(changes)).toEqual([])
})
