import Inv32FloorCall
import Inv32ExactPanic
open SolidCore.Solidity.Source Inv32Division
namespace Inv32Revert
theorem blockRevert (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (xs : List Stmt)
    (e : RevertData) (h : Stmt.evalList n t c r.pushScope xs = pure (.reverted next e)) :
    Stmt.eval (n+1) t c r (.block xs) = pure (.reverted next.popScope e) := by
  rw [Stmt.eval]; dsimp only; rw [h]; rfl
theorem stop (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (s : Stmt)
    (ss : List Stmt) (e : RevertData) (h : Stmt.eval n t c r s = pure (.reverted next e)) :
    Stmt.evalList n t c r (s::ss) = pure (.reverted next e) := by rw [Stmt.evalList,h]; rfl
theorem capture (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (s : Stmt)
    (names : List String) (e : RevertData) (h : Stmt.eval n t c r s = pure (.reverted next e)) :
    Stmt.eval (n+1) t c r (.captureReturn names s) = pure (.reverted next e) := by rw [Stmt.eval]; dsimp only; rw [h]; rfl

private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem custom (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) (v : Nat)
    (code : r.lookupLocal? "code" = some (.word v)) :
    ∃ e, Stmt.eval (n+1) t c r (.revert name [.var "code"]) = pure (.reverted r e) := by
  have vals : Expr.evalList c r [.var "code"] = pure ([.word v],r) := by
    unfold Expr.evalList
    simp only [Expr.listEvalFuel,Expr.orderFuel,Nat.reduceAdd,Expr.evalListFuel,
      Inv32Guards.readWord _ _ _ _ _ code,pb]
  rw [Stmt.eval]; dsimp only; rw [vals]
  change ∃ e, (match r.materializeForValueUseList c [.word v] with
    | .ok vs => match c.errorDecl? name with
      | some dec => match Ty.coerceTupleValues? dec.fields vs with
        | some coerced => pure (Result.reverted r (.fromCustom name coerced))
        | none => pure (Result.reverted r .typeMismatch)
      | none => pure (Result.reverted r (.fromCustom name vs))
    | .error err => pure (Result.reverted r err)) = (_ : SolI Result)
  split <;> try exact ⟨_,rfl⟩
  split <;> try exact ⟨_,rfl⟩
  split <;> exact ⟨_,rfl⟩
theorem panic (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat) (hv : v<R) :
    let src := r.withFrame [("code",Value.word v)]
    ∃ e, Stmt.eval (n+3) t c src Inv32Bodies.Panic.body = pure (.reverted src e) := by
  let src := r.withFrame [("code",Value.word v)]
  have A := Inv32FloorFastPath.cleanParamExec (n+1) t c src.pushScope "code" v hv rfl
    (by simp [src,Runtime.withFrame,Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,
      LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  obtain ⟨e,ev⟩ := custom n t c src.pushScope.pushScope "#yul.panic" v rfl
  have inner := blockRevert _ _ _ src.pushScope _ _ e (stop _ _ _ _ _ _ [] _ ev)
  refine ⟨e,blockRevert _ _ _ src src.pushScope _ _ ?_⟩
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ A).trans (stop _ _ _ _ _ _ [] _ inner)
end Inv32Revert
