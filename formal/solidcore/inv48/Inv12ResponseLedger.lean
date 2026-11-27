import Inv12MatchedReply
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

theorem ordinaryCalls (calls : List LowLevelCallResult) : NoCoordinatorWrites (calls.map OracleRow.call) := by
  unfold NoCoordinatorWrites
  intro row member p post
  simp [ScriptedResponder.callRows,List.filterMap_map] at member
  obtain ⟨v,_,rfl⟩ := member
  cases post

theorem recordAfterMatchedReply (n : Nat) (c : Context) (r : Runtime) (f b : Ref) (rep extra old : Nat)
    (before after : List Nat) (responder : ScriptedResponder)
    (request : EvmCompiler.Simulation.CallRequest) (response : EvmCompiler.Simulation.CallResponse)
    (interaction : ExternalInteraction) (script : NoCoordinatorWrites responder)
    (answered : responder.answerCall? (snapshotWorld c (afterCredits r f b rep extra).state) request=some response)
    (fork : f.bound r "fork") (branch : b.bound r "branch") (cash : f.hasField 2 2) (total : f.hasField 1 1)
    (backing : b.hasField 4 3) (chosen : b.hasField 5 4) (amount : b.hasField 6 5) (ledger : f.hasField 5 5)
    (repValue : r.lookupLocal? "rep"=some (.word rep)) (comm : r.lookupLocal? "commitment"=some (.word extra))
    (fit : b.get r.state 3+rep<Inv32Division.R) (pos : 0<f.get r.state 1) (prev : b.get r.state 4=old)
    (parent : b.get r.state 5=f.get r.state 2*old/f.get r.state 1)
    (prior : f.get r.state 5=assigned (f.get r.state 2) (f.get r.state 1) (before++[old]++after))
    (covered : (before++[old+extra]++after).sum≤f.get r.state 1)
    (separate : ∀ i ∈ [3,4], ∀ j ∈ [1,2], b.addressOf i≠f.addressOf j)
    (sepAssigned : ∀ i ∈ [3,4,5], b.addressOf i≠f.addressOf 5)
    (wf : StorageMap.WF r.state.storage) :
    ∃ next, Stmt.eval (n+1) model.core.table c (replied c (afterCredits r f b rep extra) response.postWorld interaction)
      (.exprStmt (addMember "fork" 5 deltaExpr))=pure (.normal next) ∧
      f.get next.state 5=assigned (f.get r.state 2) (f.get r.state 1) (before++[old+extra]++after) :=
  assignedAfterCallback n c r f b rep extra old before after response.postWorld interaction fork branch cash total
    backing chosen amount ledger repValue comm fit pos prev parent prior covered separate sepAssigned
    (matchedReply c responder _ request response script answered) (afterCreditsWF _ _ _ _ _ wf)
end Inv12
