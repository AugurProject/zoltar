import Inv48SymbolicCloneEval
import Inv48SymbolicCloneWords
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000
set_option linter.unusedSimpArgs false

theorem store_word (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (loopState base code i acc).assignLocal? "#extword" (.word v) =
      some (loopState base code i v) := by
  simp [Runtime.assignLocal?, loopState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]

theorem store_index (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (loopState base code i acc).assignLocal? "#extindex" (.word v) =
      some (loopState base code v acc) := by
  simp [Runtime.assignLocal?, loopState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]
theorem store_word_scoped (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (loopState base code i acc).pushScope.assignLocal? "#extword" (.word v) =
      some (loopState base code i v).pushScope := by
  simp [Runtime.pushScope, Runtime.assignLocal?, loopState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]

theorem store_index_scoped (base : Runtime) (code : List Nat) (i acc v : Nat) :
    (loopState base code i acc).pushScope.assignLocal? "#extindex" (.word v) =
      some (loopState base code v acc).pushScope := by
  simp [Runtime.pushScope, Runtime.assignLocal?, loopState, Runtime.lookupLocal?, LocalEnv.lookup?, Frame.lookup?,
    Value.coerceLike?, LocalEnv.assign?, Frame.assign?, normWord,
    SolidCore.Solidity.Shared.norm, show SolidCore.Solidity.Shared.wordModulus = R from rfl, Bind.bind, Option.bind]
end Inv48.SymbolicClone
