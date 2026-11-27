import Inv05Precision
import Inv32Normal
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32QuoteExpr Inv32Actions Inv32Normal
namespace Inv05
def permitted (cash units net a : Nat) : Bool := a≠0 && (cash-1)*10^9≤a*net/units
def reason := "Settlement purchase below unit precision"
def tailCode : List Stmt := [
  .varDecl .bool flag (some (nz "added").value),
  .ifElse (.var flag) precisionCheck.value .skip,
  .requireStmt (.var flag) (some reason)]

theorem guardResult (f : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (term : Expr) (why : String)
    (b : Bool) (read : term.eval c r = pure (.word (boolWord b),r)) :
    Stmt.eval (f+1) t c r (.requireStmt term (some why)) =
      pure (if b then .normal r else .reverted r (.error why)) := by
  rw [Stmt.eval]; dsimp only; rw [read]; cases b <;> rfl

theorem finish (f : Nat) (c : Context) (r : Runtime) (cash units net a : Nat)
    (hc : cash<R) (hu : units<R) (hn : net<R) (ha : a<R) (pos : 0<cash) (up : 0<units)
    (fits : cash*10^9<R) (bound : a*net/units<R) :
    let ok := permitted cash units net a
    Ends (if ok then some (marked r cash units net a 1) else none)
      (Stmt.evalList (f+18) Inv03.model.core.table c (minted r cash units net a) tailCode) := by
  let t := Inv03.model.core.table
  let m := minted r cash units net a
  let st := marked r cash units net a
  let has := decide (a≠0)
  let ok := permitted cash units net a
  have decl := Inv32Hoist.declEval (f+17) t c m flag .bool (nz "added").value (boolWord has)
    (nonzero c m "added" a ha rfl) (by cases has <;> rfl)
  have branch := Inv32Blocks.branch (f+17) t c (st (boolWord has)) (.var flag) precisionCheck.value .skip has
    (Inv32Guards.readWord _ _ _ _ _ rfl)
  have chosen : Stmt.eval (f+18) t c (st (boolWord has)) (.ifElse (.var flag) precisionCheck.value .skip) =
      pure (.normal (st (boolWord ok))) := by
    rw [branch]
    by_cases zero : a=0
    · simp only [has,ok,permitted,zero,ne_eq,not_true_eq_false,decide_false,Bool.false_and,Bool.false_eq_true,if_false]
      rw [Stmt.eval]
    · simp only [has,ok,permitted,show decide (a≠0)=true from decide_eq_true zero,Bool.true_and,if_true]
      exact precision f c r cash units net a hc hu hn ha pos up fits bound
  have last := guardResult (f+17) t c (st (boolWord ok)) (.var flag) reason ok
    (Inv32Guards.readWord _ _ _ _ _ rfl)
  dsimp only
  unfold tailCode
  refine step _ _ _ _ _ _ _ _ decl (step _ _ _ _ _ _ _ _ chosen ?_)
  change Ends (if ok then some (st 1) else none) _
  cases H : ok
  · rw [H] at last
    exact reject _ _ _ _ _ [] ⟨_,_,last⟩
  · rw [H] at last
    exact (seqStep _ _ _ _ _ _ [] last).trans (by rw [Stmt.evalList]; rfl)
end Inv05
