import { expect, test } from 'bun:test'
import { repositorySourceTarget } from './repository-source-links.mts'

test('ignores GitHub display parameters and fragments when identifying a repository path', () => {
	expect(repositorySourceTarget('https://github.com/AugurProject/zoltar/blob/main/README.md?plain=1#L1')).toEqual({ kind: 'file', path: 'README.md' })
	expect(repositorySourceTarget('https://github.com/AugurProject/zoltar/tree/main/docs?display=1')).toEqual({ kind: 'directory', path: 'docs' })
	expect(repositorySourceTarget('https://github.com/AugurProject/zoltar/blob/main/a%3Fb.md#L1')).toEqual({ kind: 'file', path: 'a?b.md' })
})
