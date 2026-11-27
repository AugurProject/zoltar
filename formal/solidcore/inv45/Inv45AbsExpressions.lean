import Inv45Expressions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Shapes
theorem conditionReads (c : Context) (r : Runtime) (v : Int) (V : Signed.inRange v)
    (localV : r.lookupLocal? "value"=some (.int (Signed.word v))) :
    Reads c r nonnegative.value (.word (if 0≤v then 1 else 0)) := by
  apply binary .ge (intClean (readSignedLocal _ _ _ _ localV) V) (readSignedLiteral c r 0 (by decide))
    (by intro h;cases h) (by intro h;cases h)
  exact Signed.geWord _ _ 0 V (by constructor <;> decide)
theorem positiveReads (c : Context) (r : Runtime) (v : Int) (V : Signed.inRange v) (pos : 0≤v)
    (localV : r.lookupLocal? "value"=some (.int (Signed.word v))) :
    Reads c r positive.value (.word v.natAbs) := by
  have W := Signed.wordFit v V
  have h : Signed.word v=v.natAbs := by
    cases v <;> simp_all [Signed.word]
  rw [←h]
  exact Inv08.ReleaseQuote.readClean (uintFromInt (readSignedLocal _ _ _ _ localV) W false) W
theorem negativeReads (c : Context) (r : Runtime) (v : Int) (V : Signed.inRange v) (neg : v<0)
    (unch : c.checked=false) (localV : r.lookupLocal? "value"=some (.int (Signed.word v))) :
    Reads c r mag.value (.word v.natAbs) := by
  obtain ⟨lo,hi⟩ := V
  have sumRange : Signed.inRange (v+1) := by constructor <;> omega
  have negRange : Signed.inRange (-(v+1)) := by constructor <;> omega
  have S := binary .add (readSignedLocal _ _ _ _ localV) (readSignedLiteral c r 1 (by decide))
    (by intro h;cases h) (by intro h;cases h) (by rw [unch];exact Signed.plusOne _ ⟨lo,hi⟩ neg)
  have N := unary .neg S (by rw [unch];exact Signed.negateNonpositive _ sumRange (by omega) (by omega))
  have T := intClean (intClean (intClean N negRange) negRange) negRange
  have W := Signed.wordFit _ negRange
  have U := Inv08.ReleaseQuote.readClean (uintFromInt T W true) W
  have magWord : Signed.word (-(v+1))+1=v.natAbs := by
    have P : 0 ≤ -(v+1) := by omega
    simp only [Signed.word,if_neg (Int.not_lt.mpr P)]
    cases v with
    | ofNat j => omega
    | negSucc j => simp
  have fit : v.natAbs<R := by cases v <;> simp_all [Signed.H,R] <;> omega
  have sum := binary .add U (Inv08.Authority.literal c r 1 (by decide)) (by intro h;cases h) (by intro h;cases h)
    (by rw [unch,Inv32CompareValues.addWord _ _ W (by decide),magWord,Nat.mod_eq_of_lt fit])
  exact Inv08.ReleaseQuote.readClean (Inv08.ReleaseQuote.readClean sum fit) fit
end Inv45.Shapes
