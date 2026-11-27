import SolidCore.Solidity.Checked

open SolidCore.Solidity
namespace CallTypesRegression

-- The importer materializes this cast from solc's resolved uint48 parameter.
def typedZero : Expr := .call (.typeName (.uint 48)) [.positional (.literal (.number "0"))]

theorem explicitTypeRetained :
    (Executable.Expr.abiTy? [] typedZero == some (.uint 48)) = true := by native_decide

theorem declaredArgumentAccepted :
    (Executable.Expr.toAbiEncodeArgAgainst? [] (.uint 48) typedZero).isSome = true := by native_decide

-- Independently checked against solc methodIdentifiers by test_call_types.py.
theorem exactSelector :
    Source.ABI.selectorFromSignature "securityPoolTimeForNative(uint248,uint48)" = 0x2f88e645 := by native_decide

#print axioms explicitTypeRetained
#print axioms declaredArgumentAccepted
#print axioms exactSelector
end CallTypesRegression
