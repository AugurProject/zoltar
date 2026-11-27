import Inv39PermitTerms
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
theorem requireOnly (n : Nat) (c : Context) (t : FunctionTable) (r : Runtime) (cond : Source.Expr) (reason : Option String)
    (read : Frame.ReadOnly cond) :
    Fold.Ensures (Stmt.eval (n+1) t c r (.requireStmt cond reason)) (normal (·=r)) := by
  rw [Stmt.eval]; apply Fold.bind (Q:=normal (·=r)) (Fold.fromFrame (Frame.caught (read _ c r)))
  rintro (err|⟨v,mid⟩) eq
  · exact Fold.pureValue (Result.reverted r _) _ trivial
  · change mid=r at eq; subst mid; dsimp only
    split <;> first | exact Fold.pureValue (Result.reverted r _) _ trivial | skip
    split <;> first | exact Fold.pureValue (Result.normal r) _ rfl | skip
    cases reason <;> exact Fold.pureValue (Result.reverted r _) _ trivial
theorem grants (n : Nat) (c : Context) (r : Runtime) (o sp v : Nat) (ow : o<2^160) (sw : sp<2^160) (fit : v<R)
    (O : r.lookupLocal? "owner"=some (.word o)) (S : r.lookupLocal? "spender"=some (.word sp)) (V : r.lookupLocal? "value"=some (.word v))
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls) :
    Fold.Ensures (Stmt.eval (n+13) model.core.table c r grant.value) (normal fun q=>q.state.storage=(r.state.storeSlot (Allowance.slot o sp) v).storage) := by
  let ready := Allowance.three r o sp v
  have sender : (r.pushScope.declareLocal "_ic_arg_0" (.word o)).lookupLocal? "spender"=some (.word sp) := S
  obtain ⟨done,fail|⟨ok,_,store⟩⟩ := Allowance.approve3Call n c ready o sp v "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" rfl rfl rfl ow sw fit fields events
  · rw [show grant.value=(Allowance.prep "owner" "spender" Allowance.approve3Key).value from rfl,
      Allowance.prepDenied (n+11) c r _ _ _ _ _ _ O sender V fit _ _ fail]; exact Fold.pureValue (Result.reverted _ _) _ trivial
  · rw [show grant.value=(Allowance.prep "owner" "spender" Allowance.approve3Key).value from rfl,
      Allowance.prepOK (n+11) c r _ _ _ _ _ _ O sender V fit _ ok]; exact Fold.pureValue (Result.normal _) _ store
end Inv39.Auth
