import Inv48WholeQuoteFundingStage
open SolidCore.Solidity.Source
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
theorem initializedFundingRef (base : Runtime) (p a bounty : Nat) :
    (funded (prepared base p a bounty) base.nextMemory a p).lookupLocal? "quote" =
      some (.memoryRef base.nextMemory) := by rfl
#print axioms initializedFundingRef
end Inv48.WholeQuote
