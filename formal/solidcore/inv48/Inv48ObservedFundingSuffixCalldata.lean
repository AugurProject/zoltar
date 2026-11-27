import Inv48ObservedFundingSuffixWrites
open SolidCore.Solidity.Source
namespace Inv48.ObservedFundingSuffix
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Encode from the observed request-site heap. In particular, no final upper
field is fabricated from a getter frame or from numerical minimum inputs. -/
theorem fundingCalldata (c : Context) (site : Runtime)
    (selector id a p halt exposure fee sponsor bounty gas : Nat)
    (ref : site.lookupLocal? "quote" = some (.memoryRef id))
    (mem : site.loadMemory? id = some (Inv48.QuoteMemory.tuple a
      (Inv48.QuoteExec.repAmount a p) halt exposure fee))
    (S : site.lookupLocal? "sponsor" = some (.word sponsor))
    (B : site.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (G : site.lookupLocal? "callbackGasLimit" = some (.word gas))
    (ha : a<Inv48.RequestQuote.R) (hr : Inv48.QuoteExec.repAmount a p<Inv48.RequestQuote.R)
    (hh : halt<Inv48.RequestQuote.R) (hb : bounty<Inv48.RequestQuote.R)
    (hg : gas<Inv48.RequestQuote.R) (payer : c.sender<2^160) (hs : sponsor<2^160)
    (selectorFits : selector<Inv48.RequestQuote.R) :
    Expr.eval c site (Inv48.RequestQuote.calldataExpr selector) =
      pure (.bytes (Inv48.RequestQuote.calldata selector c.sender sponsor a
        (Inv48.QuoteExec.repAmount a p) halt bounty gas),site) :=
  Inv48.RequestQuote.encoding c site selector id a (Inv48.QuoteExec.repAmount a p)
    halt exposure fee sponsor bounty gas ref mem S B G ha hr hh hb hg payer hs selectorFits

#print axioms fundingCalldata
end Inv48.ObservedFundingSuffix
