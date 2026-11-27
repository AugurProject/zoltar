import Inv48RequestClassifyDecision
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards Inv48.RequestDispatch
namespace Inv48.RequestClassify
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

/-- Extract the selected site from the *true branch of this traversal*, with
both halves of the original trace and all enclosing continuations retained. -/
theorem selected (route : Route table target fuel stmt)
    (h : Follows route c r k trace out true) :
    ∃ s : Site (Stmt.eval fuel table c r stmt >>= k) table target trace out,
      s.context = {c with checked := s.context.checked} := by
  induction route generalizing c r k trace out with
  | here fuel =>
    refine ⟨⟨fuel,c,r,k,[],trace,by simp,.refl _,h.2⟩,?_⟩
    cases c
    rfl
  | block n xs child ys inside ih =>
    obtain ⟨v,before,after,split,first,last⟩ := h
    cases v with
    | normal mid =>
      obtain ⟨s,origin⟩ := ih last
      refine ⟨⟨s.fuel,s.context,s.runtime,s.continuation,before++s.before,s.after,?_,?_,s.suffix⟩,origin⟩
      · exact split.trans ((congrArg (fun t => before++t) s.split).trans (List.append_assoc _ _ _).symm)
      · rw [blockSplit,assoc]
        exact (Prefix.ofExecution first _).trans (by simpa only [assoc] using s.reached)
    | returned mid values => cases last.1
    | constructorReturned mid code => cases last.1
    | selfdestructed mid => cases last.1
    | reverted mid err => cases last.1
    | broke mid => cases last.1
    | continued mid => cases last.1
  | capture n names child inside ih =>
    obtain ⟨s,origin⟩ := ih h
    refine ⟨⟨s.fuel,s.context,s.runtime,s.continuation,s.before,s.after,s.split,?_,s.suffix⟩,origin⟩
    simpa only [Stmt.eval,assoc] using s.reached
  | call n targets key args fn found inside ih =>
    obtain ⟨v,before,after,split,first,last⟩ := h
    cases v with
    | error err => cases last.1
    | ok pair =>
      obtain ⟨values,mid⟩ := pair
      cases entered : internalCallEnter? fn values mid with
      | none => simp only [entered] at last; cases last.1
      | some pair =>
        obtain ⟨inner,saved⟩ := pair
        simp only [entered] at last
        obtain ⟨s,origin⟩ := ih last
        refine ⟨⟨s.fuel,s.context,s.runtime,s.continuation,before++s.before,s.after,?_,?_,s.suffix⟩,?_⟩
        · exact split.trans ((congrArg (fun t => before++t) s.split).trans (List.append_assoc _ _ _).symm)
        · rw [Stmt.eval]
          change Prefix (((Expr.evalRefArgList c r args).caught >>= callNext n table c r targets key) >>= k) _ _
          rw [assoc]
          apply (Prefix.ofExecution first _).trans
          simpa only [callNext,found,entered,assoc] using s.reached
        · simpa only using origin
end Inv48.RequestClassify
