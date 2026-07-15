import { expect, test } from 'bun:test'
import { findUiLayerBoundaryViolations } from './lint-ui-layer-boundaries.mts'

test('rejects static, dynamic, exported, and type imports from UI features', () => {
	const findings = findUiLayerBoundaryViolations(
		'ui/ts/protocol/example.ts',
		["import { helper } from '../features/reporting/lib/helper.js'", "export { value } from '../features/markets/lib/value.js'", "type State = import('../features/universes/lib/state.js').State", "const feature = import('../features/open-oracle/lib/feature.js')"].join('\n'),
	)

	expect(findings.map(finding => finding.specifier)).toEqual(['../features/reporting/lib/helper.js', '../features/markets/lib/value.js', '../features/universes/lib/state.js', '../features/open-oracle/lib/feature.js'])
})

test('rejects feature imports from app composition', () => {
	const findings = findUiLayerBoundaryViolations('ui/ts/features/markets/Market.tsx', "import { AppShell } from '../../app/AppShell.js'")

	expect(findings.map(finding => finding.rule)).toEqual(['features-must-not-import-app'])
})

test('rejects shared component imports from app and features', () => {
	const findings = findUiLayerBoundaryViolations('ui/ts/components/Overview.tsx', ["import { AppShell } from '../app/AppShell.js'", "import { Market } from '../features/markets/Market.js'"].join('\n'))

	expect(findings.map(finding => finding.rule)).toEqual(['shared-layers-must-not-import-app', 'shared-layers-must-not-import-features'])
})

test('rejects app and feature imports from every non-composition layer', () => {
	for (const layer of ['components', 'hooks', 'lib', 'protocol', 'simulation', 'types']) {
		const findings = findUiLayerBoundaryViolations(`ui/ts/${layer}/example.ts`, ["import { AppShell } from '../app/AppShell.js'", "import { Market } from '../features/markets/Market.js'"].join('\n'))
		expect(findings.map(finding => finding.rule)).toEqual(['shared-layers-must-not-import-app', 'shared-layers-must-not-import-features'])
	}
})

test('allows dependencies within protocol and shared UI libraries', () => {
	const findings = findUiLayerBoundaryViolations('ui/ts/protocol/example.ts', ["import { helper } from './helpers.js'", "import { format } from '../lib/format.js'", "import { getAddress } from '@zoltar/shared/ethereum'"].join('\n'))

	expect(findings).toEqual([])
})

test('rejects test imports that bypass mirrored ownership', () => {
	const cases = [
		['ui/ts/tests/root.test.ts', "import { client } from '../protocol/client.js'"],
		['ui/ts/tests/testUtils/helper.ts', "import { Market } from '../../features/markets/Market.js'"],
		['ui/ts/tests/features/markets/market.test.ts', "import { AppShell } from '../../../app/AppShell.js'"],
		['ui/ts/tests/protocol/client.test.ts', "import { Market } from '../../features/markets/Market.js'"],
		['ui/ts/tests/simulation/bootstrap.test.ts', "import { AppShell } from '../../app/AppShell.js'"],
	] as const

	for (const [sourcePath, sourceText] of cases) {
		expect(findUiLayerBoundaryViolations(sourcePath, sourceText).map(finding => finding.rule)).toEqual(['test-layers-must-follow-ownership'])
	}
})
