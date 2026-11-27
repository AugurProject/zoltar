import Inv39CheckedHistory
import Inv39RepeatExclusion

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.MarkerHistory

/-- Physical key separation; no hash-injectivity claim is made. -/
def Apart (key : Nat) : Prop := Shared.norm key ≠ Shared.norm 7

theorem store (s : State) (key value : Nat) (apart : Apart key) :
    (s.storeSlot key value).loadSlot 7 = s.loadSlot 7 :=
  loadUnchanged s key value 7 apart

theorem approval (s post : State) (caller self spender value : Nat)
    (out : List Source.Value) (cw : caller < 2^160) (sw : spender < 2^160)
    (vw : value < R) (apart : Apart (Allowance.slot caller spender))
    (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "approve")
      (Child.callContext caller self) s [.word spender, .word value] = some (.returned post out)) :
    post.loadSlot 7 = s.loadSlot 7 := by
  have physical := Allowance.actualApproval s post caller self spender value out cw sw vw actual
  have same : post.loadSlot 7 = (s.storeSlot (Allowance.slot caller spender) value).loadSlot 7 := by
    simp only [State.loadSlot, physical]
  exact same.trans (store s _ value apart)

theorem cancellation (c : Context) (s post : State) (owner nonce v rr ss : Nat)
    (out : List Source.Value) (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient)
    (noValue : c.value = 0) (apart : Apart (Auth.flagSlot owner nonce))
    (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "cancelAuthorization")
      c s (Auth.cancelArgs owner nonce v rr ss) = some (.returned post out)) :
    post.loadSlot 7 = s.loadSlot 7 := by
  exact (Auth.actualCancellation c s post owner nonce v rr ss out wf tf noValue actual 7).trans
    (store s _ 1 apart)

theorem permit (c : Context) (s post : State) (owner spender value deadline v rr ss : Nat)
    (out : List Source.Value) (ow : owner < 2^160) (sw : spender < 2^160)
    (vw : value < R) (dw : deadline < R) (byte : v < 256)
    (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value = 0)
    (fields : c.storageFields = model.core.context.storageFields)
    (events : c.eventDecls = model.core.context.eventDecls)
    (nonceApart : Apart (Auth.nonceSlot owner))
    (allowanceApart : Apart (Allowance.slot owner spender))
    (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "permit")
      c s (Auth.permitArgs owner spender value deadline v rr ss) = some (.returned post out)) :
    post.loadSlot 7 = s.loadSlot 7 := by
  obtain ⟨nv, physical⟩ := Auth.actualPermit c s post owner spender value deadline v rr ss out
    ow sw vw dw byte wf tf noValue fields events actual
  exact (physical 7).trans ((store _ _ value allowanceApart).trans (store s _ nv nonceApart))

/-- A history of checked calls whose exact write effects have been joined here.
This is deliberately narrower than Completed: movement cases are not certified. -/
inductive Calls : State → State → Prop where
  | nil (s) : Calls s s
  | approval {s mid post caller self spender value out}
      (cw : caller < 2^160) (sw : spender < 2^160) (vw : value < R)
      (apart : Apart (Allowance.slot caller spender))
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "approve")
        (Child.callContext caller self) s [.word spender, .word value] = some (.returned mid out))
      (tail : Calls mid post) : Calls s post
  | cancellation {s mid post c owner nonce v rr ss out}
      (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value = 0)
      (apart : Apart (Auth.flagSlot owner nonce))
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "cancelAuthorization")
        c s (Auth.cancelArgs owner nonce v rr ss) = some (.returned mid out))
      (tail : Calls mid post) : Calls s post
  | permit {s mid post c owner spender value deadline v rr ss out}
      (ow : owner < 2^160) (sw : spender < 2^160) (vw : value < R) (dw : deadline < R) (byte : v < 256)
      (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value = 0)
      (fields : c.storageFields = model.core.context.storageFields)
      (events : c.eventDecls = model.core.context.eventDecls)
      (nonceApart : Apart (Auth.nonceSlot owner)) (allowanceApart : Apart (Allowance.slot owner spender))
      (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "permit")
        c s (Auth.permitArgs owner spender value deadline v rr ss) = some (.returned mid out))
      (tail : Calls mid post) : Calls s post

theorem preserved {s post : State} (history : Calls s post) : post.loadSlot 7 = s.loadSlot 7 := by
  induction history with
  | nil => rfl
  | approval cw sw vw apart actual tail ih => exact ih.trans (approval _ _ _ _ _ _ _ cw sw vw apart actual)
  | cancellation wf tf noValue apart actual tail ih =>
    exact ih.trans (cancellation _ _ _ _ _ _ _ _ _ wf tf noValue apart actual)
  | permit ow sw vw dw byte wf tf noValue fields events nonceApart allowanceApart actual tail ih =>
    exact ih.trans (permit _ _ _ _ _ _ _ _ _ _ _ ow sw vw dw byte wf tf noValue fields events nonceApart allowanceApart actual)

/-- Joins any independently proved successful-initialization marker certificate.
The history contains executions and input/key conditions, never post-marker premises. -/
theorem repeatExcluded {initialized post : State} (history : Calls initialized post)
    (initializedMarker : Shared.norm (initialized.loadSlot 7) ≠ 0)
    (next : State) (caller self uid cap rep : Nat) (out : List Source.Value) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext caller self) post [.word uid, .word cap, .word rep] ≠ some (.returned next out) := by
  apply Repeat.publicExclusion
  rwa [preserved history]

end Inv39.Init.MarkerHistory
