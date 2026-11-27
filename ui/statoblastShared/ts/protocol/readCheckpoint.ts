const readCheckpointLifetimeMilliseconds = 60_000

/** Reuse short-lived work without claiming that an old block was just observed. */
export function isReadCheckpointRecent(observedAt: number) {
	const age = Date.now() - observedAt
	return age >= 0 && age < readCheckpointLifetimeMilliseconds
}
