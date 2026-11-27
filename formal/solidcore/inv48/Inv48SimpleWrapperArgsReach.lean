import Inv48SimpleWrapperArgsSource
import Inv48SimpleWrapperArgsTemps
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.RequestGuards
namespace Inv48.SimpleWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def requestTail : List Stmt := [.assign (.var hoist) (.var "_ret__requestPrice_0")]
def requestBlock : Stmt := .block (requestPrefix ++ .captureReturn ["_ret__requestPrice_0"] call :: requestTail)
def mainTail : List Stmt := [.assign (.var "reportId") (.castOp .uintCleanup 256 (.var hoist))]
def mainBlock : Stmt := .block (beforeRequest ++ requestBlock :: mainTail)
def refund : Stmt := .block [temp .uint256 "_ic_arg_0" (.castOp .uintCleanup 256 (.var "bountyAttoEth")),
  .captureReturn [] (.internalCall [] refundKey [.var "_ic_arg_0"])]
def middle : Stmt := .block [mainBlock,refund]

theorem bodyShape : bodyP.value = .block (Inv48.RequestPrologue.publicPrologueP.value ++ [middle]) := by rfl

def wrapperCut (n : Nat) (c : Context) (state : State) (p a b : Nat)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) :
    Cut (n+9) Inv48.Source.model.core.table c
      (Inv48.RequestPrologue.publicBase c state p a b) bodyP.value := by
  let r := Inv48.RequestPrologue.publicBase c state p a b
  let outer := r.pushScope
  let main := outer.pushScope
  let ready := stage main.pushScope
  let actual := temps c ready.pushScope p a b
  have args := requestPrefixExecution (n+4) c ready.pushScope p a b hp ha hb
    (by simp [ready,stage,main,outer,r,Inv48.RequestPrologue.publicBase,
      Inv48.RequestPrologue.publicFrame,hoist,viewName,Runtime.lookupLocal?,Runtime.pushScope,
      Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?])
    (by simp [ready,stage,main,outer,r,Inv48.RequestPrologue.publicBase,
      Inv48.RequestPrologue.publicFrame,hoist,viewName,Runtime.lookupLocal?,Runtime.pushScope,
      Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?])
    (by simp [ready,stage,main,outer,r,Inv48.RequestPrologue.publicBase,
      Inv48.RequestPrologue.publicFrame,hoist,viewName,Runtime.lookupLocal?,Runtime.pushScope,
      Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?])
    (by simp [ready,stage,hoist,viewName])
  let leaf := here (n+4) Inv48.Source.model.core.table c actual call
  let captured := captureCut (n+4) Inv48.Source.model.core.table c actual ["_ret__requestPrice_0"] call leaf
  let argsCut := blockCut (n+5) Inv48.Source.model.core.table c ready actual requestPrefix
    (.captureReturn ["_ret__requestPrice_0"] call) requestTail []
    (by rw [args]; exact .done _) captured
  let beforeCut := blockCut (n+6) Inv48.Source.model.core.table c main ready beforeRequest
    requestBlock mainTail [] (by rw [beforeRequestExecution]; exact .done _) argsCut
  let middleCut := blockCut (n+7) Inv48.Source.model.core.table c outer main [] mainBlock [refund]
    [] (by rw [Stmt.evalList]; exact .done _) beforeCut
  have clean := Inv48.RequestPrologue.publicPrologueExecution (n+7) c state p a b hp ha hb
  let full := blockCut (n+8) Inv48.Source.model.core.table c r outer
    Inv48.RequestPrologue.publicPrologueP.value middle [] []
    (by rw [clean]; exact .done _) middleCut
  exact bodyShape.symm ▸ full

theorem cutValues (n : Nat) (c : Context) (state : State) (p a b : Nat)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) :
    let cut := wrapperCut n c state p a b hp ha hb
    cut.trace = [] ∧ cut.siteFuel = n+4 ∧ cut.context = c ∧ cut.statement = call ∧
      Inv48.WrapperArgs.TempValues cut.runtime c.sender p a b 4000000 := by
  dsimp only
  refine ⟨rfl,rfl,rfl,rfl,?_⟩
  exact tempsValues c _ p a b
end Inv48.SimpleWrapperArgs
