import Inv39FrameMemory
open SolidCore.Solidity.Source
namespace Inv39.Init
def safeTemplate : Value → Prop
  | .storageRef _ | .storageSlotRef _ _ => False
  | .abiLazy _ inner => safeTemplate inner
  | _ => True
theorem coerceTemplate (old v output : Value) (valid : safeTemplate old) (ok : old.coerceLike? v=some output) : safeTemplate output := by
  cases v with
  | abiLazy tag value =>
    simp only [Value.coerceLike?] at ok
    cases co:old.coerceLike? value with
    | none => simp [co] at ok
    | some q =>
      simp [co] at ok; subst output
      exact coerceTemplate old value q valid co
  | _ =>
    all_goals cases old <;> first | contradiction | skip
    all_goals try case abiLazy a inner => exact coerceTemplate inner _ _ valid (by simpa only [Value.coerceLike?] using ok)
    all_goals first
      | simp only [Value.coerceLike?] at ok; contradiction
      | simp only [Value.coerceLike?] at ok; cases ok; trivial
      | simp only [Value.coerceLike?] at ok; split at ok <;> first | cases ok; trivial | contradiction
termination_by sizeOf old+sizeOf v
decreasing_by all_goals subst_vars <;> simp_wf <;> omega
def safeFrame (f : Frame) := ∀ p∈f, safeTemplate p.2
def safeEnv (l : LocalEnv) := ∀ f∈l, safeFrame f
end Inv39.Init
