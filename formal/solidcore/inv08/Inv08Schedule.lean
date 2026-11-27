import Mathlib.Tactic.Ring
namespace Inv08
structure Stream where
  fundedAt : Nat
  budget : Nat

def baseline (streams : List Stream) : Nat :=
  (streams.map fun s => s.budget*s.fundedAt).sum

def integral (duration t : Nat) (streams : List Stream) :=
  (streams.map fun s => s.budget * min t (s.fundedAt+duration)).sum

theorem monotone (d t u : Nat) (streams : List Stream) (le : t≤u) :
    integral d t streams ≤ integral d u streams := by
  induction streams with
  | nil => rfl
  | cons s ss ih =>
    exact Nat.add_le_add (Nat.mul_le_mul_left _ (min_le_min_right _ le)) ih

theorem afterFunding (d t : Nat) (streams : List Stream) (funded : ∀ s∈streams, s.fundedAt≤t) :
    baseline streams ≤ integral d t streams := by
  induction streams with
  | nil => rfl
  | cons s ss ih =>
    exact Nat.add_le_add (Nat.mul_le_mul_left _ (le_min (funded _ (by simp)) (by omega)))
      (ih (fun s mem => funded s (by simp [mem])))

theorem expired (d t : Nat) (streams : List Stream) (ends : ∀ s∈streams, s.fundedAt+d≤t) :
    integral d t streams = baseline streams + (streams.map Stream.budget).sum*d := by
  induction streams with
  | nil => simp [integral,baseline]
  | cons s ss ih =>
    have h := ends s (by simp)
    have rest := ih (fun s mem => ends s (by simp [mem]))
    change s.budget*min t (s.fundedAt+d)+integral d t ss =
      s.budget*s.fundedAt+baseline ss+(s.budget+(ss.map Stream.budget).sum)*d
    rw [min_eq_right h,rest]; ring

/-- Adding only whole released amounts multiplied by duration keeps the fractional numerator. -/
theorem next (d base cumulative observed : Nat) (dp : 0<d) (ordered : base+cumulative*d≤observed) :
    cumulative + (observed-(base+cumulative*d))/d = (observed-base)/d := by
  have eq : (observed-(base+cumulative*d))+cumulative*d=observed-base := by omega
  rw [←eq,Nat.add_mul_div_right _ _ dp,Nat.add_comm]

def checkpoints (d : Nat) (cursor : Nat) : List Nat → Nat × Nat
  | [] => (cursor,0)
  | value::tail =>
    let paid := (value-cursor)/d
    let (last,remaining) := checkpoints d (cursor+paid*d) tail
    (last,paid+remaining)

theorem subdivision (d base final : Nat) (samples : List Nat) (dp : 0<d) (start : base≤final)
    (bounds : ∀ x∈samples, x≤final) :
    checkpoints d base (samples++[final]) =
      (base+((final-base)/d)*d,(final-base)/d) := by
  induction samples generalizing base with
  | nil => simp [checkpoints]
  | cons x xs ih =>
    have xf := bounds x (by simp)
    let paid := (x-base)/d
    let updated := base+paid*d
    have upto : updated≤final := by
      have h := Nat.div_mul_le_self (x-base) d
      dsimp [updated,paid]; omega
    have tail := ih updated upto (fun y mem => bounds y (by simp [mem]))
    change (let (last,remaining) := checkpoints d updated (xs++[final]); (last,paid+remaining)) = _
    rw [tail]
    have total := next d base paid final dp upto
    change (updated+(final-updated)/d*d, paid+(final-updated)/d) = _
    dsimp only [updated] at *
    rw [←total,Nat.add_mul]
    simp [Nat.add_assoc]
end Inv08
