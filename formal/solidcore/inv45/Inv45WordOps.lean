import Inv45Comparisons
import Inv32CompareValues
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Signed
theorem addRaw (a b : Nat) (A : a<R) (B : b<R) :
    Shared.addWord a b=(a+b)%R := by
  have h := Inv32CompareValues.addWord a b A B
  change Except.ok (Value.word (Shared.addWord a b)) = _ at h
  injection h with h; injection h
theorem subRaw (a b : Nat) (A : a<R) (B : b<R) :
    Shared.subWord a b=(a+R-b)%R := by
  have h := Inv32ProductValues.subWord a b A B
  change Except.ok (Value.word (Shared.subWord a b)) = _ at h
  injection h with h; injection h
theorem plusOne (v : Int) (A : inRange v) (neg : v<0) :
    BinaryOp.apply false .add (.int (word v)) (.int 1) = .ok (.int (word (v+1))) := by
  change Except.ok (Value.int (Shared.addWord (word v) 1))=_
  rw [addRaw _ _ (wordFit _ A) (by decide)]
  have ⟨lo,hi⟩ := A
  by_cases e : v = -1
  · subst v;rfl
  have neg' : v+1<0 := by omega
  unfold word;rw [if_pos neg,if_pos neg']
  have r : (v+↑R).toNat+1<R := by norm_num [H,R] at *;omega
  rw [Nat.mod_eq_of_lt r]
  apply congrArg (fun x => Except.ok (Value.int x))
  have X : 0 ≤ v + ↑R := by norm_num [H,R] at *;omega
  have Y := Int.toNat_of_nonneg X
  have Z := Int.toNat_of_nonneg (show 0 ≤ v+1+↑R by omega)
  exact_mod_cast (show ↑((v+↑R).toNat)+(1:Int)=↑((v+1+↑R).toNat) by rw [Y,Z];ring)
theorem negateNonpositive (v : Int) (A : inRange v) (low : -(H:Int)<v) (hi : v≤0) :
    UnaryOp.apply false .neg (.int (word v)) = .ok (.int (word (-v))) := by
  change Except.ok (Value.int (Shared.subWord 0 (word v)))=_
  rw [subRaw _ _ (by decide) (wordFit _ A),Nat.zero_add]
  by_cases e : v=0
  · subst v;rfl
  have neg : v<0 := by omega
  unfold word;rw [if_pos neg,if_neg (by omega : ¬ -v<0)]
  have r : R-(v+↑R).toNat<R := by norm_num [H,R] at *;omega
  rw [Nat.mod_eq_of_lt r]
  apply congrArg (fun x => Except.ok (Value.int x))
  have X : 0 ≤ v + ↑R := by norm_num [H,R] at *;omega
  have Y := Int.toNat_of_nonneg X
  have Z := Int.toNat_of_nonneg (show 0 ≤ -v by omega)
  have m : (v+↑R).toNat ≤ R := by exact_mod_cast (show (↑((v+↑R).toNat):Int) ≤ ↑R by rw [Y];omega)
  apply Int.ofNat_inj.mp
  rw [Int.ofNat_sub m, Y,Z]
  ring
end Inv45.Signed
