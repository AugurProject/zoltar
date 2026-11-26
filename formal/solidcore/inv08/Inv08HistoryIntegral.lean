import Inv08FundingTransition
import Inv08PreviewShape
open SolidCore.Solidity.Source
namespace Inv08.FundingHistory

/-- The zero sentinel and each funded prefix are stored at the corresponding Solidity mapping key. -/
structure Records (s : State) (d : Nat) (fs : List Funding) : Prop where
  count : stored s .latest = fs.length
  entries : ∀ i, i≤fs.length → ExpiryStorage.tuple s (mappingStorageSlot 7 i) = .tuple (record d (fs.take i)).words

theorem recordFields (H : Records s d fs) (i : Nat) (le : i≤fs.length) (eth : Bool) :
    Expiry.endsAt s i = (record d (fs.take i)).endAt ∧
    Integral.rate s (mappingStorageSlot 7 i) eth = totalRate (streams eth (fs.take i)) ∧
    Integral.weight s (mappingStorageSlot 7 i) eth = weightedEnds d (streams eth (fs.take i)) := by
  have eq := H.entries i le
  simp only [ExpiryStorage.tuple,ExpiryStorage.Record.words,Value.tuple.injEq,List.cons.injEq,Value.word.injEq] at eq
  cases eth
  · exact ⟨eq.1,eq.2.2.1,eq.2.2.2.2.1⟩
  · exact ⟨eq.1,eq.2.1,eq.2.2.2.1⟩

theorem endAt (H : Records s d fs) (j : Nat) (inRange : j<fs.length) :
    Expiry.endsAt s (j+1) = fs[j].time+d := by
  rw [(recordFields H (j+1) inRange true).1]
  simp [record,List.getLast?_take,List.getElem?_eq_getElem inRange]

theorem numerator (H : Records s d fs) (tm q : Nat) (eth : Bool) (limit : q ≤ fs.length)
    (boundary : ∀ i, 0<i → i≤fs.length → (Expiry.endsAt s i ≤ tm ↔ i≤q)) :
    Integral.numerator s tm q eth = integral d tm (streams eth fs) := by
  have A := (recordFields H fs.length le_rfl eth).2.1
  rw [List.take_length] at A
  obtain ⟨_,B,C⟩ := recordFields H q limit eth
  unfold Integral.numerator Integral.total
  rw [H.count,A,B,C]
  let early := streams eth (fs.take q)
  let late := streams eth (fs.drop q)
  have both : streams eth fs = early++late := by
    dsimp [early,late,streams]; rw [←List.map_append,List.take_append_drop]
  have past : ∀ a∈early, a.fundedAt+d≤tm := by
    intro a mem
    change a ∈ (fs.take q).map (stream eth) at mem
    obtain ⟨f,hf,rfl⟩ := List.mem_map.mp mem
    obtain ⟨j,hj,rfl⟩ := List.mem_take_iff_getElem.mp hf
    have jf : j < fs.length := by omega
    change fs[j].time+d ≤ tm
    rw [←endAt H j jf]
    exact (boundary _ (by omega) jf).mpr (by omega)
  have future : ∀ a∈late, tm≤a.fundedAt+d := by
    intro a mem
    change a ∈ (fs.drop q).map (stream eth) at mem
    obtain ⟨f,hf,rfl⟩ := List.mem_map.mp mem
    obtain ⟨j,hj,rfl⟩ := List.mem_drop_iff_getElem.mp hf
    have jf : q+j < fs.length := by omega
    have later := (boundary (q+j+1) (by omega) jf).mp
    rw [endAt H _ jf] at later
    change tm ≤ fs[q+j].time+d
    apply Nat.le_of_not_lt
    intro earlier
    have impossible := later (Nat.le_of_lt earlier)
    omega
  rw [both,prefixIntegral d tm early late past future]

end Inv08.FundingHistory
