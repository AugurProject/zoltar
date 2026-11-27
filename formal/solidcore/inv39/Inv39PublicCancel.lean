import Inv39CancelBody
import Inv39CancelShape
import Inv39ObservedEntry
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Auth
def cancelArgs (o nonce v rr ss : Nat) : List Source.Value := [.word o,.word nonce,.word v,.word rr,.word ss]
def cancelFrame (o nonce v rr ss : Nat) : Frame := [("authorizer",.word o),("nonce",.fixedBytes 32 nonce),("v",.word v),("r",.fixedBytes 32 rr),("s",.fixedBytes 32 ss)]
theorem actualCancellation (c : Context) (s after : State) (o nonce v rr ss : Nat) (out : List Source.Value)
    (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value=0)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "cancelAuthorization") c s
      (cancelArgs o nonce v rr ss)=some (.returned after out)) :
    ∀ k,after.loadSlot k=(s.storeSlot (flagSlot o nonce) 1).loadSlot k := by
  obtain ⟨f,found,ps,rs,hash,sig,body,hashOK,sigOK⟩ := cancelLinked
  let fr := cancelFrame o nonce v rr ss
  let first := (CheckedWordCall.initial c s).withFrame fr
  have frame : f.initialFrame? (cancelArgs o nonce v rr ss)=some fr := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [fr,cancelFrame,cancelParams,cancelArgs,BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?]
  have safe : safeEnv first.locals := by
    intro frame h; change frame∈[fr] at h; obtain rfl := List.mem_singleton.mp h
    intro p mem; rcases p with ⟨k,x⟩; apply Or.inr
    simp [fr,cancelFrame] at mem; rcases mem with ⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩ <;> trivial
  let P := fun physical : StorageMap=>∀ k,({s with storage:=physical} : State).loadSlot k=(s.storeSlot (flagSlot o nonce) 1).loadSlot k
  apply entryStorage P s after c f _ _ out fr 50000 found frame (by simp [FunctionDef.acceptsValue,noValue,wordEq]) _ run
  rw [body]; exact cancelExecution 49993 o nonce c first hash sig wf tf (.inr rfl) safe rfl rfl hashOK sigOK
end Inv39.Auth
