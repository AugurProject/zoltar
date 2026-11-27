import Inv48ReportingGuardFrameUniverse
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ReportingGuardFrame
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

theorem boolFrame (values : List Value) (frame : Frame)
    (bound : BindingDecl.bindArgs? [⟨"__ext0",.bool,false⟩] values = some frame) :
    ∃ value, frame = [("__ext0",value)] := by
  cases values with
  | nil => contradiction
  | cons v vs =>
    simp only [BindingDecl.bindArgs?,BindingDecl.bindArg?] at bound
    cases coerced : Ty.bool.coerceValue? v with
    | none => simp [coerced] at bound
    | some value =>
      cases vs <;> simp only [coerced,BindingDecl.bindArgs?,Bind.bind,Option.bind] at bound
      · cases bound; exact ⟨value,rfl⟩
      · contradiction

theorem reportingReply (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (tail : Frame) (rest : LocalEnv)
    (shape : r.locals = ((hoist,.word 0)::tail)::rest)
    (response : LowLevelCallResult × State) (trace : Interaction.Transcript)
    (run : ExecutesOK (Inv48.EscrowTrace.transferReply (n+1) t c r response)
      trace (.normal final)) :
    ∃ value, final.locals = ((hoist,value)::tail)::rest := by
  unfold Inv48.EscrowTrace.transferReply at run
  split at run
  next success =>
    split at run
    next decoded decode =>
      split at run
      next accepted =>
        split at run
        next frame bound =>
          obtain ⟨value,rfl⟩ := boolFrame decoded frame bound
          obtain ⟨out,before,after,joined,assigned,last⟩ := bindSuccessful _ _ _ _ run
          have h := pureResult _ _ _ last
          cases out <;> simp only [Result.mapRuntime] at h
          all_goals try { cases h.2 }
          case normal inner =>
            cases h.2
            obtain ⟨v,write⟩ := assignVar n t c _ inner hoist "__ext0" 0
              (by simp [Runtime.withFrame,Runtime.recordExternalInteraction,
                Runtime.lookupLocal?,shape,hoist,LocalEnv.lookup?,Frame.lookup?]) before assigned
            obtain ⟨out,eq⟩ := assignSecond _ inner hoist 0 [("__ext0",value)] tail rest
              (by simp [Frame.lookup?,hoist])
              (by simp [Runtime.withFrame,Runtime.recordExternalInteraction,shape]) v write
            exact ⟨out,by simp [Runtime.popScope,eq]⟩
        next bad => have h := pureResult _ _ _ run; cases h.2
      next bad => have h := pureResult _ _ _ run; cases h.2
    next err decode => have h := pureResult _ _ _ run; cases h.2
  next failed => have h := pureResult _ _ _ run; cases h.2

theorem reportingCall (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (tail : Frame) (rest : LocalEnv)
    (shape : r.locals = ((hoist,.word 0)::tail)::rest) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+2) t c r reportingP.value) trace (.normal final)) :
    ∃ value, final.locals = ((hoist,value)::tail)::rest := by
  obtain ⟨target,targetEq⟩ := foldedFrozen c r (.immutable "securityPool")
    (immutableFrozen c r "securityPool")
  obtain ⟨payload,payloadEq⟩ := foldedFrozen c r calldataP.value (calldataFrozen c r)
  change ExecutesOK (Stmt.eval (n+2) t c r (.tryExternalCall .staticcall
    (.immutable "securityPool") calldataP.value (.word 0) none false false
    [⟨"__ext0",.bool,false⟩] [.none] (.assign (.var hoist) (.var "__ext0")) []))
    trace (.normal final) at run
  rw [Stmt.eval] at run
  dsimp only at run
  rw [targetEq] at run
  cases target with
  | error err => have h := pureResult _ _ _ run; cases h.2
  | ok target =>
    simp only [Except.map] at run
    cases word : target.expectWord with
    | error err => rw [word] at run; have h := pureResult _ _ _ run; cases h.2
    | ok target =>
      rw [word] at run
      have zero : (.word 0 : Expr).evalWithRuntimeByContext c r = .ok (.word 0,r) := rfl
      simp only [zero,Value.expectWord] at run
      rw [payloadEq] at run
      cases payload with
      | error err => have h := pureResult _ _ _ run; cases h.2
      | ok payload =>
        simp only [Except.map] at run
        cases bytes : payload.asBytes? with
        | none => simp only [bytes] at run; have h := pureResult _ _ _ run; cases h.2
        | some bytes =>
          simp only [bytes] at run
          split at run
          next rejected => have h := pureResult _ _ _ run; cases h.2
          next allowed =>
            obtain ⟨response,before,after,_,_,reply⟩ := bindSuccessful _ _ _ _ run
            have noCatch (raw : List Byte) : TryCatchClause.findMatch? raw [] = none := by
              unfold TryCatchClause.findMatch?
              cases revertClassify raw <;> rfl
            simp only [noCatch,List.map_cons,List.map_nil] at reply
            exact reportingReply n t c r final tail rest shape response after reply
end Inv48.ReportingGuardFrame
