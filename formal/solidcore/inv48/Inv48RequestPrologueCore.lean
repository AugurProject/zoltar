import Inv48QuoteTransportGenerated
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestPrologue
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

def caller (r : Runtime) (frame : Frame) (rest : LocalEnv) (p a bounty old hoisted : Nat) :=
  {r with locals := Inv48.QuoteTransport.saved frame rest p a bounty old hoisted}
def base (r : Runtime) : Runtime := {r with locals := []}

theorem arguments (c : Context) (r : Runtime) (frame : Frame) (rest : LocalEnv)
    (p a bounty old hoisted : Nat) :
    Expr.evalRefArgList c (caller r frame rest p a bounty old hoisted)
      [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] =
      pure ([.word p,.word a,.word bounty],caller r frame rest p a bounty old hoisted) := by
  rfl

theorem enter (fn : InternalFunction) (r : Runtime) (frame : Frame) (rest : LocalEnv)
    (p a bounty old hoisted : Nat)
    (initial : fn.initialFrame? [.word p,.word a,.word bounty] = some
      [("proposedRepPerEthPrice",.word p),("requestedInitialAttoWeth",.word a),
       ("bountyAttoEth",.word bounty),("quote",Inv48.QuoteMemory.tuple 0 0 0 0 0)]) :
    internalCallEnter? fn [.word p,.word a,.word bounty]
      (caller r frame rest p a bounty old hoisted) =
      some (Inv48.WholeQuote.entry (base r) p a bounty,
        Inv48.QuoteTransport.saved frame rest p a bounty old hoisted) := by
  simp [internalCallEnter?,initial,caller,base,Inv48.WholeQuote.entry,Runtime.withFrame]

theorem sponsor (out : Runtime) (tail : Frame) (rest : LocalEnv) (id sponsor : Nat) :
    (Inv48.QuoteTransport.declared out (("sponsor",.word sponsor)::tail) rest id).lookupLocal?
      "sponsor" = some (.word sponsor) := by
  rfl
end Inv48.RequestPrologue
