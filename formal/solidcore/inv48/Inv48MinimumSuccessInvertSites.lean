import Inv48MinimumSuccessInvertCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.MinimumSuccessInvert
open Inv48.RequestDispatch Inv48.WrapperTraversal Inv48.Positive
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def firstCall : Stmt := .internalCall [ret1] key1 []
def secondCall : Stmt := .internalCall [ret2] key2 []

def innerTail : List Stmt := [.varDecl .uint256 h2 none,roundCode,
  .varDecl .uint256 h3 none,maxCode,.returnValues [(castWord h3).core]]

def firstRoute (n : Nat) : Blocks Inv48.Source.model.core.table firstCall (n+4) Inv48.Public.body :=
  .block (n+3) [Inv32FloorFastPath.cleanParam "proposedRepPerEthPrice",.skip]
    (.block ([.requireStmt condition (some "Initial oracle price zero"),liquidationGuard,.varDecl .uint256 h0 none,
      simpleCode h0 ret1 key1,.varDecl .uint256 h1 none,simpleCode h1 ret2 key2] ++ innerTail)) []
    (by decide)
    (.block (n+2) [.requireStmt condition (some "Initial oracle price zero"),liquidationGuard,.varDecl .uint256 h0 none]
      (simpleCode h0 ret1 key1) ([.varDecl .uint256 h1 none,simpleCode h1 ret2 key2] ++ innerTail)
      (by native_decide)
      (.block (n+1) [.varDecl .uint256 ret1 none] (.captureReturn [ret1] firstCall)
        [.assign (.var h0) (.var ret1)] (by decide)
        (.capture n [ret1] firstCall (.here n))))

def secondRoute (n : Nat) : Blocks Inv48.Source.model.core.table secondCall (n+4) Inv48.Public.body :=
  .block (n+3) [Inv32FloorFastPath.cleanParam "proposedRepPerEthPrice",.skip]
    (.block ([.requireStmt condition (some "Initial oracle price zero"),liquidationGuard,.varDecl .uint256 h0 none,
      simpleCode h0 ret1 key1,.varDecl .uint256 h1 none,simpleCode h1 ret2 key2] ++ innerTail)) []
    (by decide)
    (.block (n+2) [.requireStmt condition (some "Initial oracle price zero"),liquidationGuard,.varDecl .uint256 h0 none,
      simpleCode h0 ret1 key1,.varDecl .uint256 h1 none]
      (simpleCode h1 ret2 key2) innerTail (by native_decide)
      (.block (n+1) [.varDecl .uint256 ret2 none] (.captureReturn [ret2] secondCall)
        [.assign (.var h1) (.var ret2)] (by decide)
        (.capture n [ret2] secondCall (.here n))))

/-- Recover an actual contiguous helper execution and its continuation, without
assuming any helper value or a successful search. -/
theorem helper (target : Stmt) (route : Blocks Inv48.Source.model.core.table target fuel Inv48.Public.body)
    (c : Context) (r : Runtime) (trace : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body) trace (.ok out)) :
    ∃ s : Inv48.RequestClassify.Site (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body)
      Inv48.Source.model.core.table target trace out,
      ∃ value during rest, s.after = during ++ rest ∧
        Interaction.Executes (Stmt.eval s.fuel Inv48.Source.model.core.table s.context s.runtime target) during (.ok value) ∧
        Interaction.Executes (s.continuation value) rest (.ok out) := by
  have reject : Rejects pure out := by
    intro v bad tr exec
    cases exec
    exact ordinary bad
  have unit : (Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body >>= pure) =
      Stmt.eval fuel Inv48.Source.model.core.table c r Inv48.Public.body := Interaction.bind_pure _
  obtain ⟨s,_,_⟩ := site route c r pure trace out reject (by rwa [unit])
  rw [unit] at s
  obtain ⟨value,during,rest,split,first,last⟩ := bindSuccess _ _ _ _ s.suffix
  exact ⟨s,value,during,rest,split,first,last⟩
end Inv48.MinimumSuccessInvert
