/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getSelectedPoolCardTitle, getSelectedPoolLookupDisplay, shouldShowSelectedPoolWorkflowDetails } from '../components/SecurityPoolWorkflowSection.js'

void describe('selected pool workflow lookup state', () => {
	void test('uses a stable card title until a pool resolves', () => {
		expect(
			getSelectedPoolCardTitle({
				hasSelectedPoolAddress: false,
				resolvedPoolTitle: undefined,
			}),
		).toBe('Select a security pool')

		expect(
			getSelectedPoolCardTitle({
				hasSelectedPoolAddress: true,
				resolvedPoolTitle: undefined,
			}),
		).toBe('Selected Pool')

		expect(
			getSelectedPoolCardTitle({
				hasSelectedPoolAddress: true,
				resolvedPoolTitle: 'Will REP exceed threshold?',
			}),
		).toBe('Will REP exceed threshold?')
	})

	void test('maps selected pool lookup states to the redesigned display modes', () => {
		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: false,
				selectedPoolExists: false,
				selectedPoolLookupState: 'unknown',
			}),
		).toBe('empty')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolExists: false,
				selectedPoolLookupState: 'unknown',
			}),
		).toBe('quiet')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolExists: false,
				selectedPoolLookupState: 'loading',
			}),
		).toBe('loading')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolExists: false,
				selectedPoolLookupState: 'missing',
			}),
		).toBe('missing')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolExists: true,
				selectedPoolLookupState: 'ready',
			}),
		).toBe('ready')
	})
})

void describe('selected pool workflow visibility', () => {
	void test('shows workflow details only for a resolved pool in the active universe', () => {
		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: false,
				selectedPoolExists: false,
				selectedPoolUniverseMismatch: false,
			}),
		).toBe(false)

		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: true,
				selectedPoolExists: false,
				selectedPoolUniverseMismatch: false,
			}),
		).toBe(false)

		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: true,
				selectedPoolExists: true,
				selectedPoolUniverseMismatch: true,
			}),
		).toBe(false)

		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: true,
				selectedPoolExists: true,
				selectedPoolUniverseMismatch: false,
			}),
		).toBe(true)
	})
})
