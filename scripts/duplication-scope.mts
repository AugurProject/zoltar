import { execFileSync } from 'node:child_process'

const excludedSegments = new Set(['node_modules', 'vendor', 'vendored', 'generated', 'artifacts', 'dist', 'js', 'coverage', '.git'])

export function isDuplicationSource(path: string) {
	return /\.(?:[cm]?ts|tsx)$/.test(path) && !/\.generated\.[cm]?tsx?$/.test(path) && !/(?:^|\/)(?:contractArtifact|abis)\.ts$/.test(path) && !path.split('/').some(segment => excludedSegments.has(segment))
}

export function isDuplicationTest(path: string) {
	return /(?:^|\/)(?:tests?|testSupport|fixtures)(?:\/|\.)|\.(?:test|spec)\.[cm]?tsx?$/.test(path)
}

export function duplicationSourcePaths(root: string) {
	const paths = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
	const deleted = new Set(execFileSync('git', ['ls-files', '--deleted', '-z'], { cwd: root, encoding: 'utf8' }).split('\0'))
	return [...new Set(paths)].filter(path => !deleted.has(path) && isDuplicationSource(path)).sort()
}
