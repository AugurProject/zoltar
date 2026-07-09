import { expect, test } from 'bun:test'
import { getChangedFiles } from './changed-files.mts'

test('changed-files combines committed, staged, unstaged, and untracked paths', () => {
	const changedFiles = getChangedFiles(args => {
		if (args.join(' ') === 'diff --name-only --diff-filter=ACMRTUXB origin/main...HEAD') return 'ui/ts/components/Committed.tsx\nshared/ts/Shared.ts\n'
		if (args.join(' ') === 'diff --name-only --diff-filter=ACMRTUXB') return 'ui/ts/components/Unstaged.tsx\nshared/ts/Shared.ts\n'
		if (args.join(' ') === 'diff --cached --name-only --diff-filter=ACMRTUXB') return 'ui/ts/components/Staged.tsx\n'
		if (args.join(' ') === 'ls-files --others --exclude-standard') return 'scripts/NewScript.mts\n'
		return ''
	})

	expect(changedFiles).toEqual(['scripts/NewScript.mts', 'shared/ts/Shared.ts', 'ui/ts/components/Committed.tsx', 'ui/ts/components/Staged.tsx', 'ui/ts/components/Unstaged.tsx'])
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
