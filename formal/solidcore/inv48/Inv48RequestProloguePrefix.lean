import Inv48RequestPrologueCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestPrologue
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

def requestFrame (sponsor p a bounty gas : Nat) : Frame :=
  [("sponsor",.word sponsor),("proposedRepPerEthPrice",.word p),
   ("requestedInitialAttoWeth",.word a),("bountyAttoEth",.word bounty),
   ("callbackGasLimit",.word gas),("reportId",.word 0)]
def quotePrefix : List Stmt := [
  .varDecl .uint256 "_ic_arg_0" (some (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice"))),
  .varDecl .uint256 "_ic_arg_1" (some (.castOp .uintCleanup 256 (.var "requestedInitialAttoWeth"))),
  .varDecl .uint256 "_ic_arg_2" (some (.castOp .uintCleanup 256 (.var "bountyAttoEth"))),
  .memoryVarDecl Inv48.WholeQuote.quoteTy Inv48.QuoteTransport.ret none]
def source (r : Runtime) (rest : LocalEnv)
    (sponsor p a bounty gas hoisted : Nat) :=
  {r with locals := [(Inv48.QuoteTransport.hoist,Value.memoryRef hoisted)]::[]::requestFrame sponsor p a bounty gas::rest}
def temps (r : Runtime) (p a bounty : Nat) :=
  ((r.pushScope.declareLocal "_ic_arg_0" (.word p)).declareLocal "_ic_arg_1" (.word a)).declareLocal
    "_ic_arg_2" (.word bounty)

theorem argumentPrefix (n : Nat) (table : FunctionTable) (c : Context)
    (r : Runtime) (rest : LocalEnv) (sponsor p a bounty gas hoisted : Nat)
    (hp : p<2^256) (ha : a<2^256) (hb : bounty<2^256) (ss : List Stmt) :
    Stmt.evalList (n+1) table c (source r rest sponsor p a bounty gas hoisted).pushScope
      (quotePrefix.take 3 ++ ss) =
    Stmt.evalList (n+1) table c (temps (source r rest sponsor p a bounty gas hoisted) p a bounty) ss := by
  have one := Inv32Temps.temp n table c (source r rest sponsor p a bounty gas hoisted).pushScope
    "_ic_arg_0" "proposedRepPerEthPrice" p hp (by rfl)
  have two := Inv32Temps.temp n table c
    ((source r rest sponsor p a bounty gas hoisted).pushScope.declareLocal "_ic_arg_0" (.word p))
    "_ic_arg_1" "requestedInitialAttoWeth" a ha (by rfl)
  have three := Inv32Temps.temp n table c
    (((source r rest sponsor p a bounty gas hoisted).pushScope.declareLocal "_ic_arg_0" (.word p)).declareLocal "_ic_arg_1" (.word a))
    "_ic_arg_2" "bountyAttoEth" bounty hb (by rfl)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ one).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ two).trans
      (Inv32FloorStart.seqStep _ _ _ _ _ _ _ three))

def reserve (r : Runtime) : Runtime :=
  {r with
    memory := MemoryMap.insertLoop r.memory r.nextMemory (Inv48.QuoteMemory.tuple 0 0 0 0 0)
    nextMemory := r.nextMemory+1
    nextMemoryByte := r.nextMemoryByte+(Inv48.QuoteMemory.tuple 0 0 0 0 0).memoryAllocationBytes}

theorem returnDefault (n : Nat) (table : FunctionTable) (c : Context)
    (r : Runtime) (rest : LocalEnv) (sponsor p a bounty gas hoisted : Nat) :
    Stmt.eval (n+1) table c (temps (source r rest sponsor p a bounty gas hoisted) p a bounty)
      (.memoryVarDecl Inv48.WholeQuote.quoteTy Inv48.QuoteTransport.ret none) =
      pure (.normal (caller (reserve r) [] ([]::requestFrame sponsor p a bounty gas::rest)
        p a bounty r.nextMemory hoisted)) := by
  simp [Stmt.eval,Runtime.declareMemoryLocal,Inv48.WholeQuote.quoteTy,Ty.defaultValue,
    Ty.coerceValue?,Ty.coerceTupleValues?,Runtime.memoryStoredValue,Runtime.memoryStoredValues,
    Runtime.allocMemory,Runtime.declareLocal,LocalEnv.declare,Value.isMemoryObject,
    temps,source,caller,reserve,Inv48.QuoteTransport.saved,Inv48.QuoteTransport.argsFrame,
    Runtime.pushScope,Inv48.QuoteTransport.ret,Inv48.QuoteMemory.tuple]

end Inv48.RequestPrologue
namespace Inv48.RequestPrologue
open SolidCore.Solidity.Source EvmCompiler.Simulation

theorem prefixExecution (n : Nat) (table : FunctionTable) (c : Context)
    (r : Runtime) (rest : LocalEnv) (sponsor p a bounty gas hoisted : Nat)
    (hp : p<2^256) (ha : a<2^256) (hb : bounty<2^256) :
    Stmt.evalList (n+1) table c (source r rest sponsor p a bounty gas hoisted).pushScope
      quotePrefix = pure (.normal (caller (reserve r) []
        ([]::requestFrame sponsor p a bounty gas::rest) p a bounty r.nextMemory hoisted)) := by
  have args := argumentPrefix n table c r rest sponsor p a bounty gas hoisted hp ha hb
    [.memoryVarDecl Inv48.WholeQuote.quoteTy Inv48.QuoteTransport.ret none]
  change Stmt.evalList (n+1) table c _ quotePrefix = _ at args
  rw [args,Inv48.WholeQuote.singleList,returnDefault]

theorem hoistDefault (n : Nat) (table : FunctionTable) (c : Context)
    (r : Runtime) (rest : LocalEnv) (sponsor p a bounty gas : Nat) :
    Stmt.eval (n+1) table c {r with locals := []::[]::requestFrame sponsor p a bounty gas::rest}
      (.memoryVarDecl Inv48.WholeQuote.quoteTy Inv48.QuoteTransport.hoist none) =
      pure (.normal (source (reserve r) rest sponsor p a bounty gas r.nextMemory)) := by
  simp [Stmt.eval,Runtime.declareMemoryLocal,Inv48.WholeQuote.quoteTy,Ty.defaultValue,
    Ty.coerceValue?,Ty.coerceTupleValues?,Runtime.memoryStoredValue,Runtime.memoryStoredValues,
    Runtime.allocMemory,Runtime.declareLocal,LocalEnv.declare,Value.isMemoryObject,
    source,reserve,Inv48.QuoteMemory.tuple]
end Inv48.RequestPrologue
