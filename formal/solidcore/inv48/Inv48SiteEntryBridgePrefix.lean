import Inv48SiteEntryBridgeCore
import Inv48RequestProloguePrefix
open SolidCore.Solidity.Source EvmCompiler.Simulation
open Inv48.RequestGuards
namespace Inv48.SiteEntryBridge
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def prepared (r : Runtime) (p a bounty : Nat) : Runtime :=
  (Inv48.RequestPrologue.reserve (Inv48.RequestPrologue.temps r p a bounty)).declareLocal
    Inv48.QuoteTransport.ret (.memoryRef r.nextMemory)

/-- The concrete quote prefix preserves arbitrary outer frames. Its arguments
are the values read from the enclosing request runtime, not fresh witnesses. -/
theorem prefixExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (p a bounty : Nat) (hp : p < 2^256) (ha : a < 2^256) (hb : bounty < 2^256)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty)) :
    Stmt.evalList (n+1) t c r.pushScope Inv48.RequestPrologue.quotePrefix =
      pure (.normal (prepared r p a bounty)) := by
  have one := Inv32Temps.temp n t c r.pushScope
    "_ic_arg_0" "proposedRepPerEthPrice" p hp (by
      simpa [Runtime.pushScope,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?] using P)
  have two := Inv32Temps.temp n t c (r.pushScope.declareLocal "_ic_arg_0" (.word p))
    "_ic_arg_1" "requestedInitialAttoWeth" a ha (by
      simpa [Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,
        Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?] using A)
  have three := Inv32Temps.temp n t c
    ((r.pushScope.declareLocal "_ic_arg_0" (.word p)).declareLocal "_ic_arg_1" (.word a))
    "_ic_arg_2" "bountyAttoEth" bounty hb (by
      simpa [Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,
        Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?] using B)
  change Stmt.evalList (n+1) t c r.pushScope [_ ,_,_,_] = _
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ one,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ two,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ three,Inv48.WholeQuote.singleList]
  simp [Stmt.eval,Runtime.declareMemoryLocal,Inv48.WholeQuote.quoteTy,Ty.defaultValue,
    Ty.coerceValue?,Ty.coerceTupleValues?,Runtime.memoryStoredValue,Runtime.memoryStoredValues,
    Runtime.allocMemory,Runtime.declareLocal,LocalEnv.declare,Value.isMemoryObject,
    prepared,Inv48.RequestPrologue.reserve,Inv48.RequestPrologue.temps,
    Inv48.QuoteMemory.tuple,Runtime.pushScope]

theorem preparedLookups (r : Runtime) (p a bounty : Nat) :
    (prepared r p a bounty).lookupLocal? "_ic_arg_0" = some (.word p) ∧
    (prepared r p a bounty).lookupLocal? "_ic_arg_1" = some (.word a) ∧
    (prepared r p a bounty).lookupLocal? "_ic_arg_2" = some (.word bounty) := by
  simp [prepared,Inv48.RequestPrologue.reserve,Inv48.RequestPrologue.temps,
    Runtime.pushScope,Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,
    LocalEnv.lookup?,Frame.lookup?,Inv48.QuoteTransport.ret]

/-- Exact saved frames, including every irrelevant local, are recovered from
prefix execution rather than constrained by the transport model. -/
theorem preparedLocals (r : Runtime) (p a bounty : Nat) :
    (prepared r p a bounty).locals =
      ((Inv48.QuoteTransport.ret,.memoryRef r.nextMemory) ::
        Inv48.QuoteTransport.argsFrame p a bounty) :: r.locals := by
  rfl
/-- Invert the actual block run, retaining its real parent continuation.
The fuel and saved runtime follow from scope push and the executed prefix. -/
theorem quoteBlockSite (n : Nat) (c : Context) (r : Runtime)
    (p a bounty : Nat) (hp : p < 2^256) (ha : a < 2^256) (hb : bounty < 2^256)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (k : Result → SolI Result) (trace : Interaction.Transcript) (out : Result)
    (run : Interaction.Executes
      (Stmt.eval (n+3) Inv48.Source.model.core.table c r
        Inv48.RequestPrologue.quoteBlockP.value >>= k) trace (.ok out)) :
    ∃ s : Inv48.RequestClassify.Site
      (Stmt.eval (n+3) Inv48.Source.model.core.table c r
        Inv48.RequestPrologue.quoteBlockP.value >>= k)
      Inv48.Source.model.core.table Inv48.RequestQuote.quoteCaptureP.value trace out,
      s.fuel = n+2 ∧ s.runtime = prepared r p a bounty ∧
      s.runtime.lookupLocal? "_ic_arg_0" = some (.word p) ∧
      s.runtime.lookupLocal? "_ic_arg_1" = some (.word a) ∧
      s.runtime.lookupLocal? "_ic_arg_2" = some (.word bounty) := by
  have tree :
      (Stmt.eval (n+3) Inv48.Source.model.core.table c r
        Inv48.RequestPrologue.quoteBlockP.value >>= k) =
      (Stmt.eval (n+2) Inv48.Source.model.core.table c (prepared r p a bounty)
        Inv48.RequestQuote.quoteCaptureP.value >>= fun v =>
          (listNext (n+2) Inv48.Source.model.core.table c
            [Inv48.QuoteTransport.aliasP.value] v >>= pop) >>= k) := by
    change (Stmt.eval ((n+2)+1) _ c r
      (.block (Inv48.RequestPrologue.quotePrefix ++
        Inv48.RequestQuote.quoteCaptureP.value :: [Inv48.QuoteTransport.aliasP.value])) >>= k) = _
    rw [blockSplit,prefixExecution (n+1) _ c r p a bounty hp ha hb P A B]
    change ((Stmt.eval (n+2) _ c (prepared r p a bounty) _ >>= _) >>= _) >>= k = _
    simp only [assoc]
  refine ⟨⟨n+2,c,prepared r p a bounty,(fun v => (listNext (n+2) Inv48.Source.model.core.table c [Inv48.QuoteTransport.aliasP.value] v >>= pop) >>= k),[],trace,by simp,?_,?_⟩,
    rfl,rfl,(preparedLookups r p a bounty).1,
    (preparedLookups r p a bounty).2.1,(preparedLookups r p a bounty).2.2⟩
  · rw [tree]
    exact .refl _
  · rwa [← tree]
end Inv48.SiteEntryBridge
