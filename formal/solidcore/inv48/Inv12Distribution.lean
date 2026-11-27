import Inv12ChoiceHistoryFrame
open SolidCore.Solidity.Source
namespace Inv12

def weights (s : State) (branches : List Ref) := branches.map (fun b => b.get s 4)

structure Distribution (f : Ref) (branches : List Ref) (cash total : Nat) (s : State) : Prop where
  frozenCash : f.get s 2=cash
  frozenCommitment : f.get s 1=total
  parents : ∀ b ∈ branches, b.get s 5=cash*b.get s 4/total
  assignedTotal : f.get s 5=assigned cash total (weights s branches)

/-- Separation of the physical slots touched by one choice from fork fields and other branches. -/
structure BranchSeparation (f b : Ref) (others : List Ref) : Prop where
  fork : ∀ i ∈ [3,4,5], ∀ j ∈ [1,2,5], b.addressOf i≠f.addressOf j
  otherFork : ∀ g ∈ others, ∀ j ∈ [4,5], f.addressOf 5≠g.addressOf j
  otherBranch : ∀ g ∈ others, ∀ j ∈ [4,5], ∀ i ∈ [3,4,5], b.addressOf i≠g.addressOf j

theorem distributionStep (f b : Ref) (before after : List Ref) (cash total extra : Nat) (s next : State)
    (dist : Distribution f (before++b::after) cash total s) (sep : BranchSeparation f b (before++after))
    (credit : CreditPost f b s next extra)
    (accounted : f.get next 5=assigned cash total (weights s before++[b.get s 4+extra]++weights s after)) :
    Distribution f (before++b::after) cash total next := by
  have forkStable (i : Nat) (fi : i ∈ [1,2]) (di : i≠5) : f.get next i=f.get s i :=
    credit.other f i (f.distinctOffsets 5 i (by decide) (by simp at fi; rcases fi with h|h <;> subst i <;> decide) (Ne.symm di))
      (fun j mem => sep.fork j mem i (by simp at fi ⊢;tauto))
  have stable (g : Ref) (m : g ∈ before++after) (j : Nat) (h : j ∈ [4,5]) : g.get next j=g.get s j :=
    credit.other g j (sep.otherFork g m j h) (sep.otherBranch g m j h)
  have sameWeights (l : List Ref) (h : ∀ g ∈ l, g ∈ before++after) : weights next l=weights s l := by
    apply List.map_congr_left
    intro g mem; exact stable g (h g mem) 4 (by decide)
  refine ⟨(forkStable 2 (by decide) (by decide)).trans dist.frozenCash,
    (forkStable 1 (by decide) (by decide)).trans dist.frozenCommitment,?_,?_⟩
  · intro g mem
    by_cases eqn : g=b
    · subst g;rw [credit.cash,credit.chosen,dist.frozenCash,dist.frozenCommitment]
    · have other : g ∈ before++after := by simpa [List.mem_append,eqn] using mem
      rw [stable g other 5 (by decide),stable g other 4 (by decide)]
      exact dist.parents g mem
  · have WB := sameWeights before (fun _ h => List.mem_append.mpr (Or.inl h))
    have WA := sameWeights after (fun _ h => List.mem_append.mpr (Or.inr h))
    change f.get next 5=assigned cash total ((before++b::after).map _)
    rw [List.map_append,List.map_cons]
    change f.get next 5=assigned cash total (weights next before++b.get next 4::weights next after)
    rw [WB,WA,credit.chosen]
    simpa using accounted
end Inv12
