import Inv08SearchBinding
import Inv08Expired
import Inv32Midpoint
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Scalar Inv32Division Inv32Actions
namespace Inv08.Expiry
def narrowed (e : Formula) := cast .cleanup 48 e
def doubled (e : Formula) := narrowed (narrowed e)
def namedWord (name : String) := narrowed (localWord name)
def constant (v : Nat) := cast .uint 48 (literal v)
def minus (x y : Formula) := doubled (Inv32Product.subF x y)
def plus (x y : Formula) := doubled (Inv32WideWords.addF x y)
def half (x : Formula) := doubled (Inv32FloorNarrow.divF x (constant 2))
def formula := plus (namedWord "low") (half (plus (minus (namedWord "high") (namedWord "low")) (constant 1)))
theorem shape : midpoint.value = formula.core := rfl
theorem narrow {term : Formula} {checked : Bool} {env : Env} {v : Nat} (fit : v<2^48)
    (ev : term.run checked env=some v) : (narrowed term).run checked env=some v := by
  have hw : v<R := lt_trans fit (by decide)
  have valid : uintCleanup? checked 48 (.word v)=.ok (.word v) := by
    norm_num at fit
    simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,show Shared.norm v=v from Nat.mod_eq_of_lt hw,
      Nat.not_le_of_gt fit,Nat.mod_eq_of_lt fit,Bind.bind,Except.bind]
  simp [narrowed,Inv32Scalar.cast,ev,valid,projectWord]
theorem narrow2 {term : Formula} {checked : Bool} {env : Env} {v : Nat} (fit : v<2^48)
    (ev : term.run checked env=some v) : (doubled term).run checked env=some v := narrow fit (narrow fit ev)
theorem add (env : Env) (x y : Formula) (a b : Nat) (fit : a+b<2^48)
    (X : x.run true env=some a) (Y : y.run true env=some b) :
    (plus x y).run true env=some (a+b) := by
  have big : a+b<R := lt_trans fit (by decide)
  have op : BinaryOp.applyWord true .add a b = .ok (a+b) := by
    have h := Inv32Rounding.addition a b (by omega) (by omega)
    rw [if_pos big] at h
    cases z : BinaryOp.applyWord true .add a b <;> simp_all [Except.toOption]
  have word : BinaryOp.apply true .add (.word a) (.word b) = .ok (.word (a+b)) := by
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,op,Bind.bind,Except.bind]
  apply narrow2 fit
  simp [Inv32WideWords.addF,binary,X,Y,word,projectWord]

theorem computes (env : Env) (lo hi : Nat) (positive : 0<lo) (ordered : lo<hi) (fit : hi<2^48)
    (L : env "low"=some lo) (H : env "high"=some hi) :
    formula.run true env=some (middle lo hi) := by
  have hl : lo<2^48 := by omega
  have lw := narrow (term:=localWord "low") (checked:=true) hl L
  have hw := narrow (term:=localWord "high") (checked:=true) fit H
  have hwide : hi<R := lt_trans fit (by decide)
  have loWide : lo<R := by omega
  let diff := minus (namedWord "high") (namedWord "low")
  have sub : diff.run true env=some (hi-lo) := by
    apply narrow2 (by omega : hi-lo<2^48)
    simp [Inv32Product.subF,binary,namedWord,lw,hw,Inv32QuoteExpr.subWord true hi lo hwide loWide (by omega),projectWord]
  have inc := add env diff (constant 1) (hi-lo) 1 (by omega) sub rfl
  have hinc : hi-lo+1<R := by omega
  have dv : (half (plus diff (constant 1))).run true env=some ((hi-lo+1)/2) := by
    apply narrow2 (by omega : (hi-lo+1)/2<2^48)
    have two : (constant 2).run true env=some 2 := rfl
    simp [Inv32FloorNarrow.divF,binary,inc,two,Inv32Eval.divideWords true (hi-lo+1) 2 hinc (by decide) (by decide),projectWord]
  exact add env _ _ _ _ (by omega : lo+(hi-lo+1)/2<2^48) lw dv

theorem evaluates (c : Context) (r : Runtime) (lo hi : Nat) (ch : c.checked=true)
    (pos : 0<lo) (ordered : lo<hi) (fit : hi<2^48)
    (L : locals r "low"=some lo) (H : locals r "high"=some hi) :
    ∃ term, loopMidpoint=some term ∧ term.eval c r=pure (.word (middle lo hi),r) := by
  refine ⟨formula.core,by rw [boundToSolidity,shape],evalFormula formula _ _ _ (by decide) ?_⟩
  rw [ch]
  exact computes _ _ _ pos ordered fit L H
end Inv08.Expiry
