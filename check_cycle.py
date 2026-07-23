import json

with open("tree_0b.json", "r") as f:
    data = json.load(f)

adj = {}
for n in data["nodes"]:
    nid = n["id"]
    adj[nid] = []
    if "branches" in n and n["branches"]:
        for b in n["branches"]:
            if "next_node_id" in b and b["next_node_id"]:
                adj[nid].append(b["next_node_id"])
            elif "nextNodeId" in b and b["nextNodeId"]:
                adj[nid].append(b["nextNodeId"])

visited = set()
rec_stack = set()
cycle_found = False

def dfs(node):
    global cycle_found
    visited.add(node)
    rec_stack.add(node)
    
    for nxt in adj.get(node, []):
        if nxt not in visited:
            dfs(nxt)
        elif nxt in rec_stack:
            print(f"CYCLE DETECTED: {node} -> {nxt}")
            cycle_found = True
            
    rec_stack.remove(node)

for n in adj:
    if n not in visited:
        dfs(n)

if not cycle_found:
    print("No cycle detected.")
