import Inv05Floor
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Actions Inv32QuoteExpr
namespace Inv05
def neF := binary .ne (by intro h; cases h) (by intro h; cases h)
def geF := binary .ge (by intro h; cases h) (by intro h; cases h)
theorem nonzero (c : Context) (r : Runtime) (name : String) (v : Nat) (small : v<R) (V : locals r name = some v) :
    Expr.eval c r (nz name).value = pure (.word (boolWord (decide (v≠0))),r) := by
  have input := Inv32ProductValues.cleanup (localWord name) c.checked (locals r) _ small V
  have op : BinaryOp.apply c.checked .ne (.word v) (.word 0) = .ok (.word (boolWord (decide (v≠0)))) := by
    change .ok (.word (boolWord (!(wordEq v 0)))) = (_ : Except RevertData Value)
    by_cases eq : v=0 <;> simp [wordEq,show Shared.norm v=v from Nat.mod_eq_of_lt small,show Shared.norm 0=0 from rfl,eq]
    rw [beq_eq_false_iff_ne.mpr eq]; rfl
  apply evalFormula (neF (w name) (literal 0)) c r _ (by change 3≤_; exact of_decide_eq_true rfl)
  simp only [neF,binary,w,input,show (literal 0).run c.checked (locals r)=some 0 from rfl]
  exact congrArg projectWord op

theorem comparison (c : Context) (r : Runtime) (a b : Nat) (ha : a<R) (hb : b<R)
    (A : locals r Inv03.Bodies.tmp = some a) (B : locals r "_sol_hoist_1" = some b) :
    let term := geF (castCopy Inv03.Bodies.tmp) (w "_sol_hoist_1")
    term.core.eval c r = pure (.word (boolWord (decide (b≤a))),r) := by
  have op : BinaryOp.apply c.checked .ge (.word a) (.word b) = .ok (.word (boolWord (decide (b≤a)))) := by
    have test : (Shared.toEvmWord a < Shared.toEvmWord b) ↔ a<b := by
      change (a%R)%R < (b%R)%R ↔ a<b
      simp [Nat.mod_eq_of_lt ha,Nat.mod_eq_of_lt hb]
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,BinaryOp.applyWord,
      Shared.ltWord,Shared.liftEvmBinary,EvmYul.UInt256.lt,test,Bind.bind,Except.bind]
    by_cases lt : a<b <;> simp [lt,boolWord,wordTruthy,show (b≤a) ↔ ¬a<b by omega] <;> decide
  apply evalFormula _ c r _ (by decide)
  simp only [geF,binary,w,castValue _ _ _ _ ha A,Inv32ProductValues.cleanup (localWord "_sol_hoist_1") c.checked (locals r) b hb B]
  exact congrArg projectWord op
end Inv05
