export function assertNever(value) {
    throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`);
}
//# sourceMappingURL=assert.js.map