export function pickFixtureProperties<TFixture extends object, const TKeys extends readonly (keyof TFixture)[]>(fixture: TFixture, keys: TKeys): Pick<TFixture, TKeys[number]> {
	const selectedProperties = {} as Pick<TFixture, TKeys[number]>
	for (const key of keys) {
		const propertyDescriptor = Object.getOwnPropertyDescriptor(fixture, key)
		if (propertyDescriptor === undefined) throw new Error(`Missing fixture property: ${String(key)}`)
		Object.defineProperty(selectedProperties, key, propertyDescriptor)
	}
	return selectedProperties
}
