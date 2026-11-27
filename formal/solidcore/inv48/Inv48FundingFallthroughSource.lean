import Inv48FundingFallthroughNoReturn
open SolidCore.Solidity.Source
open Inv48.RequestGuards Inv48.RequestClassify
namespace Inv48.FundingFallthrough
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def request := Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey

def sharedPath : Path := .block 6 (.block 6 (.block 4 .here))

/-- Each preceding sibling has both a no-return certificate and a check that
excludes other successful escaping control. Calls are checked through the real table. -/
def prefixCheck (path : Path) (t : FunctionTable) (s : Stmt) : Bool :=
  match path,s with
  | .here,_ => true
  | .block i next,.block ss =>
    (ss.take i).all (fun s => checked 100 t s && simpleFalls 100 s && Inv12.fallsThrough 100 s) &&
    ((ss[i]?).any (prefixCheck next t))
  | _,_ => false

end Inv48.FundingFallthrough
