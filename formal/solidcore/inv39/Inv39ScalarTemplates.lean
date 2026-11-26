import Inv39AuthScopes
open SolidCore.Solidity.Source
namespace Inv39.Auth
def scalar : Ty → Bool | .address | .uint256 | .fixedBytes _ | .bool=>true | _=>false
theorem coerced (ty : Ty) (v out : Value) (supported : scalar ty) (ok : ty.coerceValue? v=some out) : Init.safeTemplate out := by
  cases v with
  | abiLazy tag inner =>
    simp only [Ty.coerceValue?] at ok
    cases got:ty.coerceValue? inner with
    | none => simp [got] at ok
    | some q => simp [got] at ok; subst out; exact coerced ty inner q supported got
  | _ =>
    all_goals cases ty <;> first | contradiction | skip
    all_goals simp only [Ty.coerceValue?] at ok
    all_goals first | contradiction | cases ok; trivial | split at ok <;> first | contradiction | cases ok; trivial
termination_by sizeOf v
theorem defaultSafe (ty : Ty) (supported : scalar ty) : Init.safeTemplate ty.defaultValue := by
  cases ty <;> first | simp [Ty.defaultValue,Init.safeTemplate] | contradiction
end Inv39.Auth
