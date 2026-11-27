import Inv48ActualSiteGuardJoinShape
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestClassify Inv48.RequestPrologue Inv48.GuardArgsFrame
open Inv48.FundingFallthrough
namespace Inv48.ActualSiteGuardJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 400000

theorem planPrefix (t : FunctionTable) (ss : List Stmt) (i : Nat) (path : Path)
    (present : (certifiedPlan (.block i path) t (.block ss)).isSome = true) :
    prefixes t (ss.take i) = true ∧
      ∃ child ys, ss.drop i = child::ys ∧ (certifiedPlan path t child).isSome = true := by
  unfold certifiedPlan at present
  dsimp only at present
  split at present
  · rename_i safe
    refine ⟨safe,?_⟩
    split at present
    · contradiction
    · rename_i child ys eq
      cases found : certifiedPlan path t child with
      | none => simp [found] at present
      | some p => exact ⟨child,ys,eq,by simp [found]⟩
  · contradiction

theorem safePrefixes : prefixes Inv48.Source.model.core.table cleanup = true ∧
    prefixes Inv48.Source.model.core.table guards = true ∧
    prefixes Inv48.Source.model.core.table [Inv48.GuardArgsFrame.guard 5] = true := by
  have depth := checkedSharedPlan
  unfold sharedPlanDepth at depth
  cases registered : request with
  | none => simp only [registered,Option.bind_none] at depth; contradiction
  | some fn =>
    rw [registered] at depth
    have present : (certifiedPlan sharedPath Inv48.Source.model.core.table fn.body).isSome = true := by
      cases found : certifiedPlan sharedPath Inv48.Source.model.core.table fn.body with
      | none => simp [found] at depth
      | some p => rfl
    rw [shape fn registered] at present
    obtain ⟨clean,child,ys,split,inside⟩ := planPrefix _ _ 6 (.block 6 (.block 4 .here)) present
    simp only [cleanup,List.cons_append,List.nil_append,List.take,List.drop] at clean split
    obtain ⟨eq,_⟩ := List.cons.inj split
    subst child
    obtain ⟨all,_,_,_,_⟩ := planPrefix _ _ 6 (.block 4 .here) inside
    have combined : prefixes Inv48.Source.model.core.table
        (guards ++ [Inv48.GuardArgsFrame.guard 5]) = true := by
      simpa only [guards,List.cons_append,List.nil_append,List.take] using all
    have parts : prefixes Inv48.Source.model.core.table guards = true ∧
        prefixes Inv48.Source.model.core.table [Inv48.GuardArgsFrame.guard 5] = true := by
      simpa only [prefixes,List.all_append,Bool.and_eq_true] using combined
    exact ⟨clean,parts⟩

theorem safeCleanup : prefixes Inv48.Source.model.core.table cleanup = true := safePrefixes.1
theorem safeGuards : prefixes Inv48.Source.model.core.table guards = true := safePrefixes.2.1
theorem safeHoist : prefixes Inv48.Source.model.core.table [Inv48.GuardArgsFrame.guard 5] = true := safePrefixes.2.2
end Inv48.ActualSiteGuardJoin
