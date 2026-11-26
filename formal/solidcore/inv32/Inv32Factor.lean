import Inv32BorrowRun
open SolidCore.Solidity.Source Inv32Scalar Inv32Product Inv32NewtonBody Inv32Division Inv32Actions Inv32WideGuards Inv32WideWords
namespace Inv32Factor
def read (n : String) := clean (localWord n)
def divF := Inv32FloorNarrow.divF
def divTo (n : String) := conditional (zeroTest "twos") (by decide)
  (writeLiteral n 0) (writeCast n .cleanup 256 (clean (divF (read n) (read "twos"))) (by change 5 ≤ 8; decide))
def negTwos := twice (subF (literal 0) (read "twos"))
def flipDiv := twice (divF negTwos (read "twos"))
def flip := clean (addF (choice (zeroTest "twos") (literal 0) flipDiv) (literal 1))
def update := block [divTo "denominator",divTo "low",writeCast "twos" .cleanup 256 flip (by decide)]
theorem location : Inv32FloorStart.instructions[14]? = some update.core := by rfl
theorem divValue (env : Env) (x y : Formula) (a b : Nat) (ha : a<R) (hb : b<R) (pos : 0<b)
    (X : x.run false env = some a) (Y : y.run false env = some b) :
    (twice (divF x y)).run false env = some (a/b) := by
  have bound := lt_of_le_of_lt (Nat.div_le_self a b) ha
  apply Inv32ProductValues.cleanup _ _ _ _ bound
  apply Inv32ProductValues.cleanup _ _ _ _ bound
  simp only [divF,Inv32FloorNarrow.divF,binary,X,Y]
  change projectWord (BinaryOp.apply false .div (.word a) (.word b)) = _
  rw [Inv32Eval.divideWords _ _ _ ha hb pos]; rfl

theorem flipValue (env : Env) (t : Nat) (ht : t<R) (pos : 0<t) (T : env "twos" = some t) :
    (clean flip).run false env = some (((R-t)/t+1)%R) := by
  have tw := Inv32ProductValues.cleanup (localWord "twos") false env t ht T
  have z := Inv32WideGuards.zeroValue false env "twos" t ht T
  rw [if_neg (Nat.ne_of_gt pos)] at z
  have neg : negTwos.run false env = some (R-t) := by
    have h := Inv32Borrow.subValue env (literal 0) (read "twos") 0 t (by decide) ht rfl tw
    simpa only [Nat.zero_add,Nat.mod_eq_of_lt (by omega : R-t<R)] using h
  have dv := divValue _ _ _ _ _ (by omega : R-t<R) ht pos neg tw
  have term : (choice (zeroTest "twos") (literal 0) flipDiv).run false env = some ((R-t)/t) := by
    simp only [choice,z]; exact dv
  let q := (R-t)/t
  have qsmall : q<R := lt_of_le_of_lt (Nat.div_le_self _ _) (by omega)
  have qn : (bv q).toNat = q := Nat.mod_eq_of_lt qsmall
  have sum : (bv q + 1).toNat = (q+1)%R := by rw [BitVec.toNat_add,qn]; rfl
  rw [←sum]
  apply double
  apply Inv32NewtonSeed.binaryValue _ _ _ _ _ _ (bv q) (1 : W) _ _ rfl (addWord _ _)
  rwa [qn]
end Inv32Factor
