import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { classifyCiChange, isDocumentationChange } from '../ci/classify-ci-change.mts'
import { getTestImpactRecommendations } from '../testing/test-impact.mts'
import { documentationConsumerMatches, documentationConsumers } from './documentation-consumers.ts'
import { listRepositoryFiles } from './git.mts'
import { projects } from './projects.ts'

const repositoryFiles = listRepositoryFiles().filter(filePath => filePath !== '')

const scopeFor = (projectId: string) => {
	const scope = projects.find(project => project.id === projectId)?.ci?.scope
	if (scope === undefined) throw new Error(`Documentation consumer ${projectId} has no CI scope`)
	return scope
}

test.each(documentationConsumers.map(consumer => [consumer.reason, consumer] as const))('CI classification and test impact agree when %s', (_reason, consumer) => {
	expect(consumer.tests.length).toBeGreaterThan(0)
	for (const testPath of consumer.tests) expect(existsSync(testPath)).toBe(true)
	const samplePaths = [...(consumer.files ?? []), ...(consumer.directories ?? []).map(directory => repositoryFiles.find(filePath => filePath.startsWith(directory))), ...(consumer.pattern === undefined ? [] : [repositoryFiles.find(filePath => consumer.pattern?.test(filePath) === true)])]
	for (const samplePath of samplePaths) {
		if (samplePath === undefined) throw new Error(`Documentation consumer for ${consumer.projectId} matches no repository file`)
		expect(existsSync(samplePath)).toBe(true)
		expect(isDocumentationChange(samplePath)).toBe(true)
		expect(classifyCiChange([samplePath]).expandedScopes).toContain(scopeFor(consumer.projectId))
		const recommended = getTestImpactRecommendations([samplePath])
			.map(recommendation => recommendation.command)
			.join('\n')
		for (const testPath of consumer.tests) expect(recommended).toContain(testPath.replace(/^(?:augurScan|bots\/[^/]+)\//, ''))
	}
})

test('every documentation page a root tooling test reads by literal path selects a consumer', () => {
	const readPaths = repositoryFiles.filter(filePath => filePath.startsWith('tooling/') && filePath.endsWith('.test.ts')).flatMap(filePath => [...readFileSync(filePath, 'utf8').matchAll(/(?:Bun\.file|readFile|loadDocument)\(\s*'((?:docs\/|[^']*README)[^']*\.(?:html|md))'/g)].map(match => match[1] ?? ''))
	expect(readPaths.length).toBeGreaterThan(0)
	for (const readPath of new Set(readPaths)) expect({ readPath, consumed: documentationConsumers.some(consumer => documentationConsumerMatches(consumer, readPath)) }).toEqual({ readPath, consumed: true })
})
