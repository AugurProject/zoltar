import Inv48LiquidationGetterSuccess
import Inv48PositiveOuter
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32Actions Inv32FloorFastPath
namespace Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def phase3 (r : Runtime) (p c rep : Nat) := saved (phase2 r p c rep) h2 (roundedRep rep p)
def phase4 (r : Runtime) (p c rep : Nat) := saved (phase3 r p c rep) h3 (Inv48.minimum c rep p)
def maxArgs : List Action := [declare .uint256 a0 (cleanWord h0) (by decide),
  declare .uint256 a1 (castWord h2) (by decide),declareZero maxRet]
def maxStage (r : Runtime) (p c rep out tmp : Nat) :=
  (((saved (phase3 r p c rep) h3 out).pushScope.declareLocal a0 (.word c)).declareLocal a1
    (.word (roundedRep rep p))).declareLocal maxRet (.word tmp)
def maxCode : Stmt := .block (maxArgs.map Action.core ++ [
  .captureReturn [maxRet] (.internalCall [maxRet] maxKey [.var a0,.var a1]),
  .assign (.var h3) (.var maxRet)])

def condition : Expr := .binary .ne (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice")) (.word 0)

def liquidationGuard : Stmt := GuardRecovery.guardCode

 theorem bodyForm : Inv48.Public.body = .block [
    Inv32FloorFastPath.cleanParam "proposedRepPerEthPrice",.skip,
    .block [.requireStmt condition (some "Initial oracle price zero"),liquidationGuard,
      .varDecl .uint256 h0 none,simpleCode h0 ret1 key1,
      .varDecl .uint256 h1 none,simpleCode h1 ret2 key2,
      .varDecl .uint256 h2 none,roundCode,
      .varDecl .uint256 h3 none,maxCode,
      .returnValues [(castWord h3).core]]] := by rfl

end Inv48.Positive
