import Inv48ChildExtractionCore
import Inv12NoEarlyExit
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.EscrowPrefix
namespace Inv48.ChildExtraction
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

def Matches (rows : ScriptedResponder) (trace : Interaction.Transcript) : Prop :=
  ∀ event ∈ trace, Inv48.NestedResponder.answer rows event.query = some event.answer

theorem observedMatches {α : Type} (budget : Nat) (rows : ScriptedResponder)
    (tree : SolI α) (observed : Inv48.NestedResponder.Observation tree)
    (computed : Inv48.NestedResponder.observe budget rows tree = some observed) :
    Matches rows observed.trace := by
  induction budget generalizing tree with
  | zero => simp [Inv48.NestedResponder.observe] at computed
  | succ budget ih =>
    cases tree with
    | done out =>
      simp only [Inv48.NestedResponder.observe, Option.some.injEq] at computed
      subst observed
      intro event mem
      cases mem
    | request q next =>
      simp only [Inv48.NestedResponder.observe] at computed
      cases ans : Inv48.NestedResponder.answer rows q with
      | none => simp [ans] at computed
      | some a =>
        cases tail : Inv48.NestedResponder.observe budget rows (next a) with
        | none => simp [ans,tail] at computed
        | some obs =>
          simp [ans,tail,Bind.bind,Option.bind,Pure.pure] at computed
          subst observed
          intro event mem
          rcases List.mem_cons.mp mem with eq | mem
          · subst event; exact ans
          · exact ih _ obs tail event mem

theorem foldStep {α : Type} (rows : ScriptedResponder) (q : Query)
    (next : Answer q → SolI α) (a : Answer q)
    (answered : Inv48.NestedResponder.answer rows q = some a) :
    SolI.runWith rows (.request q next) = SolI.runWith rows (next a) := by
  cases q with
  | resource r =>
    simp only [Inv48.NestedResponder.answer, Option.some.injEq] at answered
    subst a
    rfl
  | external world request =>
    cases request with
    | call request =>
      cases row : rows.answerCall? world request with
      | some response => simp [Inv48.NestedResponder.answer,row] at answered; subst a; simp [SolI.runWith,row]
      | none =>
        cases pre : precompileAnswerCall? world request with
        | none => simp [Inv48.NestedResponder.answer,row,pre] at answered
        | some response => simp [Inv48.NestedResponder.answer,row,pre] at answered; subst a; simp [SolI.runWith,row,pre]
    | create request =>
      simp only [Inv48.NestedResponder.answer] at answered
      simp only [SolI.runWith,answered]

theorem foldTrace {α : Type} (rows : ScriptedResponder) (tree : SolI α)
    (trace : Interaction.Transcript) (x : α) (aligned : Matches rows trace)
    (exec : ExecutesOK tree trace x) : tree.runWith rows = .ok x := by
  induction tree generalizing trace with
  | done out => cases exec; rfl
  | request q next ih =>
    cases exec with
    | request a tail =>
      rw [foldStep rows q next a (aligned ⟨q,a⟩ (List.mem_cons_self))]
      exact ih a _ (fun event mem => aligned event (List.mem_cons_of_mem _ mem)) tail

#print axioms safe
#print axioms foldTrace
end Inv48.ChildExtraction
