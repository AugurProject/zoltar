export function pickFixtureProperties(fixture, keys) {
    const selectedProperties = {};
    for (const key of keys) {
        const propertyDescriptor = Object.getOwnPropertyDescriptor(fixture, key);
        if (propertyDescriptor === undefined)
            throw new Error(`Missing fixture property: ${String(key)}`);
        Object.defineProperty(selectedProperties, key, propertyDescriptor);
    }
    return selectedProperties;
}
