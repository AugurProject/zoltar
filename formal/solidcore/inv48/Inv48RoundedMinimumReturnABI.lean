import Inv48RoundedMinimumReturnFinish
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RoundedMinimumReturn
set_option maxRecDepth 65536
set_option maxHeartbeats 400000
set_option linter.unusedSimpArgs false

theorem abi (contract : Contract) (fn : FunctionDef)
    (returns : fn.returns = [⟨"_ret0",.uint256,false⟩]) (state : State) (final : Runtime) (v : Nat) (_fit : v < Inv32Division.R)
    (out : ABI.AbiCallResult)
    (finished : Inv48.RequestDispatch.finish contract fn state
      (.returned final [.word v]) = .ok out) :
    out.output = ABI.encodeWord v := by
  have coerced : fn.coerceReturnValues final [.word v] = .ok [.word v] := by
    rw [FunctionDef.coerceReturnValues,returns]
    simp [coerceReturnBindings,coerceReturnBindings.coerce,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  have cr : fn.callBodyResult state (.returned final [.word v]) =
      .returned {final.state with constructorOutput? := none} [.word v] := by
    change (match fn.coerceReturnValues final [.word v] with
      | .ok values => CallResult.returned {final.state with constructorOutput? := none}
          (values.map Value.untagFixedBytes)
      | .error err => .reverted state err.untagFixedBytes) = _
    rw [coerced]
    simp only [List.map_cons,List.map_nil,Value.untagFixedBytes]
  unfold Inv48.RequestDispatch.finish at finished
  rw [cr,ABI.Contract.encodeCalldataResult?,returns] at finished
  change (match (do
    let bytes ← ABI.encodeValues? [.uint256] [.word v]
    some (ABI.AbiCallResult.mk true false bytes {final.state with constructorOutput? := none})) with
    | some result => Except.ok result
    | none => Except.error SolidityFailure.outOfFuel) = .ok out at finished
  have encode : ABI.encodeValues? [.uint256] [.word v] = some (ABI.encodeWord v) := by
    simp [ABI.encodeValues?,ABI.encodeValuesAux?,ABI.encodeStaticValue?,
      ABI.Ty.listAbiHeadWords?,ABI.Ty.abiHeadWords?,ABI.Ty.staticAbiHeadWords?,ABI.Ty.isDynamicAbi]
  rw [encode] at finished
  simp only [Bind.bind,Option.bind,Except.ok.injEq] at finished
  have outputEq := congrArg ABI.AbiCallResult.output finished.symm
  exact outputEq

#print axioms abi
end Inv48.RoundedMinimumReturn
