import Inv08Schedule
namespace Inv08

def totalRate (streams : List Stream) := (streams.map Stream.budget).sum
def weightedEnds (d : Nat) (streams : List Stream) :=
  (streams.map fun s => s.budget*(s.fundedAt+d)).sum

/-- The two cumulative fields in an expiry record suffice to price all streams
at a timestamp. The search partitions the ordered records at the last matured end. -/
theorem prefixIntegral (d t : Nat) (matured active : List Stream)
    (done : ∀ s∈matured, s.fundedAt+d≤t) (live : ∀ s∈active, t≤s.fundedAt+d) :
    integral d t (matured++active) =
      (totalRate (matured++active)-totalRate matured)*t + weightedEnds d matured := by
  have past : integral d t matured=weightedEnds d matured := by
    induction matured with
    | nil => rfl
    | cons s ss ih =>
      change s.budget*min t (s.fundedAt+d)+integral d t ss= _ + _
      rw [min_eq_right (done s (by simp)),ih (fun x mem => done x (by simp [mem]))]
      rfl
  have future : integral d t active = totalRate active*t := by
    induction active with
    | nil => simp [integral,totalRate]
    | cons s ss ih =>
      change s.budget*min t (s.fundedAt+d)+integral d t ss=(s.budget+totalRate ss)*t
      rw [min_eq_left (live s (by simp)),ih (fun x mem => live x (by simp [mem])),Nat.add_mul]
  have combined : integral d t (matured++active) = integral d t matured + integral d t active := by
    simp only [integral,List.map_append,List.sum_append]
  rw [combined,past,future]
  simp [totalRate,Nat.add_comm]

/-- Each stream contributes one funded numerator times the same duration at expiry.
Combining this with subdivision recovers every funded token, including dust. -/
theorem releaseAtLastExpiry (d final : Nat) (streams : List Stream) (samples : List Nat) (dp : 0<d)
    (ends : ∀ s∈streams,s.fundedAt+d≤final) (times : ∀ t∈samples,t≤final) :
    (checkpoints d (baseline streams) ((samples.map fun t => integral d t streams)++[integral d final streams])).2 =
      totalRate streams := by
  have endEq := expired d final streams ends
  have bound : baseline streams≤integral d final streams := by rw [endEq]; omega
  have ord : ∀ x∈samples.map (fun t => integral d t streams), x≤integral d final streams := by
    intro x mem
    obtain ⟨t,ht,rfl⟩ := List.mem_map.mp mem
    exact monotone _ _ _ _ (times _ ht)
  rw [subdivision _ _ _ _ dp bound ord,endEq]
  simp [totalRate,Nat.mul_div_cancel _ dp]
end Inv08
