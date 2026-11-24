import { expect, test } from 'bun:test'
import { compareCoverageLineSets, selectCoveragePilotFiles, TYPESCRIPT_COVERAGE_BRIDGES } from './coverage-pilot.mts'
import { parseLcov } from './lcov.mts'

const canonical = ['ui/zoltar/ts/tests/app.test.ts', ...TYPESCRIPT_COVERAGE_BRIDGES, 'solidity/ts/tests/other.test.ts']
test('#1522 narrows only a bounded UI-only report and retains every bridge', () => {
	const plan = selectCoveragePilotFiles(canonical, ['ui/zoltar/ts/index.ts'])
	expect(plan.mode).toBe('application-and-bridges')
	expect(plan.files).toEqual(canonical.slice(0, -1))
})
test.each([['solidity/contracts/Zoltar.sol'], ['shared/core/ts/value.ts'], ['unknown.ts'], ['ui/zoltar/ts/tests/app.test.ts']].map(paths => ({ paths })))('#1522 unknown consumers fall back to the complete manifest: $paths', ({ paths }) => {
	expect(selectCoveragePilotFiles(canonical, paths)).toEqual({ mode: 'full-fallback', files: canonical })
})
test('#1522 a clean scheduled baseline can compare the smaller pilot to its full control', () => {
	expect(selectCoveragePilotFiles(canonical, []).mode).toBe('application-and-bridges')
})
test('#1522 missing bridge ownership fails closed', () => {
	expect(selectCoveragePilotFiles(canonical.slice(1), ['ui/zoltar/ts/index.ts']).mode).toBe('application-and-bridges')
	expect(selectCoveragePilotFiles(canonical.slice(2), ['ui/zoltar/ts/index.ts']).mode).toBe('full-fallback')
})
test('#1522 compares exact covered identities and rejects different artifacts', () => {
	const record = (line: number) => parseLcov(`SF:shared/core/ts/value.ts\nFNF:0\nFNH:0\nDA:${line},1\nLF:1\nLH:1\nend_of_record\n`)
	const provenance = { revision: 'abc', sources: 'source', artifacts: 'artifact' }
	expect(compareCoverageLineSets(record(1), record(2), provenance, provenance)).toEqual({ missing: ['shared/core/ts/value.ts:1'], additional: ['shared/core/ts/value.ts:2'] })
	expect(compareCoverageLineSets(record(1), record(1), provenance, provenance)).toEqual({ missing: [], additional: [] })
	expect(() => compareCoverageLineSets(record(1), record(1), provenance, { ...provenance, artifacts: 'different' })).toThrow('provenance')
})
