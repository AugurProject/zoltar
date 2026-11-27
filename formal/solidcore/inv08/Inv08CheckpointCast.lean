import Inv08CheckpointShape
open SolidCore.Solidity.Source Inv32Division
namespace Inv08.Checkpoint
private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
theorem castLink : Inv32Library.LinkAt model.core.table castKey [.word "value"] [.word "_ret0"] castBody.value :=
  Inv32Library.linkAt _ _ _ _ _ (by native_decide) ((Inv32Shapes.Option_some castBody).sound _ (by native_decide))
def castFrame (r : Runtime) (tm : Nat) := r.withFrame [("value",.word tm),("_ret0",.word 0)]
private theorem compareLE (checked : Bool) (a b : Nat) (af : a<R) (bf : b<R) (order : a≤b) :
    BinaryOp.apply checked .le (.word a) (.word b)=.ok (.word 1) := by
  have cmp : BinaryOp.apply checked .le (.word a) (.word b)=.ok (.word (if a≤b then 1 else 0)) :=
    Inv32WideGuards.leWord a b af bf
  rwa [if_pos order] at cmp
set_option maxHeartbeats 500000 in
theorem castExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm : Nat) (fit : tm<2^48) :
    castBody.value.eval (n+3) t c (castFrame r tm)=pure (.returned (castFrame r tm) [.word tm]) := by
  let outer := (castFrame r tm).pushScope
  let inner := outer.pushScope
  have word : tm<R := lt_trans fit (by decide)
  have v := ReleaseQuote.readClean (localReads c inner "value" tm rfl) word
  have limit := ReleaseQuote.readClean (Authority.literal c inner (2^48-1) (by decide)) (by decide)
  have good : tm≤2^48-1 := by omega
  have op : BinaryOp.apply c.checked .le (.word tm) (.word (2^48-1))=.ok (.word 1) :=
    compareLE _ _ _ word (by decide) good
  have G := Inv32QuoteGuard.requireEval n t c inner _ true "Timestamp exceeds uint48"
    (ReleaseQuote.binary v limit .le (by intro h; cases h) (by intro h; cases h) op _ (Nat.le_succ _))
  have R' := Inv32CompareValues.retOne n t c inner (.castOp .uintCast 48 (.castOp .uintCleanup 256 (.var "value"))) tm (Authority.castBits v 48 (by decide) (by decide) fit _ (Nat.le_succ _))
  have B := Inv32FloorFastPath.blockReturned (n+1) t c outer inner _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ G).trans
    (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ R'))
  have A := Inv32FloorFastPath.cleanParamExec (n+1) t c outer "value" tm word rfl
    (by simp [outer,castFrame,Runtime.withFrame,Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,LocalEnv.assign?,Frame.assign?,Value.coerceLike?])
  have S : Stmt.eval (n+2) t c outer .skip=pure (.normal outer) := by rw [Stmt.eval]
  exact Inv32FloorFastPath.blockReturned _ t c _ outer _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ B)))
theorem castCall (n : Nat) (c : Context) (r : Runtime) (arg : String) (targets : List String) (tm : Nat)
    (T : r.lookupLocal? arg=some (.word tm)) (fit : tm<2^48) :
    Stmt.eval (n+4) model.core.table c r (.internalCall targets castKey [.var arg]) =
      internalCallAssign r targets [.word tm] := by
  obtain ⟨fn,link,ps,rs,bd⟩ := castLink
  let empty := {r with locals:=[]}
  let src := castFrame empty tm
  have enter : internalCallEnter? fn [.word tm] r=some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,castFrame,empty,src,Runtime.withFrame]
  have args : Expr.evalRefArgList c r [.var arg]=pure ([.word tm],r) := by
    change Expr.evalRefArgListFuel (_+1) c r _ = _
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ T,pb]
  have E := castExec n model.core.table {c with checked:=true} empty tm fit
  change Stmt.eval _ _ _ src _ = _ at E
  rw [←bd] at E
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args link enter E]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,
    empty,castFrame,Runtime.withFrame]
end Inv08.Checkpoint
