import Inv12Fields
import Inv12Alias
open SolidCore.Solidity.Source
namespace Inv12

def ForkLayout (f : Ref) := f.hasField 1 1 ∧ f.hasField 2 2 ∧ f.hasField 5 5 ∧ f.hasField 6 6
def BranchLayout (b : Ref) := b.hasField 4 3 ∧ b.hasField 5 4 ∧ b.hasField 6 5

private theorem mapCons {a : Type} {b : Type} (f : a → Option b) (i : a) (is : List a) (j : b) (js : List b)
    (h : (i::is).mapM f = some (j::js)) : f i=some j ∧ is.mapM f=some js := by
  cases F : f i <;> cases T : is.mapM f <;> simp_all [List.mapM_cons]

theorem registeredFork (key : Nat) :
    ∃ fs, mappedMembers "forks"=some (2,fs) ∧ ForkLayout (mappedRef 2 key fs) := by
  have H := registeredOffsets.1
  unfold mappedOffsets at H
  cases F : mappedMembers "forks" with
  | none => simp [F] at H
  | some p =>
    obtain ⟨s,fs⟩ := p
    cases M : [1,2,5,6].mapM (wordOffset fs) with
    | none => simp only [F,Bind.bind,Option.bind,M] at H; cases H
    | some js =>
      simp only [F,Bind.bind,Option.bind,M,Pure.pure,Option.some.injEq,Prod.mk.injEq] at H
      rcases H with ⟨rfl,rfl⟩
      obtain ⟨a,l⟩ := mapCons _ _ _ _ _ M
      obtain ⟨b,l⟩ := mapCons _ _ _ _ _ l
      obtain ⟨c,l⟩ := mapCons _ _ _ _ _ l
      obtain ⟨d,_⟩ := mapCons _ _ _ _ _ l
      exact ⟨fs,rfl,fieldOfOffset _ _ _ a,fieldOfOffset _ _ _ b,fieldOfOffset _ _ _ c,fieldOfOffset _ _ _ d⟩

theorem registeredBranch (key : Nat) :
    ∃ bs, mappedMembers "branchStates"=some (3,bs) ∧ BranchLayout (mappedRef 3 key bs) := by
  have H := registeredOffsets.2
  unfold mappedOffsets at H
  cases F : mappedMembers "branchStates" with
  | none => simp [F] at H
  | some p =>
    obtain ⟨s,bs⟩ := p
    cases M : [4,5,6].mapM (wordOffset bs) with
    | none => simp only [F,Bind.bind,Option.bind,M] at H; cases H
    | some js =>
      simp only [F,Bind.bind,Option.bind,M,Pure.pure,Option.some.injEq,Prod.mk.injEq] at H
      rcases H with ⟨rfl,rfl⟩
      obtain ⟨a,l⟩ := mapCons _ _ _ _ _ M
      obtain ⟨b,l⟩ := mapCons _ _ _ _ _ l
      obtain ⟨c,_⟩ := mapCons _ _ _ _ _ l
      exact ⟨bs,rfl,fieldOfOffset _ _ _ a,fieldOfOffset _ _ _ b,fieldOfOffset _ _ _ c⟩
end Inv12
