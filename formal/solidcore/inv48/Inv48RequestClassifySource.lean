import Inv48RequestClassifyCore
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.RequestGuards
namespace Inv48.RequestClassify
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

structure Plan (table : FunctionTable) (target stmt : Stmt) where
  depth : Nat
  build : ∀ n, Route table target (n+depth) stmt

def plan (path : Path) (table : FunctionTable) (stmt : Stmt) :
    Option (Plan table Inv48.RequestQuote.quoteCaptureP.value stmt) :=
  match path with
  | .here =>
    if h : Inv48.RequestQuote.quoteCaptureP.test stmt = true then
      some ⟨0,fun n => by
        have eq := Inv48.RequestQuote.quoteCaptureP.sound stmt h
        rw [eq]
        exact .here n⟩
    else none
  | .block i next =>
    match stmt with
    | .block ss =>
      match split : ss.drop i with
      | [] => none
      | child::ys => do
        let p ← plan next table child
        return ⟨p.depth+1,fun n => by
          have eq : ss.take i ++ child::ys = ss := by
            simpa only [split] using List.take_append_drop i ss
          rw [← eq]
          exact .block (n+p.depth) _ _ _ (p.build n)⟩
    | _ => none
  | .capture next =>
    match stmt with
    | .captureReturn names child => do
      let p ← plan next table child
      return ⟨p.depth+1,fun n => .capture (n+p.depth) names child (p.build n)⟩
    | _ => none
  | .call next =>
    match stmt with
    | .internalCall targets key args =>
      match found : table.lookup? key with
      | none => none
      | some fn => do
        let p ← plan next table fn.body
        return ⟨p.depth+1,fun n => .call (n+p.depth) targets key args fn found (p.build n)⟩
    | _ => none

def publicPlanDepth : Option Nat := do
  let fn ← Inv48.RequestPrologue.publicRequest
  let p ← plan requestPath Inv48.Source.model.core.table fn.body
  return p.depth

theorem checkedDepth : publicPlanDepth = some 9 := by native_decide

/-- Availability concerns source shape only; no execution or search budget. -/
theorem publicRoute (fn : FunctionDef)
    (registered : Inv48.RequestPrologue.publicRequest = some fn) (n : Nat) :
    Nonempty (Route Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value (n+9) fn.body) := by
  have h := checkedDepth
  unfold publicPlanDepth at h
  rw [registered] at h
  cases hp : plan requestPath Inv48.Source.model.core.table fn.body with
  | none => simp [hp] at h
  | some p =>
    have depth : p.depth = 9 := by simpa [hp] using h
    exact ⟨by simpa only [depth] using p.build n⟩

/-- Every completed source execution is inverted; no `seek`, `publicQuote`,
responder, budget or supplied reachability assumption occurs. -/
theorem publicClassification (fn : FunctionDef)
    (registered : Inv48.RequestPrologue.publicRequest = some fn) (n : Nat)
    (c : Context) (state : State) (p a bounty : Nat)
    (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes (Stmt.eval (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body) trace (.ok out)) :
    Nonempty (Exit (Stmt.eval (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body) trace out) ∨
    Nonempty (Site (Stmt.eval (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body)
      Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out) := by
  obtain ⟨route⟩ := publicRoute fn registered n
  have unit : (Stmt.eval (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body >>= pure) =
      Stmt.eval (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a bounty) fn.body := Interaction.bind_pure _
  have classified := classify route c (Inv48.RequestPrologue.publicBase c state p a bounty)
    pure trace out (by rwa [unit])
  rwa [unit] at classified
end Inv48.RequestClassify
