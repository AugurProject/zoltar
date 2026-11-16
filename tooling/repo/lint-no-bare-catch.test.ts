import { expect, test } from 'bun:test'
import { findCatchFindingsInSource } from './lint-no-bare-catch.mts'

const reasons = (source: string, file = 'example.ts') => findCatchFindingsInSource(file, source).map(finding => finding.reason)

test('a catch without a binding is reported at its position', () => {
	const source = ['try {', '\trun()', '} catch {', '\trecover()', '}', ''].join('\n')
	expect(findCatchFindingsInSource('example.ts', source)).toEqual([{ column: 3, file: 'example.ts', line: 3, reason: 'missing-binding' }])
})

test('a binding the handler never reads is reported', () => {
	expect(reasons('try { run() } catch (error) { recover() }')).toEqual(['unused-binding'])
})

test('a handler that rethrows only values that are not Error instances swallows every real error', () => {
	expect(reasons('try { run() } catch (error) { if (!(error instanceof Error)) throw error }')).toEqual(['general-error-swallow'])
	expect(reasons("try { run() } catch (error) { if (!(error instanceof Error) && retryable) throw error\nlog('ignored') }")).toEqual(['general-error-swallow'])
})

test('handlers that narrow to a specific error or use the binding are accepted', () => {
	expect(reasons('try { run() } catch (error) { if (!(error instanceof TimeoutError)) throw error }')).toEqual([])
	expect(reasons("try { run() } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return\nthrow error }")).toEqual([])
	expect(reasons('try { run() } catch (error) { report(error) }')).toEqual([])
	expect(reasons('try { run() } catch (error) { if (!(error instanceof Error)) throw error\nreport(error) }')).toEqual(['general-error-swallow'])
})

test('nested handlers are each inspected and TSX sources parse', () => {
	const nested = 'try { run() } catch (outer) { try { report(outer) } catch { recover() } }'
	expect(reasons(nested)).toEqual(['missing-binding'])
	expect(reasons('export const Example = () => { try { return <p>{run()}</p> } catch (error) { return <p /> } }', 'Example.tsx')).toEqual(['unused-binding'])
})
