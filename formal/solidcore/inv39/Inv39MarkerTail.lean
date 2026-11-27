import Inv39MarkerBounds
import Inv39MarkerSteps
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.Marker
/-- Allowed storage effects after the generated marker store. The length bounds
are obligations about the actual decimal-call output, not a post-marker assumption.
`same` covers memory declarations, decimal conversion, local assignment, scope
restoration, and call-result packaging; event has its own checked rule. -/
inductive Suffix (base : State) : State → Prop where
  | initial : Suffix base base
  | same {s next} : Suffix base s → next.storage=s.storage → Suffix base next
  | name {s} (bs : List Source.Byte) : Suffix base s → bs.length≤95 →
      Suffix base (s.storeStorageBytesAt 3 bs)
  | symbol {s} (bs : List Source.Byte) : Suffix base s → bs.length≤81 →
      Suffix base (s.storeStorageBytesAt 4 bs)
  | cap {s} (word : Nat) : Suffix base s → Suffix base (s.storeSlot 5 word)
  | event {r next : Runtime} (c : Context) (label : String) (vs : List Source.Value) :
      Suffix base r.state → r.emitEvent c label vs=.ok next → Suffix base next.state
/-- Concrete hashes protect slot 7 through all permitted suffix effects,
including clearing old metadata of arbitrary decoded size and both logs. -/
theorem suffixMarker {base post : State} (path : Suffix base post) : post.loadSlot 7=base.loadSlot 7 := by
  induction path with
  | initial => rfl
  | same prior eq ih => simpa only [State.loadSlot,eq] using ih
  | name bs prior length ih => exact (boundedMetadataFrame _ 3 7 bs (Or.inl rfl)
      (Or.inr (Or.inr (Or.inr (Or.inr rfl)))) (by decide) length).trans ih
  | symbol bs prior length ih => exact (boundedMetadataFrame _ 4 7 bs (Or.inr rfl)
      (Or.inr (Or.inr (Or.inr (Or.inr rfl)))) (by decide) (by omega)).trans ih
  | cap word prior ih => exact (loadUnchanged _ 5 word 7 (by decide)).trans ih
  | event c label vs prior emitted ih =>
    have eq := (logPreservesStorage c _ _ label vs emitted).1
    simpa only [State.loadSlot,eq] using ih
/-- Decimal rendering of a uint256 is at most 78 digits; the actual interpreter
output still has to be connected to such a rendering by reachability. -/
theorem decimalMagnitude (rep : Nat) : Shared.norm rep < 10^78 := by
  exact lt_trans (Nat.mod_lt _ (by decide : 0<R)) (by decide : R<10^78)
theorem metadataLengths (digits : List Source.Byte) (bound : digits.length≤78) :
    ([65,117,103,117,114,32,82,101,112,117,116,97,116,105,111,110,32] ++ digits).length≤95 ∧
    ([82,69,80] ++ digits).length≤81 := by
  simp only [List.length_append,List.length_cons,List.length_nil]
  omega
end Inv39.Init.Marker
