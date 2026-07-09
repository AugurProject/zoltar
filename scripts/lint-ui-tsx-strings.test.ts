import { expect, test } from 'bun:test'
import { getChangedUiTsxFiles, lintSourceText } from './lint-ui-tsx-strings.mts'

test('lint-ui-tsx-strings rejects interpolated template literals in user-facing props', () => {
	const failures = lintSourceText('ui/ts/components/TestComponent.tsx', 'export function TestComponent({ source }: { source: string }) { return <Notice detail={`Ignored ${source} RPC override`} /> }')

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestComponent.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects direct DOM aria-label literals', () => {
	const failures = lintSourceText('ui/ts/components/TestButton.tsx', "export function TestButton() { return <button aria-label='Close'>x</button> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestButton.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects direct DOM alt literals', () => {
	const failures = lintSourceText('ui/ts/components/TestImage.tsx', "export function TestImage() { return <img alt='Close dialog' /> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestImage.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects direct aria text literals', () => {
	const failures = lintSourceText('ui/ts/components/TestAriaText.tsx', "export function TestAriaText() { return <input aria-valuetext='Loading price' aria-description='Describe dialog' aria-placeholder='Loading price' aria-roledescription='Loading dialog' /> }")

	expect(failures).toHaveLength(4)
	expect(failures.every(failure => failure.includes('direct UI string literal must come from ui/ts/lib/uiStrings.ts'))).toBe(true)
})

test('lint-ui-tsx-strings rejects direct children and factory-call literals', () => {
	const childrenFailures = lintSourceText('ui/ts/components/TestChildren.tsx', "export function TestChildren() { return <Panel children='Save Changes' /> }")
	const innerHtmlFailures = lintSourceText('ui/ts/components/TestInnerHtml.tsx', "export function TestInnerHtml() { return <div dangerouslySetInnerHTML={{ __html: 'Save Changes' }} /> }")
	const factoryCallFailures = lintSourceText('ui/ts/components/TestFactoryCall.tsx', "export function TestFactoryCall() { return h('button', {}, 'Save Changes') }")

	expect(childrenFailures).toHaveLength(1)
	expect(innerHtmlFailures).toHaveLength(1)
	expect(factoryCallFailures).toHaveLength(1)
	expect(childrenFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(innerHtmlFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(factoryCallFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects direct suffix props and acronym JSX text', () => {
	const suffixFailures = lintSourceText('ui/ts/components/TestSuffix.tsx', "export function TestSuffix() { return <CurrencyValue suffix='ETH' /> }")
	const wrappedSuffixFailures = lintSourceText('ui/ts/components/TestWrappedSuffix.tsx', "export function TestWrappedSuffix() { return <CurrencyValue suffix={'REP'} /> }")
	const wrappedAcronymFailures = lintSourceText('ui/ts/components/TestWrappedAcronym.tsx', "export function TestWrappedAcronym() { return <span>{String('ETH')}</span> }")
	const summaryFailures = lintSourceText('ui/ts/components/TestSummary.tsx', "export function TestSummary() { return <Panel summary='Page 1 of 2' /> }")
	const acronymTextFailures = lintSourceText('ui/ts/components/TestAcronymText.tsx', 'export function TestAcronymText() { return <span>ETH</span> }')
	const helperFailures = lintSourceText('ui/ts/components/TestStatusHelper.tsx', "export function TestStatusHelper() { function formatStatus() { return 'Ready' } return <span>{formatStatus()}</span> }")
	const lowercaseHelperFailures = lintSourceText('ui/ts/components/TestLowercaseHelper.tsx', "export function TestLowercaseHelper() { function formatMinutes() { return 'minutes' } return <span>{formatMinutes()}</span> }")

	expect(suffixFailures).toHaveLength(1)
	expect(wrappedSuffixFailures).toHaveLength(1)
	expect(wrappedAcronymFailures).toHaveLength(1)
	expect(summaryFailures).toHaveLength(1)
	expect(acronymTextFailures).toHaveLength(1)
	expect(helperFailures).toHaveLength(1)
	expect(lowercaseHelperFailures).toHaveLength(1)
	expect(suffixFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(wrappedSuffixFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(wrappedAcronymFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(summaryFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(acronymTextFailures[0]).toContain('JSX text must come from UI_STRINGS')
	expect(helperFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(lowercaseHelperFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings ignores className and internal helper tokens', () => {
	const failures = lintSourceText(
		'ui/ts/components/TestInternalTokens.tsx',
		"export function TestInternalTokens() { const internalState = { key: 'queued', value: 'queued', startTime: 'queued' } return <div className='route-shell' data-state={internalState.key}>{renderFieldError('startTime', undefined)}{internalState.value}</div> }",
	)

	expect(failures).toHaveLength(0)
})

test('lint-ui-tsx-strings rejects numeric visible user-facing prop literals', () => {
	const failures = lintSourceText('ui/ts/components/TestNumericPlaceholder.tsx', "export function TestNumericPlaceholder() { return <FormInput placeholder='0.0' /> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects expression-wrapped single-word user-facing prop literals', () => {
	const failures = lintSourceText('ui/ts/components/TestWrappedProps.tsx', "export function TestWrappedProps() { return <Panel aria-label={'Close'} ariaLabel={'Close'} unavailableCopy={'Unavailable'} headerTitle={'Status'} loadMoreLabel={'More'} /> }")

	expect(failures).toHaveLength(5)
	expect(failures.every(failure => failure.includes('direct UI string literal must come from ui/ts/lib/uiStrings.ts'))).toBe(true)
})

test('lint-ui-tsx-strings rejects lowercase visible JSX text', () => {
	const failures = lintSourceText('ui/ts/components/TestText.tsx', 'export function TestText() { return <span>minutes</span> }')

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestText.tsx:')
	expect(failures[0]).toContain('JSX text must come from UI_STRINGS')
})

test('lint-ui-tsx-strings rejects expression-wrapped visible JSX text', () => {
	const failures = lintSourceText('ui/ts/components/TestWrappedText.tsx', "export function TestWrappedText() { return <span>{'minutes'}</span> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestWrappedText.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects user-facing local aliases', () => {
	const failures = lintSourceText('ui/ts/components/TestAlias.tsx', "export function TestAlias() { const closeLabel = 'Close'; return <button aria-label={closeLabel}>x</button> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestAlias.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects user-facing default prop values', () => {
	const failures = lintSourceText('ui/ts/components/TestDefaultProp.tsx', "export function TestDefaultProp({ loadMoreLabel = 'Load More' }: { loadMoreLabel?: string }) { return <button>{loadMoreLabel}</button> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestDefaultProp.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects user-facing assignment expressions', () => {
	const failures = lintSourceText('ui/ts/components/TestAssignedReason.tsx', "export function TestAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason = shouldBlock ? 'Settle later.' : 'Settle now.'; return <Panel reason={disabledReason} /> }")

	expect(failures).toHaveLength(2)
	expect(failures.every(failure => failure.includes('direct UI string literal must come from ui/ts/lib/uiStrings.ts'))).toBe(true)
})

test('lint-ui-tsx-strings rejects direct user-facing assignments', () => {
	const failures = lintSourceText('ui/ts/components/TestDirectAssignedReason.tsx', "export function TestDirectAssignedReason() { let disabledReason: string | undefined; disabledReason = 'Settle later.'; return <Panel reason={disabledReason} /> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects assigned user-facing reasons', () => {
	const directAssignmentFailures = lintSourceText('ui/ts/components/TestAssignedReason.tsx', "export function TestAssignedReason() { let disabledReason: string | undefined; disabledReason = 'Settle later.'; return <Panel reason={disabledReason} /> }")
	const ternaryAssignmentFailures = lintSourceText(
		'ui/ts/components/TestTernaryAssignedReason.tsx',
		"export function TestTernaryAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason = shouldBlock ? 'Settle later.' : undefined; return <Panel reason={disabledReason} /> }",
	)
	const propertyAssignmentFailures = lintSourceText('ui/ts/components/TestPropertyAssignedReason.tsx', "export function TestPropertyAssignedReason() { const copy = { reason: '' }; copy.reason = 'Settle later.'; return <Panel reason={copy.reason} /> }")
	const elementAssignmentFailures = lintSourceText('ui/ts/components/TestElementAssignedReason.tsx', "export function TestElementAssignedReason() { const copy: Record<string, string> = {}; copy['aria-label'] = 'Close dialog'; return <button /> }")
	const allowedElementAssignmentFailures = lintSourceText('ui/ts/components/TestAllowedElementAssignedReason.tsx', "export function TestAllowedElementAssignedReason() { const copy: Record<string, string> = {}; copy['aria-label'] = UI_STRINGS.common.closeLabel; return <button /> }")

	expect(directAssignmentFailures).toHaveLength(1)
	expect(ternaryAssignmentFailures).toHaveLength(1)
	expect(propertyAssignmentFailures).toHaveLength(1)
	expect(elementAssignmentFailures).toHaveLength(1)
	expect(allowedElementAssignmentFailures).toHaveLength(0)
	expect(directAssignmentFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(ternaryAssignmentFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(propertyAssignmentFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(elementAssignmentFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects logical assignment expressions', () => {
	const orEqualFailures = lintSourceText('ui/ts/components/TestOrEqualAssignedReason.tsx', "export function TestOrEqualAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason ||= 'Connect wallet.'; return <Panel reason={disabledReason} /> }")
	const andEqualFailures = lintSourceText('ui/ts/components/TestAndEqualAssignedReason.tsx', "export function TestAndEqualAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason &&= 'Connect wallet.'; return <Panel reason={disabledReason} /> }")
	const nullishEqualFailures = lintSourceText('ui/ts/components/TestNullishEqualAssignedReason.tsx', "export function TestNullishEqualAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason ??= 'Connect wallet.'; return <Panel reason={disabledReason} /> }")

	expect(orEqualFailures).toHaveLength(1)
	expect(andEqualFailures).toHaveLength(1)
	expect(nullishEqualFailures).toHaveLength(1)
	expect(orEqualFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(andEqualFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(nullishEqualFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings rejects assigned content variables', () => {
	const declarationFailures = lintSourceText('ui/ts/components/TestButtonContentDeclaration.tsx', "export function TestButtonContentDeclaration() { const buttonContent = 'Deploy Next Missing'; return <button>{buttonContent}</button> }")
	const assignmentFailures = lintSourceText('ui/ts/components/TestButtonContentAssignment.tsx', "export function TestButtonContentAssignment() { let buttonContent: string | undefined; buttonContent = 'Deploy Next Missing'; return <button>{buttonContent}</button> }")
	const logicalAssignmentFailures = lintSourceText(
		'ui/ts/components/TestButtonContentLogicalAssignment.tsx',
		"export function TestButtonContentLogicalAssignment({ shouldAssign }: { shouldAssign: boolean }) { let buttonContent: string | undefined; buttonContent ||= 'Deploy Next Missing'; return <button>{buttonContent}</button> }",
	)

	expect(declarationFailures).toHaveLength(1)
	expect(assignmentFailures).toHaveLength(1)
	expect(logicalAssignmentFailures).toHaveLength(1)
	expect(declarationFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(assignmentFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(logicalAssignmentFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
})

test('lint-ui-tsx-strings ignores comparison literals inside JSX expressions', () => {
	const failures = lintSourceText('ui/ts/components/TestComparison.tsx', "export function TestComparison({ view }: { view: string }) { return <>{view === 'questions' ? <span>Shown</span> : <span>Hidden</span>}</> }")

	expect(failures).toHaveLength(2)
	expect(failures.every(failure => failure.includes('JSX text must come from UI_STRINGS'))).toBe(true)
})

test('lint-ui-tsx-strings includes committed branch changes from origin/main', () => {
	const changedFiles = getChangedUiTsxFiles(args => {
		if (args.includes('origin/main...HEAD')) return 'ui/ts/components/CommittedBranchFile.tsx\n'
		return ''
	})

	expect(changedFiles).toEqual(['ui/ts/components/CommittedBranchFile.tsx'])
})

test('lint-ui-tsx-strings rejects user-facing object properties and array literals', () => {
	const objectFailures = lintSourceText('ui/ts/components/TestObjectProps.tsx', "export function TestObjectProps() { return <Panel config={{ buttonLabel: 'Save Changes', modalTitle: 'Save Changes' }} /> }")
	const arrayFailures = lintSourceText('ui/ts/components/TestArrayProps.tsx', "export function TestArrayProps() { const stepLabels = ['Review Terms']; return <List labels={['Review Terms']} /> }")
	const helperFailures = lintSourceText('ui/ts/components/TestHelperReturn.tsx', "export function TestHelperReturn() { function getTitle() { return 'Save Changes' } return <Panel /> }")
	const callFailures = lintSourceText('ui/ts/components/TestCallWrap.tsx', "export function TestCallWrap() { function formatLabel(label: string) { return label } return <Panel title={formatLabel('Save Changes')}><span>{String('Save Changes')}</span></Panel> }")

	expect(objectFailures).toHaveLength(2)
	expect(arrayFailures).toHaveLength(2)
	expect(helperFailures).toHaveLength(1)
	expect(callFailures).toHaveLength(2)
	expect(objectFailures.every(failure => failure.includes('direct UI string literal must come from ui/ts/lib/uiStrings.ts'))).toBe(true)
	expect(arrayFailures.every(failure => failure.includes('direct UI string literal must come from ui/ts/lib/uiStrings.ts'))).toBe(true)
	expect(helperFailures[0]).toContain('direct UI string literal must come from ui/ts/lib/uiStrings.ts')
	expect(callFailures.every(failure => failure.includes('direct UI string literal must come from ui/ts/lib/uiStrings.ts'))).toBe(true)
})
