from typing import List, Dict, Any, Literal, Union, Optional
from pydantic import BaseModel, Field

class BaseNode(BaseModel):
    id: str
    type: str

class VariableNode(BaseNode):
    type: Literal["variable"] = "variable"
    label: str
    variable_name: str
    valid_values: List[str]
    value_definitions: Dict[str, str]
    few_shot_examples: List[Dict[str, str]]
    next_node_id: Optional[str] = None

class BranchCondition(BaseModel):
    variable_name: str
    operator: Literal["==", "!=", "<", ">", "<=", ">="]
    value: Any
    next_node_id: str

class BranchNode(BaseNode):
    type: Literal["branch"] = "branch"
    conditions: List[BranchCondition]
    default_next_node_id: str

class ActionNode(BaseNode):
    type: Literal["action"] = "action"
    action_type: str
    payload: Dict[str, Any]
    next_node_id: Optional[str] = None

class EndNode(BaseNode):
    type: Literal["end"] = "end"

# A discriminated union for type-safe parsing
TreeNode = Union[VariableNode, BranchNode, ActionNode, EndNode]

class Tree(BaseModel):
    nodes: Dict[str, TreeNode]
    root_node_id: str
