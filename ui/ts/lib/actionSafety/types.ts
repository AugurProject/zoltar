import type { ActionAvailability } from '../../types/components.js'
import type { ActionSafetyId } from './ids.js'

export type ActionSafetyEvaluation = {
	availability: ActionAvailability
	visible: boolean
}

export type ActionSafetyFixture<TState> = {
	expected: ActionSafetyEvaluation
	name: string
	state: TState
}

export type ActionSafetyEntry<TState = unknown> = {
	availability: (state: TState) => ActionAvailability
	fixtures: readonly ActionSafetyFixture<TState>[]
	id: ActionSafetyId
	label: string
	visibleWhen?: (state: TState) => boolean
}

export function evaluateActionSafety<TState>(entry: ActionSafetyEntry<TState>, state: TState): ActionSafetyEvaluation {
	return {
		availability: entry.availability(state),
		visible: entry.visibleWhen === undefined ? true : entry.visibleWhen(state),
	}
}
