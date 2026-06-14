from typing import Dict, Any, List
from app.schemas.tree import Tree, TreeNode, BranchNode

class TreeStateManager:
    def __init__(self, tree: Tree):
        self.tree = tree
        self.current_node_id: str = tree.root_node_id
        self.collected_variables: Dict[str, Any] = {}
        self.ordered_actions: List[Dict[str, Any]] = []
        self.conversation_history: List[Dict[str, str]] = []
        self.MAX_HISTORY = 8

    def get_current_node(self) -> TreeNode:
        if self.current_node_id not in self.tree.nodes:
            raise ValueError(f"Current node ID '{self.current_node_id}' not found in tree.")
        return self.tree.nodes[self.current_node_id]

    def collect_variable(self, name: str, value: Any):
        self.collected_variables[name] = value

    def advance_node(self, next_node_id: str):
        if next_node_id not in self.tree.nodes:
            raise ValueError(f"Node {next_node_id} does not exist in the tree.")
        self.current_node_id = next_node_id

    def add_action(self, action: Dict[str, Any]):
        self.ordered_actions.append(action)

    def append_history(self, role: str, text: str):
        self.conversation_history.append({"role": role, "text": text})
        if len(self.conversation_history) > self.MAX_HISTORY:
            self.conversation_history = self.conversation_history[-self.MAX_HISTORY:]

    def evaluate_branch(self) -> str:
        current_node = self.get_current_node()
        if not isinstance(current_node, BranchNode):
            raise ValueError("Current node is not a BranchNode.")
        
        for condition in current_node.conditions:
            var_name = condition.variable_name
            if var_name not in self.collected_variables:
                continue
            
            collected_val = self.collected_variables[var_name]
            cond_val = condition.value
            op = condition.operator

            # Safely cast collected_val to cond_val's type for comparison
            try:
                if isinstance(cond_val, int):
                    compare_val = int(collected_val)
                elif isinstance(cond_val, float):
                    compare_val = float(collected_val)
                elif isinstance(cond_val, bool):
                    if isinstance(collected_val, str):
                        compare_val = collected_val.lower() == 'true'
                    else:
                        compare_val = bool(collected_val)
                else:
                    compare_val = str(collected_val)
            except (ValueError, TypeError):
                continue

            matched = False
            if op == "==": matched = (compare_val == cond_val)
            elif op == "!=": matched = (compare_val != cond_val)
            elif op == "<": matched = (compare_val < cond_val)
            elif op == ">": matched = (compare_val > cond_val)
            elif op == "<=": matched = (compare_val <= cond_val)
            elif op == ">=": matched = (compare_val >= cond_val)

            if matched:
                return condition.next_node_id

        return current_node.default_next_node_id
