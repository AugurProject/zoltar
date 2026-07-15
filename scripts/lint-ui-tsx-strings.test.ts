import { expect, test } from 'bun:test'
import { getChangedLineNumbers, getChangedUiTsxFiles, lintCopySourceText, lintSourceText } from './lint-ui-tsx-strings.mts'

test('lint-ui-tsx-strings enforces semantic copy names, template parameters, and ellipsis style', () => {
	const legacyNameFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const UI_STRING_LOADING = 'Loading…'")
	const longNameFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const simulationModeUsesBrowserLocalContractStateTransactionsDoNotAffectAPublicNetwork = 'Detail.'")
	const positionalParameterFailures = lintCopySourceText('ui/ts/copy/test.ts', 'export const formatDetail = (value0: string) => `Detail ${value0}`')
	const ellipsisFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const loading = 'Loading...'")

	expect(legacyNameFailures).toHaveLength(1)
	expect(longNameFailures).toHaveLength(1)
	expect(positionalParameterFailures).toHaveLength(1)
	expect(ellipsisFailures).toHaveLength(1)
})

test('lint-ui-tsx-strings allows only recognized three-period truncation', () => {
	const hexPlaceholderFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const hashPlaceholder = '0x...'")
	const valueTruncationFailures = lintCopySourceText('ui/ts/copy/test.ts', 'export const formatTruncatedValue = (value: string, byteCount: number) => `${value}... (${byteCount} bytes)`')
	const mixedPendingFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const loadingHash = 'Loading... 0x...'")
	const embeddedHexFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const malformedHash = 'prefix0x...suffix'")

	expect(hexPlaceholderFailures).toHaveLength(0)
	expect(valueTruncationFailures).toHaveLength(0)
	expect(mixedPendingFailures).toHaveLength(1)
	expect(embeddedHexFailures).toHaveLength(1)
})

test('lint-ui-tsx-strings rejects short sentence names and function-declaration bypasses', () => {
	const sentenceNameFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const thisVaultDoesNotExistDepositRepToCreateIt = 'This vault does not exist.'")
	const shortErrorNameFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const failedToLoadReports = 'Failed to load reports.'")
	const emptySentenceNameFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const noCorruptedStatesWereFound = 'No corrupted states were found.'")
	const sentenceTemplateNameFailures = lintCopySourceText('ui/ts/copy/test.ts', 'export const formatCustomStateValueBasedOnValue = (stateName: string) => `State ${stateName}`')
	const missingErrorRoleFailures = lintCopySourceText('ui/ts/copy/test.ts', 'export const formatMissingSavedState = (stateName: string) => `Missing ${stateName}.`')
	const invalidStateNameFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const selectedTickIsInvalid = 'Selected tick is invalid.'")
	const requirementSentenceNameFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const approvalAmountMustBeADecimalNumber = 'Approval amount must be a decimal number.'")
	const functionDeclarationFailures = lintCopySourceText('ui/ts/copy/test.ts', 'export function UI_TEMPLATE_BAD(value0: string) { return `Detail ${value0}` }')

	expect(sentenceNameFailures).toHaveLength(1)
	expect(shortErrorNameFailures).toHaveLength(1)
	expect(emptySentenceNameFailures).toHaveLength(1)
	expect(sentenceTemplateNameFailures).toHaveLength(1)
	expect(missingErrorRoleFailures).toHaveLength(1)
	expect(invalidStateNameFailures).toHaveLength(1)
	expect(requirementSentenceNameFailures).toHaveLength(1)
	expect(functionDeclarationFailures).toHaveLength(2)
})

test('lint-ui-tsx-strings enforces fragment roles and prose punctuation', () => {
	const unnamedFragmentFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const amountCopy = 'Amount: '")
	const namedFragmentFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const amountLead = 'Amount: '")
	const missingPunctuationFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const poolSearchHelpText = 'Filter this page by pool address'")
	const punctuatedFailures = lintCopySourceText('ui/ts/copy/test.ts', "export const poolSearchHelpText = 'Filter this page by pool address.'")

	expect(unnamedFragmentFailures).toHaveLength(1)
	expect(namedFragmentFailures).toHaveLength(0)
	expect(missingPunctuationFailures).toHaveLength(1)
	expect(punctuatedFailures).toHaveLength(0)
})

