import Inv48CloneReadMath
import Inv48CloneReadExec
import Inv48MinimaLocals
import Inv32Hoist
open SolidCore.Solidity.Source
namespace Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 40000000
#print Expr
#print Runtime.assignLocal?
#print Runtime.lookupStorageBase?
#print Runtime.derefMemoryValue
#print Runtime.pushScope
#print Runtime.popScope
end Inv48.SymbolicClone
