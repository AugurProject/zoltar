import Inv32CompareProducts
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32Scalar Inv32Product Inv32QuoteExpr
namespace Inv32CompareValues
def add (x y : String) := Inv32NewtonBody.twice (Inv32WideWords.addF (w x) (w y))
def leF (x y : String) := Inv32WideGuards.leF (w x) (w y)
def eqF' (x y : String) := eqF (w x) (w y)
def last : Expr := .binary .boolOr (smaller "highSum" "rightHigh").core (.binary .boolAnd
  (eqF' "highSum" "rightHigh").core (leF "lowSum" "rightLow").core)
def test (h l rh rl : Nat) : Bool := h<rh || (h == rh && l≤rl)
private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl
theorem addWord (a b : Nat) (ha : a<R) (hb : b<R) :
    BinaryOp.apply false .add (.word a) (.word b) = .ok (.word ((a+b)%R)) := by
  have h := Inv32WideWords.addWord (bv a) (bv b)
  simpa only [BitVec.toNat_add,Inv32WideAdapters.toNat _ ha,Inv32WideAdapters.toNat _ hb] using h
theorem addValue (e : Env) (x y : String) (a b : Nat) (ha : a<R) (hb : b<R)
    (X : e x = some a) (Y : e y = some b) :
    (add x y).run false e = some ((a+b)%R) := by
  have A := Inv32ProductValues.cleanup (localWord x) false e _ ha X
  have B := Inv32ProductValues.cleanup (localWord y) false e _ hb Y
  have small := Nat.mod_lt (a+b) (Nat.two_pow_pos 256)
  apply Inv32ProductValues.cleanup _ _ _ _ small; apply Inv32ProductValues.cleanup _ _ _ _ small
  simp [Inv32WideWords.addF,binary,w,A,B,addWord _ _ ha hb,projectWord,R]
theorem either (n : Nat) (c : Context) (r : Runtime) (x y : Expr) (a b : Bool)
    (X : Expr.evalFuel n c r x = pure (.word (boolWord a),r))
    (Y : Expr.evalFuel n c r y = pure (.word (boolWord b),r)) :
    Expr.evalFuel (n+1) c r (.binary .boolOr x y) = pure (.word (boolWord (a || b)),r) := by
  rw [Expr.evalFuel,X]; simp only [pb]; cases a
  · change (do let (v,s) ← Expr.evalFuel n c r y; let w ← liftM v.expectWord
               pure (Value.word (boolWord (wordTruthy w)),s)) = _
    rw [Y]; cases b <;> rfl
  · rfl
theorem finalExpr (c : Context) (r : Runtime) (h l rh rl : Nat) (hh : h<R) (hl : l<R) (hrh : rh<R) (hrl : rl<R)
    (chk : c.checked=false) (H : locals r "highSum" = some h) (L : locals r "lowSum" = some l)
    (RH : locals r "rightHigh" = some rh) (RL : locals r "rightLow" = some rl) :
    Expr.eval c r last = pure (.word (boolWord (test h l rh rl)),r) := by
  let m := Inv32QuoteGuard.modeled r
  let n := last.orderFuel-1
  have A := (smaller "highSum" "rightHigh").sound (n+1) c r _ _ (by decide) m (less _ _ _ _ _ _ hh hrh H RH)
  have h1 := Inv32ProductValues.cleanup (localWord "highSum") c.checked (locals r) _ hh H
  have h2 := Inv32ProductValues.cleanup (localWord "rightHigh") c.checked (locals r) _ hrh RH
  have l1 := Inv32ProductValues.cleanup (localWord "lowSum") false (locals r) _ hl L
  have l2 := Inv32ProductValues.cleanup (localWord "rightLow") false (locals r) _ hrl RL
  have equal : (eqF' "highSum" "rightHigh").run c.checked (locals r) = some (boolWord (h==rh)) := by
    simp [eqF',eqF,binary,w,h1,h2,Inv32WideGuards.eqWord _ _ _ hh hrh,projectWord,boolWord]
  have le : (leF "lowSum" "rightLow").run c.checked (locals r) = some (boolWord (decide (l≤rl))) := by
    rw [chk]; simp [leF,Inv32WideGuards.leF,binary,w,l1,l2,Inv32WideGuards.leWord _ _ hl hrl,projectWord,boolWord]
  have B := (eqF' "highSum" "rightHigh").sound n c r _ _ (by decide) m equal
  have C := (leF "lowSum" "rightLow").sound n c r _ _ (by decide) m le
  exact either (n+1) _ _ _ _ _ _ A (Inv32QuoteGuard.both n _ _ _ _ _ _ B C)
theorem retOne (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (e : Expr) (v : Nat)
    (read : Expr.evalReturnValue c r e = pure (.word v,r)) :
    Stmt.eval (n+1) t c r (.returnValues [e]) = pure (.returned r [.word v]) := by
  have ls : Expr.evalReturnList c r [e] = pure ([.word v],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [e] = _
    simp only [Expr.evalReturnListFuel,read,pb]
  rw [Stmt.eval]; dsimp only; rw [ls]; rfl
end Inv32CompareValues