test('lint-ui-tsx-strings rejects interpolated template literals in user-facing props', () => {
	const failures = lintSourceText('ui/ts/components/TestComponent.tsx', 'export function TestComponent({ source }: { source: string }) { return <Notice detail={`Ignored ${source} RPC override`} /> }')

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestComponent.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects direct DOM aria-label literals', () => {
	const failures = lintSourceText('ui/ts/components/TestButton.tsx', "export function TestButton() { return <button aria-label='Close'>x</button> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestButton.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects direct DOM alt literals', () => {
	const failures = lintSourceText('ui/ts/components/TestImage.tsx', "export function TestImage() { return <img alt='Close dialog' /> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestImage.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects direct aria text literals', () => {
	const failures = lintSourceText('ui/ts/components/TestAriaText.tsx', "export function TestAriaText() { return <input aria-valuetext='Loading price' aria-description='Describe dialog' aria-placeholder='Loading price' aria-roledescription='Loading dialog' /> }")

	expect(failures).toHaveLength(4)
	expect(failures.every(failure => failure.includes('direct UI string literal must come from a module under ui/ts/copy'))).toBe(true)
})

test('lint-ui-tsx-strings rejects direct children and factory-call literals', () => {
	const childrenFailures = lintSourceText('ui/ts/components/TestChildren.tsx', "export function TestChildren() { return <Panel children='Save Changes' /> }")
	const innerHtmlFailures = lintSourceText('ui/ts/components/TestInnerHtml.tsx', "export function TestInnerHtml() { return <div dangerouslySetInnerHTML={{ __html: 'Save Changes' }} /> }")
	const factoryCallFailures = lintSourceText('ui/ts/components/TestFactoryCall.tsx', "export function TestFactoryCall() { return h('button', {}, 'Save Changes') }")

	expect(childrenFailures).toHaveLength(1)
	expect(innerHtmlFailures).toHaveLength(1)
	expect(factoryCallFailures).toHaveLength(1)
	expect(childrenFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(innerHtmlFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(factoryCallFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings ignores lowercase helper mode tokens passed to render helpers', () => {
	const bidFailures = lintSourceText('ui/ts/components/TestRenderHelperMode.tsx', "export function TestRenderHelperMode() { function renderDebtNotice() { return <>{renderTruthAuctionDebtNotice('bid')}</> } return renderDebtNotice() }")
	const settlementFailures = lintSourceText('ui/ts/components/TestRenderHelperSettlementMode.tsx', "export function TestRenderHelperSettlementMode() { const renderDebtNotice = () => <>{renderTruthAuctionDebtNotice('settlement', true)}</>; return renderDebtNotice() }")

	expect(bidFailures).toHaveLength(0)
	expect(settlementFailures).toHaveLength(0)
})

test('lint-ui-tsx-strings still rejects lowercase visible copy passed through helper calls', () => {
	const failures = lintSourceText('ui/ts/components/TestLowercaseCallHelper.tsx', "export function TestLowercaseCallHelper() { function formatUnit() { return String('minutes') } return <span>{formatUnit()}</span> }")
	const renderLabelFailures = lintSourceText('ui/ts/components/TestRenderLabelHelper.tsx', "export function TestRenderLabelHelper() { function renderNotice() { return <Panel title={renderLabel('minutes')} /> } return renderNotice() }")

	expect(failures).toHaveLength(1)
	expect(renderLabelFailures).toHaveLength(1)
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(renderLabelFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings ignores local prop-object keys that are not direct user-facing literals', () => {
	const failures = lintSourceText(
		'ui/ts/components/TestLocalPropsObject.tsx',
		"export function TestLocalPropsObject({ option }: { option: { panelId: string; reason?: string } }) { const commonProps = { 'aria-controls': option.panelId, 'aria-description': option.reason, title: option.reason } as const; return <button {...commonProps}>Open</button> }",
	)
	const jsxPayloadFailures = lintSourceText('ui/ts/components/TestJsxPayloadPropertyKeys.tsx', "export function TestJsxPayloadPropertyKeys({ option }: { option: { reason?: string } }) { return <Panel config={{ 'aria-description': option.reason }} /> }")
	const localDescriptionPropsFailures = lintSourceText(
		'ui/ts/components/TestLocalDescriptionProps.tsx',
		"export function TestLocalDescriptionProps({ option }: { option: { reason?: string } }) { const descriptionProps = { 'aria-description': option.reason } as const; return <button {...descriptionProps}>Open</button> }",
	)

	expect(failures).toHaveLength(1)
	expect(failures[0]).toContain('JSX text must come from a named UI copy export')
	expect(jsxPayloadFailures).toHaveLength(0)
	expect(localDescriptionPropsFailures).toHaveLength(1)
	expect(localDescriptionPropsFailures[0]).toContain('JSX text must come from a named UI copy export')
})

test('lint-ui-tsx-strings rejects nested user-facing object payload literals inside JSX attributes', () => {
	const objectFailures = lintSourceText('ui/ts/components/TestNestedObjectPayload.tsx', "export function TestNestedObjectPayload() { return <Panel config={{ actions: { buttonLabel: 'Save Changes' } }} /> }")
	const arrayFailures = lintSourceText('ui/ts/components/TestNestedArrayPayload.tsx', "export function TestNestedArrayPayload() { return <Panel config={{ actions: [{ modalTitle: 'Save Changes' }] }} /> }")

	expect(objectFailures).toHaveLength(1)
	expect(arrayFailures).toHaveLength(1)
	expect(objectFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(arrayFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects direct literal values in local spread props objects', () => {
	const titleFailures = lintSourceText('ui/ts/components/TestLocalSpreadTitleValue.tsx', "export function TestLocalSpreadTitleValue() { const commonProps = { title: 'Save Changes' } as const; return <button {...commonProps} /> }")
	const ariaDescriptionFailures = lintSourceText('ui/ts/components/TestLocalSpreadAriaDescriptionValue.tsx', "export function TestLocalSpreadAriaDescriptionValue() { const commonProps = { 'aria-description': 'Save Changes' } as const; return <button {...commonProps} /> }")

	expect(titleFailures).toHaveLength(1)
	expect(ariaDescriptionFailures).toHaveLength(1)
	expect(titleFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(ariaDescriptionFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
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
	expect(suffixFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(wrappedSuffixFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(wrappedAcronymFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(summaryFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(acronymTextFailures[0]).toContain('JSX text must come from a named UI copy export')
	expect(helperFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(lowercaseHelperFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
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
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects expression-wrapped single-word user-facing prop literals', () => {
	const failures = lintSourceText('ui/ts/components/TestWrappedProps.tsx', "export function TestWrappedProps() { return <Panel aria-label={'Close'} ariaLabel={'Close'} unavailableCopy={'Unavailable'} headerTitle={'Status'} loadMoreLabel={'More'} /> }")

	expect(failures).toHaveLength(5)
	expect(failures.every(failure => failure.includes('direct UI string literal must come from a module under ui/ts/copy'))).toBe(true)
})

test('lint-ui-tsx-strings rejects lowercase visible JSX text', () => {
	const failures = lintSourceText('ui/ts/components/TestText.tsx', 'export function TestText() { return <span>minutes</span> }')

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestText.tsx:')
	expect(failures[0]).toContain('JSX text must come from a named UI copy export')
})

test('lint-ui-tsx-strings rejects expression-wrapped visible JSX text', () => {
	const failures = lintSourceText('ui/ts/components/TestWrappedText.tsx', "export function TestWrappedText() { return <span>{'minutes'}</span> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestWrappedText.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects user-facing local aliases', () => {
	const failures = lintSourceText('ui/ts/components/TestAlias.tsx', "export function TestAlias() { const closeLabel = 'Close'; return <button aria-label={closeLabel}>x</button> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestAlias.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects user-facing default prop values', () => {
	const failures = lintSourceText('ui/ts/components/TestDefaultProp.tsx', "export function TestDefaultProp({ loadMoreLabel = 'Load More' }: { loadMoreLabel?: string }) { return <button>{loadMoreLabel}</button> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toStartWith('ui/ts/components/TestDefaultProp.tsx:')
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects user-facing assignment expressions', () => {
	const failures = lintSourceText('ui/ts/components/TestAssignedReason.tsx', "export function TestAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason = shouldBlock ? 'Settle later.' : 'Settle now.'; return <Panel reason={disabledReason} /> }")

	expect(failures).toHaveLength(2)
	expect(failures.every(failure => failure.includes('direct UI string literal must come from a module under ui/ts/copy'))).toBe(true)
})

test('lint-ui-tsx-strings rejects direct user-facing assignments', () => {
	const failures = lintSourceText('ui/ts/components/TestDirectAssignedReason.tsx', "export function TestDirectAssignedReason() { let disabledReason: string | undefined; disabledReason = 'Settle later.'; return <Panel reason={disabledReason} /> }")

	expect(failures).toHaveLength(1)
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects assigned user-facing reasons', () => {
	const directAssignmentFailures = lintSourceText('ui/ts/components/TestAssignedReason.tsx', "export function TestAssignedReason() { let disabledReason: string | undefined; disabledReason = 'Settle later.'; return <Panel reason={disabledReason} /> }")
	const ternaryAssignmentFailures = lintSourceText(
		'ui/ts/components/TestTernaryAssignedReason.tsx',
		"export function TestTernaryAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason = shouldBlock ? 'Settle later.' : undefined; return <Panel reason={disabledReason} /> }",
	)
	const propertyAssignmentFailures = lintSourceText('ui/ts/components/TestPropertyAssignedReason.tsx', "export function TestPropertyAssignedReason() { const copy = { reason: '' }; copy.reason = 'Settle later.'; return <Panel reason={copy.reason} /> }")
	const elementAssignmentFailures = lintSourceText('ui/ts/components/TestElementAssignedReason.tsx', "export function TestElementAssignedReason() { const copy: Record<string, string> = {}; copy['aria-label'] = 'Close dialog'; return <button /> }")
	const allowedElementAssignmentFailures = lintSourceText('ui/ts/components/TestAllowedElementAssignedReason.tsx', "export function TestAllowedElementAssignedReason() { const copy: Record<string, string> = {}; copy['aria-label'] = UI_STRING_CLOSE; return <button /> }")

	expect(directAssignmentFailures).toHaveLength(1)
	expect(ternaryAssignmentFailures).toHaveLength(1)
	expect(propertyAssignmentFailures).toHaveLength(1)
	expect(elementAssignmentFailures).toHaveLength(1)
	expect(allowedElementAssignmentFailures).toHaveLength(0)
	expect(directAssignmentFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(ternaryAssignmentFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(propertyAssignmentFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(elementAssignmentFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings rejects logical assignment expressions', () => {
	const orEqualFailures = lintSourceText('ui/ts/components/TestOrEqualAssignedReason.tsx', "export function TestOrEqualAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason ||= 'Connect wallet.'; return <Panel reason={disabledReason} /> }")
	const andEqualFailures = lintSourceText('ui/ts/components/TestAndEqualAssignedReason.tsx', "export function TestAndEqualAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason &&= 'Connect wallet.'; return <Panel reason={disabledReason} /> }")
	const nullishEqualFailures = lintSourceText('ui/ts/components/TestNullishEqualAssignedReason.tsx', "export function TestNullishEqualAssignedReason({ shouldBlock }: { shouldBlock: boolean }) { let disabledReason: string | undefined; disabledReason ??= 'Connect wallet.'; return <Panel reason={disabledReason} /> }")

	expect(orEqualFailures).toHaveLength(1)
	expect(andEqualFailures).toHaveLength(1)
	expect(nullishEqualFailures).toHaveLength(1)
	expect(orEqualFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(andEqualFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(nullishEqualFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
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
	expect(declarationFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(assignmentFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(logicalAssignmentFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings ignores comparison literals inside JSX expressions', () => {
	const failures = lintSourceText('ui/ts/components/TestComparison.tsx', "export function TestComparison({ view }: { view: string }) { return <>{view === 'questions' ? <span>Shown</span> : <span>Hidden</span>}</> }")

	expect(failures).toHaveLength(2)
	expect(failures.every(failure => failure.includes('JSX text must come from a named UI copy export'))).toBe(true)
})

test('lint-ui-tsx-strings includes committed branch changes from origin/main', () => {
	const changedFiles = getChangedUiTsxFiles(args => {
		if (args.includes('origin/main...HEAD')) return 'ui/ts/components/CommittedBranchFile.tsx\n'
		return ''
	})

	expect(changedFiles).toEqual(['ui/ts/components/CommittedBranchFile.tsx'])
})

test('lint-ui-tsx-strings only reports direct copy on changed lines for tracked files', () => {
	const failures = lintSourceText('ui/ts/components/TestChangedLines.tsx', ['export function TestChangedLines() {', "\treturn <Panel title='Legacy Title' detail='Changed detail' />", '}'].join('\n'), new Set([2]))

	expect(failures).toHaveLength(2)
	expect(failures.every(failure => failure.startsWith('ui/ts/components/TestChangedLines.tsx:2:'))).toBe(true)
})

test('lint-ui-tsx-strings reports multiline JSX text when a later tracked line changes', () => {
	const failures = lintSourceText('ui/ts/components/TestMultilineJsxText.tsx', ['export function TestMultilineJsxText() {', '\treturn <span>', '\t\tLegacy', '\t\tCopy', '\t</span>', '}'].join('\n'), new Set([4]))

	expect(failures).toHaveLength(1)
	expect(failures[0]).toContain('JSX text must come from a named UI copy export')
})

test('lint-ui-tsx-strings reports multiline template literals when a later tracked line changes', () => {
	const failures = lintSourceText('ui/ts/components/TestMultilineTemplate.tsx', ['export function TestMultilineTemplate() {', '\treturn <Panel detail={`Legacy', '\t\tCopy`} />', '}'].join('\n'), new Set([3]))

	expect(failures).toHaveLength(1)
	expect(failures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
})

test('lint-ui-tsx-strings scans all lines for untracked files', () => {
	const changedLines = getChangedLineNumbers('ui/ts/components/NewComponent.tsx', args => {
		if (args[0] === 'ls-files') return 'ui/ts/components/NewComponent.tsx'
		return ''
	})

	expect(changedLines).toBeUndefined()
})

test('lint-ui-tsx-strings derives tracked changed lines from the merge-base diff against the current worktree', () => {
	const changedLines = getChangedLineNumbers('ui/ts/components/TestTrackedComponent.tsx', args => {
		if (args[0] === 'ls-files') return ''
		if (args[0] === 'merge-base') return 'abc123'
		if (args[0] === 'diff') {
			expect(args).toEqual(['diff', '--no-color', '--unified=0', 'abc123', '--', 'ui/ts/components/TestTrackedComponent.tsx'])
			return '@@ -10,0 +14,2 @@\n'
		}
		throw new Error(`unexpected git args: ${args.join(' ')}`)
	})

	expect(changedLines).toEqual(new Set([14, 15]))
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
	expect(objectFailures.every(failure => failure.includes('direct UI string literal must come from a module under ui/ts/copy'))).toBe(true)
	expect(arrayFailures.every(failure => failure.includes('direct UI string literal must come from a module under ui/ts/copy'))).toBe(true)
	expect(helperFailures[0]).toContain('direct UI string literal must come from a module under ui/ts/copy')
	expect(callFailures.every(failure => failure.includes('direct UI string literal must come from a module under ui/ts/copy'))).toBe(true)
})
