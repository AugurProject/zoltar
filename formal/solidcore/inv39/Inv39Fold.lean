import Inv39PrecompileEcho
import Inv39Frame
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv39.Fold
theorem bindRun {α β : Type} (rows : ScriptedResponder) (step : SolI α) (k : α → SolI β) :
    (step >>= k).runWith rows=(step.runWith rows >>= fun v=>(k v).runWith rows) := by
  induction step with
  | done result => cases result <;> rfl
  | request query cont ih =>
    cases query with
    | resource resource => exact ih _
    | external w req =>
      cases req with
      | call req =>
        simp only [Bind.bind,Interaction.bind,SolI.runWith]
        cases hit:rows.answerCall? w req with
        | some a => exact ih _
        | none => cases pre:precompileAnswerCall? w req <;> first | exact ih _ | rfl
      | create req =>
        simp only [Bind.bind,Interaction.bind,SolI.runWith]
        cases hit:rows.answerCreate? w req <;> first | exact ih _ | rfl
def Ensures (step : SolI α) (P : α → Prop) := ∀ x, step.runWith []=.ok x → P x
theorem weaken {step : SolI α} {P Q : α → Prop} (h : Ensures step P) (m : ∀ x,P x → Q x) : Ensures step Q := fun x hx=>m _ (h _ hx)
theorem pureValue (v : α) (P : α → Prop) (h : P v) : Ensures (pure v) P := by intro x hx; cases hx; exact h
theorem reject (e : SolidityFailure) (P : α → Prop) : Ensures (throw e) P := by intro x hx; cases e <;> contradiction
theorem bind {step : SolI α} {k : α → SolI β} {P : α → Prop} {Q : β → Prop} (pre : Ensures step P)
    (next : ∀ x,P x → Ensures (k x) Q) : Ensures (step >>= k) Q := by
  intro y hy; rw [bindRun] at hy
  cases e: step.runWith [] with
  | error err => rw [e] at hy; contradiction
  | ok x => rw [e] at hy; exact next x (pre x e) y hy
theorem fromFrame {step : SolI α} {P : α → Prop} (holds : Frame.Ensures step P) : Ensures step P := fun x hx=>Frame.selected holds [] _ hx
theorem caught {step : SolI α} {P : α → Prop} (h : Ensures step P) :
    Ensures step.caught (fun | .ok v=>P v | .error _=>True) := by
  intro res; cases res with
  | error err => intro; trivial
  | ok x =>
    intro run
    apply h
    clear h
    induction step with
    | done result =>
      cases result with
      | ok z => cases run; rfl
      | error er => cases er <;> cases run
    | request query cont ih =>
      change SolI.runWith [] (.request query (fun a=>SolI.caught (cont a)))=.ok (.ok x) at run
      cases query with
      | resource resource => exact ih _ run
      | external w req =>
        cases req with
        | call req =>
          simp only [SolI.runWith] at run ⊢
          cases hit:ScriptedResponder.answerCall? [] w req with
          | some a => rw [hit] at run; exact ih _ run
          | none =>
            rw [hit] at run
            cases pre:precompileAnswerCall? w req with
            | none => rw [pre] at run; contradiction
            | some a => rw [pre] at run; exact ih _ run
        | create req =>
          simp only [SolI.runWith] at run ⊢
          cases hit:ScriptedResponder.answerCreate? [] w req with
          | none => rw [hit] at run; contradiction
          | some a => rw [hit] at run; exact ih _ run
def echo (c : Context) (s t : State) := t=s ∨ t=adoptWorld (snapshotWorld c s) c s
theorem trans {c : Context} {s t u : State} (a : echo c s t) (b : echo c t u) : echo c s u := by
  rcases a with rfl|rfl
  · exact b
  rcases b with rfl|rfl
  · exact .inr rfl
  · exact .inr (by rw [snapshotWorld_adoptWorld,adoptWorld_idempotent])
attribute [irreducible] Ensures
end Inv39.Fold
