import Inv32Choice
open SolidCore.Solidity.Source
namespace Inv32Blocks
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem one (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (s : Stmt)
    (run : Stmt.eval n t c r.pushScope s = pure (.normal next)) :
    Stmt.eval (n+1) t c r (.block [s]) = pure (.normal next.popScope) := by
  rw [Stmt.eval]; dsimp only
  rw [Stmt.evalList, run]
  simp only [pb, Stmt.evalList]
  rfl

theorem skips (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (s : Stmt)
    (run : Stmt.eval (n+1) t c r.pushScope s = pure (.normal next)) :
    Stmt.eval (n+2) t c r (.block [.skip,.skip,s]) = pure (.normal next.popScope) := by
  rw [Stmt.eval]; dsimp only
  have skip : Stmt.eval (n+1) t c r.pushScope .skip = pure (.normal r.pushScope) := by rw [Stmt.eval]
  simp only [Stmt.evalList,skip,run,pb]
  rfl

theorem branch (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (cond : Expr)
    (yes no : Stmt) (b : Bool) (test : cond.eval c r = pure (.word (boolWord b),r)) :
    Stmt.eval (n+1) t c r (.ifElse cond yes no) = Stmt.eval n t c r (if b then yes else no) := by
  rw [Stmt.eval]; dsimp only; rw [test]
  cases b <;> rfl
end Inv32Blocks
