import Inv12PremiumArgs
import Inv12Fold
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv48.Minima
theorem copyClean (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (dst src : String) (old v : Nat) (d : r.lookupLocal? dst = some (.word old))
    (fit : v<Inv32Division.R) (s : r.lookupLocal? src = some (.word v)) (u : r.assignLocal? dst (.word v) = some next) :
    Stmt.eval (n+1) t c r (.assign (.var dst) (.castOp .uintCleanup 256 (.var src))) = pure (.normal next) := by
  have ds : r.lookupMemoryRef? dst = none := by simp [Runtime.lookupMemoryRef?,d]
  have ss : r.lookupStorageBase? src = none := by simp [Runtime.lookupStorageBase?,s]
  have read : Expr.eval c r (.castOp .uintCleanup 256 (.var src)) = pure (.word v,r) :=
    Inv32Guards.clean _ _ _ _ _ fit (Inv32Guards.readWord _ _ _ _ _ s)
  have resolved := Inv32Writes.resolve c r dst old d
  have written : (ResolvedLValue.local dst).write c r (.word v) = .ok next := by simp [ResolvedLValue.write,u]
  rw [Stmt.eval]; dsimp only
  simp only [ds,LValue.wantsMemoryRefRhs,Option.isSome_none,if_false,Bool.false_eq_true,read,ss]
  change (do match ← ((LValue.var dst).resolveWithRuntime c r).caught with
    | .ok (target,r') => match target.write c r' (.word v) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [resolved]
  change (match (ResolvedLValue.local dst).write c r (.word v) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) = _
  rw [written]

def readWord (data : Source.Expr) : Source.Stmt := .tryExternalCall .staticcall (.immutable "securityPool") data
  (.word 0) none false false [⟨"__ext0",.uint256,false⟩] [.uint 256]
  (.assign (.var Inv03.Bodies.tmp) (.castOp .uintCleanup 256 (.var "__ext0"))) []

def wordReply (c : Context) (r : Runtime) (root : Nat) (bytes : List Source.Byte) (out : EvmCompiler.Simulation.CallResponse) :=
  Inv12.replied c r out.postWorld (.lowLevelCall (decodeCallResponse out .staticcall root bytes 0 none))

theorem readWordRun (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (root addr : Nat)
    (rows : ScriptedResponder) (out : EvmCompiler.Simulation.CallResponse)
    (data : Source.Expr) (bytes : List Source.Byte) (E : data.evalWithRuntimeByContext c r=.ok (.bytes bytes,r))
    (clean : bytes.map normByte=bytes)
    (read : (Source.Expr.immutable "securityPool").evalWithRuntimeByContext c r=.ok (.word root,r))
    (fit : addr<Inv32Division.R) (size : root<Inv32Division.R) (away : wordEq root c.self=false) (ok : out.success=true)
    (ans : rows.answerCall? (snapshotWorld c r.state) (buildCallRequest c .staticcall root bytes 0 none)=some out)
    (decoded : abiDecodeValuesExcept? [.uint256] ((byteArrayToBytes out.returnData).map normByte)=.ok [.word addr])
    (old : r.lookupLocal? Inv03.Bodies.tmp=some (.word 0)) (next : Runtime)
    (written : ((wordReply c r root bytes out).withFrame [("__ext0",.word addr)]).assignLocal? Inv03.Bodies.tmp (.word addr)=some next) :
    (Stmt.eval (n+2) t c r (readWord data)).runWith rows=.ok (.normal next.popScope) := by
  let inner := (wordReply c r root bytes out).withFrame [("__ext0",.word addr)]
  have prior : inner.lookupLocal? Inv03.Bodies.tmp=some (.word 0) := old
  have copy := copyClean n t c inner next Inv03.Bodies.tmp "__ext0" 0 addr prior fit rfl written
  have Z := Inv12.wordFromRead c r _ _ (Inv08.Authority.literal _ _ 0 (by decide))
  unfold readWord
  rw [Stmt.eval]
  simp only [read,Z,E,Value.expectWord,Value.asBytes?,show Shared.norm root=root from Nat.mod_eq_of_lt size,
    clean,show Shared.norm 0=0 by rfl,selfDispatchKindOk,away,Bool.true_and,Bool.false_and,
    Bool.not_false,Bool.not_true,Bool.and_false,Bool.false_or,Bool.false_eq_true,if_false]
  unfold selfDispatchCall
  simp only [selfDispatchKindOk,away,Bool.and_false,Bool.false_eq_true,if_false]
  unfold emitLowLevelCall
  simp only [Bind.bind,EvmCompiler.Simulation.Interaction.bind,SolI.runWith,ans]
  have success : (decodeCallResponse out .staticcall root bytes 0 none).success=true := ok
  have ret : abiDecodeValuesExcept? [.uint256] ((decodeCallResponse out .staticcall root bytes 0 none).output.map normByte)=.ok [.word addr] := decoded
  simp only [success,if_true,List.map_cons,List.map_nil,ret]
  have accept : AbiCleanups.acceptOrUnspecified [.uint 256] [.word addr]=true := by
    simp [AbiCleanups.acceptOrUnspecified,AbiCleanups.accept,AbiCleanup.accepts,Shared.norm]
    exact Nat.mod_lt _ (by decide)
  have frame : BindingDecl.bindArgs? [⟨"__ext0",.uint256,false⟩] [.word addr]=some [("__ext0",.word addr)] := rfl
  simp only [accept,if_true,frame]
  change SolI.runWith rows (Stmt.eval (n+1) t c inner (.assign (.var Inv03.Bodies.tmp) (.castOp .uintCleanup 256 (.var "__ext0"))) >>= fun result =>
    pure (result.mapRuntime Runtime.popScope))=_
  rw [copy];rfl
end Inv48.Minima
