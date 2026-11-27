import Inv12PremiumArgs
import Inv12Fold
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

def serviceSelector := 2066428131
def rootGetter : Source.Stmt := .tryExternalCall .staticcall (.immutable "securityPool") (encodeWordsExpr serviceSelector [])
  (.word 0) none false false [⟨"__ext0",.address,false⟩] [.none]
  (.assign (.var Inv03.Bodies.tmp) (.var "__ext0")) []

def rootReply (c : Context) (r : Runtime) (root : Nat) (out : EvmCompiler.Simulation.CallResponse) :=
  replied c r out.postWorld (.lowLevelCall (decodeCallResponse out .staticcall root (wireBytes serviceSelector []) 0 none))

theorem rootGetterRun (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (root addr : Nat)
    (rows : ScriptedResponder) (out : EvmCompiler.Simulation.CallResponse)
    (read : (Source.Expr.immutable "securityPool").evalWithRuntimeByContext c r=.ok (.word root,r))
    (size : root<Inv32Division.R) (away : wordEq root c.self=false) (ok : out.success=true)
    (ans : rows.answerCall? (snapshotWorld c r.state) (buildCallRequest c .staticcall root (wireBytes serviceSelector []) 0 none)=some out)
    (decoded : abiDecodeValuesExcept? [.address] ((byteArrayToBytes out.returnData).map normByte)=.ok [.word addr])
    (old : r.lookupLocal? Inv03.Bodies.tmp=some (.word 0)) (next : Runtime)
    (written : ((rootReply c r root out).withFrame [("__ext0",.word addr)]).assignLocal? Inv03.Bodies.tmp (.word addr)=some next) :
    (Stmt.eval (n+2) t c r rootGetter).runWith rows=.ok (.normal next.popScope) := by
  let inner := (rootReply c r root out).withFrame [("__ext0",.word addr)]
  have prior : inner.lookupLocal? Inv03.Bodies.tmp=some (.word 0) := old
  have copy := Inv32Temps.copy n t c inner next Inv03.Bodies.tmp "__ext0" 0 addr prior rfl written
  have E := calldata c r serviceSelector (by decide) [] [] .nil
  have Z := wordFromRead c r _ _ (Inv08.Authority.literal _ _ 0 (by decide))
  unfold rootGetter
  rw [Stmt.eval]
  simp only [read,Z,E,Value.expectWord,Value.asBytes?,show Shared.norm root=root from Nat.mod_eq_of_lt size,
    wireClean,show Shared.norm 0=0 by rfl,selfDispatchKindOk,away,Bool.true_and,Bool.false_and,
    Bool.not_false,Bool.not_true,Bool.and_false,Bool.false_or,Bool.false_eq_true,if_false]
  unfold selfDispatchCall
  simp only [selfDispatchKindOk,away,Bool.and_false,Bool.false_eq_true,if_false]
  unfold emitLowLevelCall
  simp only [Bind.bind,EvmCompiler.Simulation.Interaction.bind,SolI.runWith,ans]
  have success : (decodeCallResponse out .staticcall root (wireBytes serviceSelector []) 0 none).success=true := ok
  have ret : abiDecodeValuesExcept? [.address] ((decodeCallResponse out .staticcall root (wireBytes serviceSelector []) 0 none).output.map normByte)=.ok [.word addr] := decoded
  simp only [success,if_true,List.map_cons,List.map_nil,ret]
  have accept : AbiCleanups.acceptOrUnspecified [.none] [.word addr]=true := by simp [AbiCleanups.acceptOrUnspecified,AbiCleanups.accept,AbiCleanup.accepts]
  have frame : BindingDecl.bindArgs? [⟨"__ext0",.address,false⟩] [.word addr]=some [("__ext0",.word addr)] := rfl
  simp only [accept,if_true,frame]
  change SolI.runWith rows (Stmt.eval (n+1) t c inner (.assign (.var Inv03.Bodies.tmp) (.var "__ext0")) >>= fun result =>
    pure (result.mapRuntime Runtime.popScope))=_
  rw [copy];rfl
end Inv12
