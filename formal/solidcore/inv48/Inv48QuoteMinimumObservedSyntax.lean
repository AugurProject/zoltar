import Inv48PositiveSyntax
import Inv48MinimaTableCheck
import Inv48QuoteMinimumJoinDataflow
open SolidCore.Solidity.Source
namespace Inv48.QuoteMinimumJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
def key := "__internal_minimumToken1ReportAttoEthForPrice(uint256)#[SolidCore.Solidity.Ty.uint 256]"
theorem getterBinding : ∃ fn, Inv48.Source.model.core.table.lookup? key = some fn ∧
    fn.params = [⟨"proposedRepPerEthPrice",.uint256,false⟩] ∧
    fn.returns = [⟨"_ret0",.uint256,false⟩] ∧ fn.body = Inv48.Public.body := by
  exact Inv48.Minima.TableCheck.checkedLink _ key [.word "proposedRepPerEthPrice"] [.word "_ret0"] Inv48.Public.shape (by native_decide)

abbrev dst := "_sol_hoist_0"
abbrev ret := "_ret_minimumToken1ReportAttoEthForPrice_0"
def callSite (r : Runtime) (p : Nat) := Inv32OneArg.temps r dst ret 0 p 0

end Inv48.QuoteMinimumJoin
