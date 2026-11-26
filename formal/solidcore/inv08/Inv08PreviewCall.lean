import Inv08PreviewAmounts
open SolidCore.Solidity.Source Inv32Division Inv03.Bodies
namespace Inv08.Preview
set_option maxHeartbeats 1000000 in
theorem execute (n : Nat) (c : Context) (r : Runtime) (tm : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (h : Ready r.state tm) :
    let id := q r.state tm
    body.value.eval (n+62) model.core.table c (r.withFrame (frame tm 0)) =
      pure (.returned (r.withFrame (frame tm id)) [.word (payout r.state tm true),.word (payout r.state tm false),.word id]) := by
  let t := model.core.table
  let src := r.withFrame (frame tm 0)
  let id := q r.state tm
  let vs := [Value.word (payout r.state tm true),.word (payout r.state tm false),.word id]
  have F := clock (n+59) t c (root r tm 0) tm fields rfl h
  have Z := Inv32FloorStart.zero (n+59) t c (root r tm 0) tmp
  have call := findExec n c r tm fields h
  have put := Inv32Assign.scalarCast (n+59) t c (temp r tm 0 id) (temp r tm id id) "expiredId" 0 id _ _ _ rfl
    (Expiry.local48 c (temp r tm 0 id) tmp _ h.qFit rfl _ (Nat.le_succ _)) (by preview_write)
  have tail := remainder n c r tm fields h
  have inside : (block steps).value.eval (n+61) t c src.pushScope =
      pure (.returned (r.withFrame (frame tm id)).pushScope vs) :=
    Inv32FloorFastPath.blockReturned _ _ _ _ (results r tm id (value r.state tm true) (value r.state tm false)
      (value r.state tm true) (value r.state tm false)) _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ F).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ call).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ put).trans tail))))
  have P := Inv32Assign.scalarCast (n+60) t c src.pushScope src.pushScope "until" tm tm _ _ _ rfl
    (Expiry.local48 c src.pushScope "until" tm h.time rfl _ (Nat.le_succ _)) (by dsimp [src]; preview_write)
  have S : Stmt.eval (n+61) t c src.pushScope .skip = pure (.normal src.pushScope) := by rw [Stmt.eval]
  exact Inv32FloorFastPath.blockReturned _ _ _ _ (r.withFrame (frame tm id)).pushScope _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ P).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ inside)))))

private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl
theorem call (n : Nat) (c : Context) (r : Runtime) (arg : String) (targets : List String) (tm : Nat)
    (found : r.lookupLocal? arg=some (.word tm)) (fields : c.storageFields=model.core.context.storageFields)
    (h : Ready r.state tm) :
    Stmt.eval (n+63) model.core.table c r (.internalCall targets key [.var arg]) =
      internalCallAssign r targets [.word (payout r.state tm true),.word (payout r.state tm false),.word (q r.state tm)] := by
  obtain ⟨fn,linked,ps,rs,bd⟩ := link
  let empty := {r with locals := []}
  let src := empty.withFrame (frame tm 0)
  have enter : internalCallEnter? fn [.word tm] r=some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,empty,src,Runtime.withFrame]
  have args : Expr.evalRefArgList c r [.var arg] = pure ([.word tm],r) := by
    change Expr.evalRefArgListFuel (_+1) c r _ = _
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,Inv32ProductCall.wordArg _ _ _ _ found,pb]
  have E := execute n {c with checked:=true} empty tm fields h
  change Stmt.eval _ _ _ src _ = _ at E
  rw [←bd] at E
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args linked enter E]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,
    empty,Runtime.withFrame]
end Inv08.Preview
