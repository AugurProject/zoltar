import Inv12Write
import Inv08AuthorityExpressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv12
theorem assignField (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String)
    (slot index offset v : Nat) (layout : List StorageLayout) (e : Source.Expr)
    (fit : index<R) (aliasSlot : r.lookupStorageBase? name=some (.slot slot (.struct layout)))
    (field : StorageLayouts.fieldOffsetAndLayout? (Shared.norm (Shared.norm index)) 0 layout =
      some (offset,.packedScalar 0 32 false .uint256))
    (rhs : (Source.Expr.castOp .uintCleanup 256 e).eval c r=pure (.word v,r)) :
    Stmt.eval (n+1) t c r (.assign (.index (.var name) (.word index)) (.castOp .uintCleanup 256 e))=
      pure (.normal {r with state:=putAmount r.state slot offset v}) := by
  let target := LValue.index (.var name) (.word index)
  have locate (k : Nat) : Expr.resolveLValueFuel (k+2) c r target.toExpr =
      pure (.storageSlotPath slot (.struct layout) [.word index],r) := by
    have base : Expr.resolveLValueFuel (k+1) c r (.var name)=pure (.storageSlotPath slot (.struct layout) [],r) := by
      simp [Expr.resolveLValueFuel,aliasSlot]
    have ix : Expr.evalFuel (k+1) c r (.word index)=pure (.word index,r) := by
      rw [Expr.evalFuel,show normWord index=index from Nat.mod_eq_of_lt fit]
    change Expr.resolveLValueFuel (k+2) c r (.index (.var name) (.word index))=_
    rw [Expr.resolveLValueFuel,base]
    simp only [Inv08.Authority.bindPure,ix]
    rfl
  have here : target.resolveWithRuntime c r=pure (.storageSlotPath slot (.struct layout) [.word index],r) := locate _
  have storage : target.wantsMemoryRefRhs r=false := by
    simp [target,LValue.wantsMemoryRefRhs,LValue.toExpr,Expr.hasStorageRoot,Expr.hasStorageRefRoot,aliasSlot]
  change Stmt.eval _ _ _ _ (.assign target (.castOp .uintCleanup 256 e))=_
  rw [Stmt.eval]; dsimp only
  simp only [storage,Bool.false_eq_true,if_false,rhs]
  change (do match ← (target.resolveWithRuntime c r).caught with
             | .ok (dest,r') => match dest.write c r' (.word v) with
               | .ok updated => pure (Result.normal updated)
               | .error err => pure (Result.reverted r err)
             | .error err => pure (Result.reverted r err)) = _
  rw [here]
  change (match r.storeStorageBasePathWithDeepClear c (.slot slot (.struct layout)) [.word index] (.word v) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (.reverted r err)) = _
  rw [writeAmount c r slot index offset v layout field]
end Inv12
