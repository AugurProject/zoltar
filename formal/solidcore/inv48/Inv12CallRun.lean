import Inv12ResponseLedger
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

def premiumCall (callee data : Source.Expr) : Source.Stmt :=
  .tryExternalCall .call callee data (.word 0) none false true [] [] .skip []

theorem noReturnDecode (bs : List Source.Byte) : abiDecodeValuesExcept? [] bs=.ok [] := by
  simp [abiDecodeValuesExcept?,Ty.listAbiHeadWords?,abiDecodeOpt,abiDecodeValuesAux?,Bind.bind,Except.bind,Pure.pure,Except.pure]

theorem runPremiumCall (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (callee data : Source.Expr)
    (address : Nat) (bytes : List Source.Byte) (responder : ScriptedResponder) (out : EvmCompiler.Simulation.CallResponse)
    (target : callee.evalWithRuntimeByContext c r=.ok (.word address,r))
    (zero : (Source.Expr.word 0).evalWithRuntimeByContext c r=.ok (.word 0,r))
    (encoded : data.evalWithRuntimeByContext c r=.ok (.bytes bytes,r))
    (canonical : Shared.norm address=address) (octets : bytes.map normByte=bytes)
    (away : wordEq address c.self=false) (existsCode : r.state.envAccountHasCode c address=true)
    (answered : responder.answerCall? (snapshotWorld c r.state) (buildCallRequest c .call address bytes 0 none)=some out)
    (success : out.success=true) :
    (Stmt.eval (n+2) t c r (premiumCall callee data)).runWith responder=.ok
      (.normal (replied c r out.postWorld (.lowLevelCall (decodeCallResponse out .call address bytes 0 none)))) := by
  unfold premiumCall
  rw [Stmt.eval]
  simp only [canonical,octets,show Shared.norm 0=0 by rfl,target,zero,encoded,Value.expectWord,Value.asBytes?,selfDispatchKindOk,away,existsCode,
    Bool.true_and,Bool.false_and,Bool.not_false,Bool.not_true,Bool.and_false,Bool.false_or,Bool.false_eq_true,if_false]
  unfold selfDispatchCall
  simp only [selfDispatchKindOk,away,Bool.and_false,Bool.false_eq_true,if_false]
  unfold emitLowLevelCall
  simp only [Bind.bind,EvmCompiler.Simulation.Interaction.bind,SolI.runWith,answered]
  simp only [decodeCallResponse,success,if_true,List.map_nil,noReturnDecode]
  simp only [show AbiCleanups.acceptOrUnspecified [] []=true by rfl,if_true,BindingDecl.bindArgs?,Stmt.eval]
  rfl
end Inv12
