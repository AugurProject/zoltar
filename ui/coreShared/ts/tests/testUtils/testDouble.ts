/**
 * The one sanctioned widening of a partial stand-in to the full interface a test target expects.
 * Members the test does not supply are absent at runtime, so pass only what the code under test reaches.
 * Everywhere else `as unknown as` is rejected by `bun run check:static`.
 */
export function testDouble<TTarget>(standIn: object): TTarget {
	return standIn as unknown as TTarget
}
