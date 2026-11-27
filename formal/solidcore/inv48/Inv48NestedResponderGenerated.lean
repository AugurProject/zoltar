import Inv48NestedResponderCore
import Inv48RequestQuoteAudit
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.NestedResponder
open Inv48.RequestQuote
theorem generatedComposition (n : Nat) (c : Context) (r : Runtime)
    (id a b h e s sponsor bounty gas : Nat)
    (stmt : Stmt) (source : actualCall = some stmt)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (quoteTuple a b h e s))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (ha : a<R) (hb : b<R) (hh : h<R) (hB : bounty<R) (hG : gas<R)
    (hp : c.sender<2^160) (hs : sponsor<2^160)
    (self : c.self<R) (construction : c.construction=false)
    (fuel budget : Nat) (rows : ScriptedResponder)
    (served : Served c r.state (calldata 2391489481 c.sender sponsor a b h bounty gas) fuel budget rows)
    (rest : Interaction.Transcript) (outcome : Except SolidityFailure Result)
    (openWorld : c.selfDispatch? = none)
    (tail : Interaction.Executes
      (reply n Inv48.Source.model.core.table c r returns cleanups successBody
        (decodeCallResponse (response c r.state served.result) .call c.self
          (calldata 2391489481 c.sender sponsor a b h bounty gas) 0 none,
         adoptWorld (response c r.state served.result).postWorld c r.state)) rest outcome) :
    Interaction.Executes served.nested.tree (servedTrace served rest).child (.ok served.result) ∧
    Interaction.Executes (Stmt.eval (n+1) Inv48.Source.model.core.table c r stmt)
      ((servedTrace served rest).call ++ (servedTrace served rest).continuation) outcome := by
  rw [checkedOperational n _ c r id a b h e s sponsor bounty gas stmt source
    ref mem S B G ha hb hh hB hG hp hs self construction]
  exact servedComposition c r.state _ fuel budget rows served
    (reply n Inv48.Source.model.core.table c r returns cleanups successBody)
    rest outcome openWorld tail
#print axioms generatedComposition
#print generatedComposition
end Inv48.NestedResponder
