import Inv08Storage
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.ReleaseQuote

/-- Both generated return expressions use the actual checkpoint cursors and shared packed duration. -/
theorem storedAmounts (c : Context) (r : Runtime) (eth rep : Nat)
    (fields : c.storageFields = model.core.context.storageFields)
    (ethWord : eth < R) (repWord : rep < R)
    (ethOrder : stored r.state .ethCursor ≤ eth) (repOrder : stored r.state .repCursor ≤ rep)
    (durationWord : stored r.state .duration < R) (positive : 0 < stored r.state .duration)
    (ethLocal : r.lookupLocal? "ethIntegralNumerator" = some (.word eth))
    (repLocal : r.lookupLocal? "repIntegralNumerator" = some (.word rep)) :
    Inv40.Reads c r (pending "ethIntegralNumerator" "lastEthIntegralNumerator").value
      ((eth - stored r.state .ethCursor) / stored r.state .duration) ∧
    Inv40.Reads c r (pending "repIntegralNumerator" "lastRepIntegralNumerator").value
      ((rep - stored r.state .repCursor) / stored r.state .duration) := by
  exact ⟨amount _ _ _ _ _ _ _ ethWord ethOrder durationWord positive ethLocal
    (reads _ _ .ethCursor fields) (reads _ _ .duration fields),
    amount _ _ _ _ _ _ _ repWord repOrder durationWord positive repLocal
    (reads _ _ .repCursor fields) (reads _ _ .duration fields)⟩

end Inv08.ReleaseQuote
