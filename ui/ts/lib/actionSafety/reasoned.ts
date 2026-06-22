import { createActionAvailability } from '../actionAvailability.js'
import type { ActionSafetyEntry, ActionSafetyFixture } from './types.js'
import type { ActionSafetyId } from './ids.js'

export type ReasonedActionSafetyState = {
	reason?: string
	visible?: boolean
}

export function createReasonedActionSafetyFixtures(label: string): readonly ActionSafetyFixture<ReasonedActionSafetyState>[] {
	return [
		{
			name: 'blocked',
			state: { reason: `${label} blocked` },
			expected: {
				availability: { disabled: true, reason: `${label} blocked` },
				visible: true,
			},
		},
		{
			name: 'enabled',
			state: {},
			expected: {
				availability: { disabled: false, reason: undefined },
				visible: true,
			},
		},
		{
			name: 'hidden',
			state: { visible: false },
			expected: {
				availability: { disabled: false, reason: undefined },
				visible: false,
			},
		},
	] as const
}

export function createReasonedActionSafetyEntry(id: ActionSafetyId, label: string, fixtures: readonly ActionSafetyFixture<ReasonedActionSafetyState>[]): ActionSafetyEntry<ReasonedActionSafetyState> {
	return {
		id,
		label,
		fixtures,
		availability: state => createActionAvailability(state.reason),
		visibleWhen: state => state.visible !== false,
	}
}
