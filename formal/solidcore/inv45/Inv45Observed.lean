import Inv45Invariant
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45
/-- Observe return bytes in their own post-call memory, not by pointer identity. -/
def returnedBytes (r : Runtime) : Value→Option (List Nat)
  | .bytes bs=>some bs
  | .memoryRef id=>match r.loadMemory? id with | some (.bytes bs)=>some bs | _=>none
  | _=>none
theorem observed {r : Runtime} {bs : List Nat} {v : Value} (holds : Decimal.Holds r bs v) : returnedBytes r v=some bs := by
  cases holds with
  | direct=>rfl
  | ref bound cell=>simp [returnedBytes,cell]
theorem distinctObserved (lo hi : Int) (n : Nat) (unit : List Nat) (x y : Nat)
    (rx ry : Runtime) (vx vy : Value) (rise : lo<hi) (pos : 0<n) (different : x≠y)
    (X : Decimal.Holds rx (Text.label (Scale.display lo (hi-lo).toNat n x) unit n (Scale.tag (hi-lo).toNat n x)) vx)
    (Y : Decimal.Holds ry (Text.label (Scale.display lo (hi-lo).toNat n y) unit n (Scale.tag (hi-lo).toNat n y)) vy) :
    returnedBytes rx vx ≠ returnedBytes ry vy := by
  rw [observed X,observed Y]
  intro equal
  exact different (Text.labelDistinct lo hi n unit x y rise pos (Option.some.inj equal))
#print axioms distinctObserved
end Inv45
