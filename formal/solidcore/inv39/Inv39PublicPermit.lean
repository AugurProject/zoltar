import Inv39PermitBody
import Inv39PermitLink
import Inv39ObservedEntry
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
def permitArgs (o sp value deadline vv rr ss : Nat) : List Source.Value := [.word o,.word sp,.word value,.word deadline,.word vv,.word rr,.word ss]
def permitFrame (o sp value deadline vv rr ss : Nat) : Frame := [("owner",.word o),("spender",.word sp),("value",.word value),("deadline",.word deadline),("v",.word vv),("r",.fixedBytes 32 rr),("s",.fixedBytes 32 ss)]
theorem actualPermit (c : Context) (s after : State) (o sp v deadline vv rr ss : Nat) (out : List Source.Value)
    (ow : o<2^160) (sw : sp<2^160) (vf : v<R) (df : deadline<R) (byte : vv<256)
    (wf : StorageMap.WF s.storage) (tf : StorageMap.WF s.transient) (noValue : c.value=0)
    (fields : c.storageFields=model.core.context.storageFields) (events : c.eventDecls=model.core.context.eventDecls)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "permit") c s
      (permitArgs o sp v deadline vv rr ss)=some (.returned after out)) :
    permittedSlots s o sp v after := by
  obtain ⟨f,found,ps,rs,cond,hash,sig,body,condOK,hashOK,sigOK⟩ := permitLinked
  let fr := permitFrame o sp v deadline vv rr ss
  let first := (CheckedWordCall.initial c s).withFrame fr
  have frame : f.initialFrame? (permitArgs o sp v deadline vv rr ss)=some fr := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps,rs]; simp [fr,permitFrame,permitParams,permitArgs,BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?]
  have safe : safeEnv first.locals := by
    intro frame h; change frame∈[fr] at h; obtain rfl := List.mem_singleton.mp h
    intro p mem; rcases p with ⟨k,x⟩; apply Or.inr
    simp [fr,permitFrame] at mem; rcases mem with ⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩|⟨rfl,rfl⟩ <;> trivial
  let P := fun physical : StorageMap=>permittedSlots s o sp v {s with storage:=physical}
  apply entryStorage P s after c f _ _ out fr 50000 found frame (by simp [FunctionDef.acceptsValue,noValue,wordEq]) _ run
  rw [body]; exact permitExecution 49985 o sp v deadline vv c first cond hash sig ow sw vf df byte wf tf safe rfl rfl rfl rfl rfl condOK hashOK sigOK fields events
end Inv39.Auth
