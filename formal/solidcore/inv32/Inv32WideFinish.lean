import Inv32FactorRun
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32NewtonBody
open Inv32FactorRun Inv32NewtonSeed
namespace Inv32WideFinish
def scaled := twice (mulF (clean (localWord "high")) (clean (localWord "twos")))
def merge : Stmt := .exprStmt (.assignment (some .bitOr) (some (.uint 256)) (.var "low") scaled.core)
def resultExpr := twice (mulF (clean (localWord "low")) (clean (localWord "inverse")))
def resultAssign : Stmt := .assign (.var "result") resultExpr.core
def retExpr := clean (localWord "result")
def ret : Stmt := .returnValues [retExpr.core]
theorem tailShape : Inv32FloorStart.instructions.drop 15 =
    [merge,declaration] ++ List.replicate 6 step ++ [resultAssign,ret] := by rfl

theorem product (env : Env) (a b : String) (x y : W) (X : env a = some x.toNat) (Y : env b = some y.toNat) :
    (twice (mulF (clean (localWord a)) (clean (localWord b)))).run false env = some (x*y).toNat := by
  apply double
  exact binaryValue _ _ _ _ _ _ _ _ _ (Inv32ProductValues.cleanup (localWord a) false env _ x.isLt X)
    (Inv32ProductValues.cleanup (localWord b) false env _ y.isLt Y) (mulWord _ _)

theorem mergeExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y d hi lo rem : Nat)
    (h l tw : W) (u : c.checked = false) :
    Stmt.eval (n+1) t c (stateT r x y d h.toNat l.toNat hi lo rem tw.toNat) merge =
      pure (.normal (stateT r x y d h.toNat (l ||| h*tw).toNat hi lo rem tw.toNat)) := by
  apply Inv32Compound.stmt _ _ .bitOr _ _ _ _ l.toNat (h*tw).toNat _ scaled (by decide) rfl
  · rw [u]; exact product _ "high" "twos" h tw rfl rfl
  · rw [u]; exact Inv32WideWords.orWord _ _
  · exact (l ||| h*tw).isLt
  · scalar_write

def finished (r : Runtime) (x y d h l hi lo rem tw result : Nat) (i : W) :=
  let frame := r.withFrame [("x",Value.word x),("y",.word y),("denominator",.word d),("result",.word result)]
  let m := Inv32BorrowRun.atRemainder frame.pushScope.pushScope x y h l hi lo rem
  put (m.declareLocal "twos" (.word tw)) i

theorem returned (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat) (hv : v<R)
    (h : locals r "result" = some v) : Stmt.eval (n+1) t c r ret = pure (.returned r [.word v]) := by
  have e := evalFormula retExpr c r v (by decide) (Inv32ProductValues.cleanup (localWord "result") c.checked _ _ hv h)
  have leaf : Expr.evalReturnValue c r retExpr.core = pure (.word v,r) := e
  have vs : Expr.evalReturnList c r [retExpr.core] = pure ([.word v],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [retExpr.core] = _
    have pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
    simp only [Expr.evalReturnListFuel,leaf,pb]
  unfold ret; rw [Stmt.eval]; dsimp only; rw [vs]; rfl

theorem finish (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y d h hi lo rem tw : Nat)
    (l i : W) (u : c.checked = false) :
    let next := finished r x y d h l.toNat hi lo rem tw (l*i).toNat i
    Stmt.evalList (n+1) t c (put (stateT r x y d h l.toNat hi lo rem tw) i) [resultAssign,ret] =
      pure (.returned next [.word (l*i).toNat]) := by
  dsimp only
  let prev := put (stateT r x y d h l.toNat hi lo rem tw) i
  let next := finished r x y d h l.toNat hi lo rem tw (l*i).toNat i
  have rhs := evalFormula resultExpr c prev (l*i).toNat (by decide) (u ▸ product (locals prev) "low" "inverse" l i rfl rfl)
  have written : prev.assignLocal? "result" (.word (l*i).toNat) = some next := by
    dsimp [prev,next,finished,put]; scalar_write
  have A : Stmt.eval (n+1) t c prev resultAssign = pure (.normal next) :=
    Inv32Assign.scalarCast _ _ _ _ _ _ 0 _ _ _ _ rfl rhs written
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ A]
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ (returned _ _ _ next _ (l*i).isLt rfl)
end Inv32WideFinish
