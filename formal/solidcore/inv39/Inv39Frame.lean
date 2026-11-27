import Inv39Slots
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv39.Frame
def onSuccess {α : Type} (P : α → Prop) : Except SolidityFailure α → Prop | .ok x => P x | .error _ => True
abbrev Ensures {α : Type} (tree : SolI α) (P : α → Prop) := Interaction.AllDone (onSuccess P) tree
theorem pureValue {P : α → Prop} (v : α) (h : P v) : Ensures (pure v) P := .done h
theorem failure {P : α → Prop} (e : SolidityFailure) : Ensures (throw e : SolI α) P := .done trivial
theorem bind {t : SolI α} {k : α → SolI β} {P : α → Prop} {Q : β → Prop}
    (first : Ensures t P) (next : ∀ x, P x → Ensures (k x) Q) : Ensures (t >>= k) Q :=
  first.bind (fun _ _ => trivial) next
theorem weaken {t : SolI α} {P Q : α → Prop} (h : Ensures t P) (next : ∀ x, P x → Q x) : Ensures t Q :=
  h.mono (fun | .ok x, h => next x h | .error _, _ => trivial)
theorem caught {t : SolI α} {P : α → Prop} (h : Ensures t P) : Ensures t.caught (fun | .ok v => P v | .error _ => True) := by
  induction h with
  | @done outcome holds =>
    cases outcome with
    | ok v => exact pureValue _ holds
    | error e => cases e <;> apply Interaction.AllDone.done <;> trivial
  | @request q k _ ih => exact .request ih
theorem selected {t : SolI α} {P : α → Prop} (holds : Ensures t P) (responder : ScriptedResponder)
    (v : α) (actual : SolI.runWith responder t=.ok v) : P v := by
  induction holds with
  | @done outcome prop =>
    cases outcome with
    | ok x => cases actual; exact prop
    | error e => contradiction
  | @request q k _ ih =>
    cases q with
    | resource r => exact ih _ actual
    | external world req =>
      cases req with
      | call req =>
        rw [SolI.runWith] at actual
        split at actual
        · exact ih _ actual
        · split at actual <;> first | exact ih _ actual | contradiction
      | create req =>
        rw [SolI.runWith] at actual
        split at actual <;> first | exact ih _ actual | contradiction
def StmtPreserves (P : Runtime → Prop) (t : FunctionTable) (c : Context) (s : Stmt) :=
  ∀ n r, P r → Ensures (Stmt.eval n t c r s) (fun out => P out.runtime)
theorem sequence {P : Runtime → Prop} {ss : List Stmt} {t : FunctionTable} {c : Context}
    (every : ∀ s ∈ ss, StmtPreserves P t c s) (n : Nat) (r : Runtime) (initial : P r) :
    Ensures (Stmt.evalList n t c r ss) (fun out => P out.runtime) := by
  induction ss generalizing r with
  | nil => rw [Stmt.evalList]; exact pureValue (P:=fun out : Result => P out.runtime) (Result.normal r) initial
  | cons s tail ih =>
    rw [Stmt.evalList]
    apply bind (every s List.mem_cons_self n r initial)
    intro res holds
    cases res with
    | normal r => exact ih (fun z hz => every z (List.mem_cons_of_mem s hz)) r holds
    | _ => exact pureValue _ holds
theorem block {P : Runtime → Prop} {ss : List Stmt} {t : FunctionTable} {c : Context}
    (enter : ∀ r, P r → P r.pushScope) (leave : ∀ r, P r → P r.popScope)
    (every : ∀ s ∈ ss, StmtPreserves P t c s) : StmtPreserves P t c (.block ss) := by
  intro n r h
  cases n with
  | zero => rw [Stmt.eval]; exact failure _
  | succ n =>
    rw [Stmt.eval]
    apply bind (sequence every n _ (enter r h))
    intro res holds
    apply pureValue
    cases res <;> exact leave _ holds
end Inv39.Frame
