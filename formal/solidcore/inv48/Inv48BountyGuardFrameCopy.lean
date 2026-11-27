import Inv48BountyGuardFrameCall
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BountyGuardFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def hoist := "_sol_hoist_0"

theorem copyOuter (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (v arg : Value) (tail : LocalEnv)
    (shape : r.locals = [[(ret,v),("_ic_arg_0",arg)],[(hoist,.word 0)]] ++ tail)
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+1) t c r (.assign (.var hoist) (.var ret))) trace (.normal final)) :
    ∃ w, final.locals = [[(ret,v),("_ic_arg_0",arg)],[(hoist,w)]] ++ tail := by
  have lookup : r.lookupLocal? hoist = some (.word 0) := by
    simp [Runtime.lookupLocal?,shape,LocalEnv.lookup?,Frame.lookup?,ret,hoist]
  have base : r.lookupStorageBase? hoist = none := by simp [Runtime.lookupStorageBase?,lookup]
  have mem : r.lookupMemoryRef? hoist = none := by
    change (match r.lookupLocal? hoist with | some (.memoryRef id) => some id | _ => none) = none
    rw [lookup]
  have wants : (LValue.var hoist).wantsMemoryRefRhs r = false := by
    simp [LValue.wantsMemoryRefRhs,LValue.toExpr,Expr.hasStorageRoot,Expr.hasStorageRefRoot,base,Runtime.lookupLocal?,lookup,mem]
  obtain ⟨result,tree⟩ := varFrozen c r ret
  rw [Stmt.eval] at run
  dsimp only at run
  rw [wants] at run
  simp only [Bool.false_eq_true,↓reduceIte,tree,mem] at run
  cases result with
  | error err => cases err <;> cases run
  | ok value =>
    have resolve : (LValue.var hoist).resolveWithRuntime c r = pure (.local hoist,r) := by
      simp [LValue.resolveWithRuntime,LValue.toExpr,Expr.resolveLValue,Expr.resolveLValueFuel,base,lookup]
    change ExecutesOK (((LValue.var hoist).resolveWithRuntime c r).caught >>= _) trace (Result.normal final) at run
    rw [resolve] at run
    change ExecutesOK (match (if (r.lookupStorageBase? ret).isSome then
      (ResolvedLValue.local hoist).write c r value else
      (ResolvedLValue.local hoist).write c r value) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)) trace (Result.normal final) at run
    simp only [ite_self] at run

    simp only [ResolvedLValue.write,Runtime.assignLocal?,lookup] at run
    cases coerce : (Value.word 0).coerceLike? value with
    | none =>
      simp only [coerce] at run
      have h := pureResult _ _ _ run; cases h.2
    | some w =>
      simp only [coerce,shape,LocalEnv.assign?,Frame.assign?,ret,hoist,↓reduceIte] at run
      have h := pureResult _ _ _ run
      cases h.2
      exact ⟨w,rfl⟩
end Inv48.BountyGuardFrame
