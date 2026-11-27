import Inv48CollateralMinimumWrap
open SolidCore.Solidity.Source
namespace Inv48.CollateralMinimum
open Inv48.SymbolicClone Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
structure OracleAssumptions (c : Context) (r next : Runtime) (rows : ScriptedResponder)
    (implementation universeBytes token : List Nat) (root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse) : Prop where
  hi : implementation.length=20
  hu : universeBytes.length=31
  ht : token.length=20
  cu : ∀ b ∈ universeBytes, b<256
  ct : ∀ b ∈ token, b<256
  selfWord : c.self<R
  boundary : r.state.envAccountCode c c.self=runtimeCode implementation universeBytes token
  rootValue : (Expr.immutable "securityPool").evalWithRuntimeByContext c
    (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes)) = .ok (.word root,oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes))
  exposureFits : exposure<Inv32Division.R
  rootFits : root<Inv32Division.R
  away : wordEq root c.self=false
  success : out.success=true
  answer : rows.answerCall? (snapshotWorld c (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes)).state)
    (buildCallRequest c .staticcall root (Inv12.wireBytes 2603245787 [decode universeBytes]) 0 none)=some out
  decoded : abiDecodeValuesExcept? [.uint256] ((byteArrayToBytes out.returnData).map normByte)=.ok [.word exposure]
  written : ((Inv48.Minima.wordReply c (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes)) root (Inv12.wireBytes 2603245787 [decode universeBytes]) out).withFrame [("__ext0",.word exposure)]).assignLocal? tmp (.word exposure)=some next
  captured : next.popScope.lookupLocal? tmp=some (.word exposure)

structure OracleResponseAssumptions (c : Context) (r : Runtime) (rows : ScriptedResponder)
    (implementation universeBytes token : List Nat) (root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse) : Prop where
  hi : implementation.length=20
  hu : universeBytes.length=31
  ht : token.length=20
  cu : ∀ b ∈ universeBytes, b<256
  ct : ∀ b ∈ token, b<256
  selfWord : c.self<R
  boundary : r.state.envAccountCode c c.self=runtimeCode implementation universeBytes token
  rootValue : (Expr.immutable "securityPool").evalWithRuntimeByContext c
    (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes)) = .ok (.word root,oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes))
  exposureFits : exposure<Inv32Division.R
  rootFits : root<Inv32Division.R
  away : wordEq root c.self=false
  success : out.success=true
  answer : rows.answerCall? (snapshotWorld c (oracleStage r (runtimeCode implementation universeBytes token) (decode universeBytes)).state)
    (buildCallRequest c .staticcall root (Inv12.wireBytes 2603245787 [decode universeBytes]) 0 none)=some out
  decoded : abiDecodeValuesExcept? [.uint256] ((byteArrayToBytes out.returnData).map normByte)=.ok [.word exposure]

theorem aggregateBodyRun (n : Nat) (c : Context) (r next : Runtime) (rows : ScriptedResponder)
    (implementation universeBytes token : List Nat) (root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse)
    (h : OracleAssumptions c r.pushScope.pushScope.pushScope next rows implementation universeBytes token root exposure out) :
    (Stmt.eval (n+49) table c r aggregateBody).runWith rows =
      .ok (.returned next.popScope.popScope.popScope.popScope [.word exposure]) := by
  exact wrapRun (n+45) c r next.popScope rows aggregateList [.word exposure]
    (aggregateListRun n c r.pushScope.pushScope.pushScope next rows implementation universeBytes token root exposure out
      h.hi h.hu h.ht h.cu h.ct h.selfWord h.boundary h.rootValue h.exposureFits h.rootFits h.away h.success h.answer h.decoded h.written h.captured)

def scalarFrame (r : Runtime) : Runtime := {r with locals := [[("_ret0",.word 0)]]}
def aggregateFinal (next : Runtime) := next.popScope.popScope.popScope.popScope

theorem aggregateCallRun (n : Nat) (c : Context) (r next assigned : Runtime) (rows : ScriptedResponder)
    (target : String) (implementation universeBytes token : List Nat) (root exposure : Nat)
    (out : EvmCompiler.Simulation.CallResponse)
    (h : OracleAssumptions {c with checked := true} (scalarFrame r).pushScope.pushScope.pushScope next rows implementation universeBytes token root exposure out)
    (put : ({aggregateFinal next with locals := r.locals}).assignNamedValuesRef? [target] [.word exposure] = some assigned) :
    (Stmt.eval (n+50) table c r (.internalCall [target] aggregateKey [])).runWith rows = .ok (.normal assigned) := by
  have body := aggregateBodyRun n {c with checked := true} (scalarFrame r) next rows implementation universeBytes token root exposure out h
  have call := Inv48.Minima.callRun (n+49) table c r r (scalarFrame r) rows aggregateKey aggregateFn [] [] [target] r.locals
    (.returned (aggregateFinal next) [.word exposure]) rfl aggregateLookup
    (by simp [internalCallEnter?,InternalFunction.initialFrame?,aggregateFn,InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue,scalarFrame]) body
  rw [call,finishWord aggregateFn target r.locals (aggregateFinal next) assigned exposure rfl put]
  rfl
end Inv48.CollateralMinimum
