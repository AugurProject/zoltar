import Inv32Choice
open SolidCore.Solidity.Source
namespace Inv32Scalar
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

def unary (op : UnaryOp) (x : Formula) : Formula where
  core := .unary op x.core
  depth := x.depth+1
  run checked env := do projectWord (op.apply checked (.word (← x.run checked env)))
  sound fuel c r env v enough modeled hit := by
    cases fuel with
    | zero => omega
    | succ n =>
      cases h : x.run c.checked env <;> simp [h] at hit
      have core := x.sound n _ _ _ _ (by omega) modeled h
      rename_i u
      have result : op.apply c.checked (.word u) = .ok (.word v) := by
        cases e : op.apply c.checked (.word u) with
        | error => simp [e,projectWord] at hit
        | ok value => cases value <;> simp_all [projectWord]
      rw [Expr.evalFuel,core]; simp only [pb]; rw [result]; rfl

def modularProduct (x y z : Formula) : Formula where
  core := .mulMod x.core y.core z.core
  depth := max x.depth (max y.depth z.depth)+1
  run checked env := do
    let a ← x.run checked env
    let b ← y.run checked env
    let d ← z.run checked env
    (checkedMulMod (normWord a) (normWord b) (normWord d)).toOption
  sound fuel c r env v enough modeled hit := by
    cases fuel with
    | zero => omega
    | succ n =>
      cases a : x.run c.checked env <;> simp [a] at hit
      cases b : y.run c.checked env <;> simp [b] at hit
      cases d : z.run c.checked env <;> simp [d] at hit
      have ex := x.sound n _ _ _ _ (by omega) modeled a
      have ey := y.sound n _ _ _ _ (by omega) modeled b
      have ez := z.sound n _ _ _ _ (by omega) modeled d
      have lifted (w : Nat) : (liftM (.ok w : Except RevertData Nat) : SolI Nat) = pure w := rfl
      have expect (w : Nat) : (Value.word w).expectWord = .ok (normWord w) := rfl
      rename_i av bv dv
      have result : checkedMulMod (normWord av) (normWord bv) (normWord dv) = .ok v := by
        cases e : checkedMulMod (normWord av) (normWord bv) (normWord dv) <;> simp_all [Except.toOption]
      rw [Expr.evalFuel]
      simp only [ez,ey,ex,pb,expect,lifted,result]

end Inv32Scalar
