/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getSelectedPoolCardTitle, getSelectedPoolLookupDisplay, isForkWorkflowDisabled, shouldShowSelectedPoolWorkflowDetails } from '../components/SecurityPoolWorkflowSection.js'

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

	void test('adds only the empty selected-pool state on top of loadable lookup states', () => {
		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: false,
				selectedPoolLookupState: 'unknown',
			}),
		).toBe('empty')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'unknown',
			}),
		).toBe('unknown')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'loading',
			}),
		).toBe('loading')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'missing',
			}),
		).toBe('missing')

		expect(
			getSelectedPoolLookupDisplay({
				hasSelectedPoolAddress: true,
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

	void test('disables the fork workflow only while the selected pool remains operational', () => {
		expect(isForkWorkflowDisabled(undefined)).toBe(true)
		expect(isForkWorkflowDisabled('operational')).toBe(true)
		expect(isForkWorkflowDisabled('poolForked')).toBe(false)
		expect(isForkWorkflowDisabled('forkMigration')).toBe(false)
		expect(isForkWorkflowDisabled('forkTruthAuction')).toBe(false)
	})
})
