export declare function pickFixtureProperties<TFixture extends object, const TKeys extends readonly (keyof TFixture)[]>(fixture: TFixture, keys: TKeys): Pick<TFixture, TKeys[number]>;
